// ──────────────────────────────────────────────────────────────────────
// Fly Machines REST client
// ──────────────────────────────────────────────────────────────────────
// Thin wrapper over Fly's Machines API. The orchestrator uses this to
// boot/stop/exec on a machine per preview-project.
//
// API ref: https://fly.io/docs/machines/api/
// We use only what we need; no SDK deps to keep the bundle lean.

const FLY_API_BASE = 'https://api.machines.dev/v1'

function getEnv() {
  const token = process.env.FLY_API_TOKEN
  const app = process.env.FLY_PREVIEW_APP_NAME
  const region = process.env.FLY_REGION || 'iad'
  if (!token) throw new Error('FLY_API_TOKEN missing — preview infra not configured')
  if (!app) throw new Error('FLY_PREVIEW_APP_NAME missing — preview infra not configured')
  return { token, app, region }
}

async function flyFetch(path, init = {}) {
  const { token } = getEnv()
  const res = await fetch(`${FLY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = typeof body === 'string' ? body : (body?.error || JSON.stringify(body))
    throw new Error(`fly ${init.method || 'GET'} ${path} → ${res.status}: ${msg}`)
  }
  return body
}

// ─── machine lookup ──────────────────────────────────────────────────
export async function listMachines() {
  const { app } = getEnv()
  return flyFetch(`/apps/${app}/machines`)
}

/**
 * Find the machine assigned to a project. We tag each machine with
 * `metadata.auroraly_project_id` at creation time and look it up by tag.
 * Returns null if no machine exists yet.
 */
export async function findMachineForProject(projectId) {
  const machines = await listMachines()
  return machines.find(m => m?.config?.metadata?.auroraly_project_id === projectId) || null
}

// ─── resolve current deployed image ──────────────────────────────────
// Fly tags every `flyctl deploy` as `deployment-<ULID>`, not `:latest`,
// so we can't hardcode a tag. Instead, look at any existing machine's
// config (the template machine left over from `fly deploy` is enough)
// and reuse its image. Fallback: fetch the app's latest release.
export async function resolveDeployedImage() {
  const { app } = getEnv()
  const machines = await listMachines()
  const withImage = machines.find(m => m?.config?.image && m.config.image !== '')
  if (withImage) return withImage.config.image
  // Fallback: hit the releases API.
  try {
    const releases = await flyFetch(`/apps/${app}/releases`)
    const latest = Array.isArray(releases) ? releases[0] : releases?.[0]
    if (latest?.image_ref) {
      const r = latest.image_ref
      // image_ref shape: {registry, repository, tag}
      return `${r.registry}/${r.repository}:${r.tag}`
    }
  } catch { /* no-op */ }
  throw new Error(`no deployed image found for app ${app} — run \`fly deploy\` first`)
}

// ─── boot a fresh machine for a project ──────────────────────────────
export async function createMachineForProject(projectId, sharedSecret) {
  const { app, region } = getEnv()
  const image = await resolveDeployedImage()
  const body = {
    region,
    config: {
      image,
      auto_destroy: false, // we manage lifecycle, not Fly
      restart: { policy: 'no' },
      env: {
        RUNNER_SHARED_SECRET: sharedSecret,
        AURORALY_PROJECT_ID: projectId,
      },
      services: [
        {
          ports: [
            { port: 80, handlers: ['http'], force_https: true },
            { port: 443, handlers: ['tls', 'http'] },
          ],
          protocol: 'tcp',
          internal_port: 3000,
        },
        {
          ports: [{ port: 8443, handlers: ['tls', 'http'] }],
          protocol: 'tcp',
          internal_port: 8080,
        },
      ],
      guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 },
      metadata: {
        auroraly_project_id: projectId,
        // Used by the listing UI / cleanup jobs.
        auroraly_kind: 'preview-runner',
      },
    },
  }
  return flyFetch(`/apps/${app}/machines`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ─── start/stop/wait ─────────────────────────────────────────────────
export async function startMachine(machineId) {
  const { app } = getEnv()
  return flyFetch(`/apps/${app}/machines/${machineId}/start`, { method: 'POST' })
}

export async function stopMachine(machineId) {
  const { app } = getEnv()
  return flyFetch(`/apps/${app}/machines/${machineId}/stop`, { method: 'POST' })
}

export async function waitForMachineState(machineId, state = 'started', timeoutMs = 60_000) {
  const { app } = getEnv()
  // Fly caps the wait endpoint at 60s. Loop if the caller asks for longer.
  const perCallSecs = Math.min(60, Math.max(1, Math.ceil(timeoutMs / 1000)))
  const totalSecs = Math.ceil(timeoutMs / 1000)
  const startedAt = Date.now()
  let last
  for (let elapsed = 0; elapsed < totalSecs; elapsed += perCallSecs) {
    const remaining = Math.min(perCallSecs, totalSecs - elapsed)
    const url = `/apps/${app}/machines/${machineId}/wait?state=${encodeURIComponent(state)}&timeout=${remaining}`
    try {
      last = await flyFetch(url)
      if (last?.ok) return last
    } catch (err) {
      // Fly returns 408 on timeout — retry the next interval.
      if (!String(err.message || '').match(/408|timeout/i)) throw err
    }
    if (Date.now() - startedAt >= timeoutMs) break
  }
  return last || { ok: false, reason: 'wait timeout' }
}

export async function deleteMachine(machineId) {
  const { app } = getEnv()
  return flyFetch(`/apps/${app}/machines/${machineId}?force=true`, { method: 'DELETE' })
}

// ─── public hostnames for the iframe ─────────────────────────────────
/**
 * The user-facing dev-server URL. Fly auto-issues per-subdomain certs the
 * first time someone hits it, so adding `<projectId>.preview.auroraly.co`
 * as a CNAME → <app>.fly.dev is enough.
 */
export function publicDevUrl(projectId) {
  const base = process.env.PREVIEW_BASE_DOMAIN || 'preview.auroraly.co'
  return `https://${projectId}.${base}`
}

/**
 * Direct Fly hostname (skips DNS) — used as a fallback while DNS is
 * propagating or as a debug probe target. Fly assigns
 * `<machine-id>.vm.<app>.internal` for 6PN and `<app>.fly.dev` for
 * external traffic.
 */
export function flyDirectUrl(_machineId) {
  const { app } = getEnv()
  return `https://${app}.fly.dev`
}

/**
 * The orchestrator's control-plane URL into a specific machine. We use
 * Fly's :8443 service which proxies into the runner's :8080. Auth is
 * via the shared secret only the orchestrator + that machine know.
 */
export function machineControlUrl(machineId) {
  const { app } = getEnv()
  // Fly routes by Fly-Force-Instance-Id header — same hostname for the app.
  return {
    url: `https://${app}.fly.dev:8443`,
    headers: { 'Fly-Force-Instance-Id': machineId },
  }
}
