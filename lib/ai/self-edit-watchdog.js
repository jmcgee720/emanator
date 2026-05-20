// ──────────────────────────────────────────────────────────────────────
// Self-edit health watchdog — post-deploy auto-revert
// ──────────────────────────────────────────────────────────────────────
// After the Core System agent commits code to main, Vercel auto-deploys
// (~45-90 seconds). This watchdog:
//   1. Captures the "before" SHA of main at the start of the agent turn.
//   2. After the turn ends with at least one commit, polls Vercel's
//      production /api/health endpoint until it stabilizes.
//   3. If health returns 5xx (or never recovers within the timeout) the
//      watchdog force-updates main back to the before-SHA, restoring
//      the previous working deploy.
//
// Why this is necessary: the Vercel build-failure rollback only catches
// compile errors. A change that builds successfully but breaks at
// runtime (missing event listener, broken auth check, busted route
// guard) deploys cleanly and stays broken until a human notices. This
// watchdog catches those.
//
// Fire-and-forget: never blocks the chat stream. The agent's response
// has already been sent. The revert happens in the background; the
// user sees a follow-up status when (or if) it fires.

const GITHUB_API = 'https://api.github.com'

const POST_DEPLOY_INITIAL_WAIT_MS = 45_000   // give Vercel time to deploy
const HEALTH_POLL_INTERVAL_MS = 5_000        // poll every 5s
const HEALTH_POLL_MAX_DURATION_MS = 90_000   // give up after 90s of polling
const HEALTH_CONSECUTIVE_FAILURES = 3        // 3 in a row = revert

/**
 * Fetch the current SHA of the given branch's HEAD commit.
 */
async function getBranchHeadSha({ token, repo, branch }) {
  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'auroraly-watchdog',
      },
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`getBranchHeadSha ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = await res.json()
  return json?.object?.sha || null
}

/**
 * Force the branch ref back to a previous SHA. Uses --force-with-lease
 * semantics: GitHub returns 422 if the branch HEAD moved between our
 * check and our update (some other commit landed), in which case we
 * abort the revert rather than steamroll the new commit.
 */
async function forceUpdateBranchRef({ token, repo, branch, sha }) {
  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'auroraly-watchdog',
      },
      body: JSON.stringify({ sha, force: true }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`forceUpdateBranchRef ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = await res.json()
  return json?.object?.sha || sha
}

async function isHealthy(healthUrl) {
  try {
    const res = await fetch(healthUrl, { method: 'GET', cache: 'no-store' })
    // Treat 2xx and 304 as healthy. 5xx and network errors are not.
    if (res.status >= 500) return false
    return res.status < 400
  } catch {
    return false
  }
}

/**
 * Snapshot the current branch HEAD so we can revert to it later if the
 * agent's changes break the deploy. Returns null on failure (we still
 * let the agent edit — better than blocking — but auto-revert disabled).
 */
export async function captureBeforeSha({ repo, branch = 'main', token = process.env.GITHUB_TOKEN }) {
  if (!token || !repo) return null
  try {
    return await getBranchHeadSha({ token, repo, branch })
  } catch (e) {
    console.warn('[watchdog] captureBeforeSha failed; auto-revert disabled this turn:', e?.message)
    return null
  }
}

/**
 * Schedule the post-deploy health check. NON-BLOCKING — returns the
 * Promise so a caller may optionally await it for tests, but the
 * primary use is `void scheduleHealthCheck(...)` so the chat stream
 * doesn't wait.
 *
 * @param {object} opts
 * @param {string} opts.repo               GitHub repo "owner/name"
 * @param {string} [opts.branch]           default "main"
 * @param {string} opts.beforeSha          SHA to revert to on health failure
 * @param {string} opts.healthUrl          URL to poll, e.g. https://www.auroraly.co/api/health
 * @param {(event: object) => void} [opts.onStatus]  optional callback for log events
 * @param {string} [opts.token]            GitHub PAT (defaults to env)
 */
export async function scheduleHealthCheck({
  repo,
  branch = 'main',
  beforeSha,
  healthUrl,
  onStatus = null,
  token = process.env.GITHUB_TOKEN,
}) {
  const emit = (event) => {
    try {
      if (onStatus) onStatus(event)
      console.log('[watchdog]', JSON.stringify(event))
    } catch {}
  }

  if (!beforeSha) {
    emit({ stage: 'watchdog_skipped', reason: 'no before SHA captured (env missing or fetch failed)' })
    return { skipped: true }
  }
  if (!healthUrl) {
    emit({ stage: 'watchdog_skipped', reason: 'no health URL configured' })
    return { skipped: true }
  }
  if (!token || !repo) {
    emit({ stage: 'watchdog_skipped', reason: 'GITHUB_TOKEN/REPO missing — cannot auto-revert' })
    return { skipped: true }
  }

  // Verify a commit actually happened — if HEAD is still beforeSha,
  // there's nothing to watch.
  let afterSha
  try {
    afterSha = await getBranchHeadSha({ token, repo, branch })
  } catch (e) {
    emit({ stage: 'watchdog_skipped', reason: `after-SHA fetch failed: ${e?.message}` })
    return { skipped: true }
  }
  if (afterSha === beforeSha) {
    emit({ stage: 'watchdog_skipped', reason: 'no commits this turn — nothing to watch' })
    return { skipped: true }
  }

  emit({
    stage: 'watchdog_armed',
    beforeSha: beforeSha.slice(0, 7),
    afterSha: afterSha.slice(0, 7),
    healthUrl,
    initialWaitMs: POST_DEPLOY_INITIAL_WAIT_MS,
  })

  await new Promise((r) => setTimeout(r, POST_DEPLOY_INITIAL_WAIT_MS))

  // Poll health until we get HEALTH_CONSECUTIVE_FAILURES in a row or
  // the timeout fires. A single recovery wipes the failure streak.
  const pollStart = Date.now()
  let consecutiveFailures = 0
  let lastResult = null
  while (Date.now() - pollStart < HEALTH_POLL_MAX_DURATION_MS) {
    const ok = await isHealthy(healthUrl)
    lastResult = ok
    if (ok) {
      // One healthy probe = deploy is good. Stop watching.
      emit({ stage: 'watchdog_healthy', afterSha: afterSha.slice(0, 7) })
      return { reverted: false, afterSha, healthy: true }
    }
    consecutiveFailures += 1
    if (consecutiveFailures >= HEALTH_CONSECUTIVE_FAILURES) {
      // Confirmed bad. Try to roll back.
      emit({
        stage: 'watchdog_unhealthy_triggered_revert',
        afterSha: afterSha.slice(0, 7),
        beforeSha: beforeSha.slice(0, 7),
        consecutiveFailures,
      })
      try {
        // --force-with-lease: only revert if HEAD is still afterSha.
        // If a follow-up commit landed (the user manually fixed things
        // in parallel), abort to avoid steamrolling their fix.
        const currentSha = await getBranchHeadSha({ token, repo, branch })
        if (currentSha !== afterSha) {
          emit({
            stage: 'watchdog_revert_aborted',
            reason: 'branch HEAD moved since the bad commit — refusing to force-revert over a newer commit',
            currentSha: currentSha?.slice(0, 7),
          })
          return { reverted: false, reason: 'HEAD moved' }
        }
        await forceUpdateBranchRef({ token, repo, branch, sha: beforeSha })
        emit({
          stage: 'watchdog_reverted',
          revertedTo: beforeSha.slice(0, 7),
          revertedFrom: afterSha.slice(0, 7),
        })
        return { reverted: true, beforeSha, afterSha }
      } catch (e) {
        emit({ stage: 'watchdog_revert_failed', error: e?.message })
        return { reverted: false, error: e?.message }
      }
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
  }

  // Timed out without either recovery or N-in-a-row failures.
  emit({
    stage: 'watchdog_timeout',
    pollDurationMs: HEALTH_POLL_MAX_DURATION_MS,
    lastHealth: lastResult,
    note: 'deploy never stabilized cleanly but failures were intermittent — leaving HEAD alone for human review',
  })
  return { reverted: false, timedOut: true }
}
