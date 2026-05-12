// ──────────────────────────────────────────────────────────────────────
// Notify the Fly preview runner that a project's files have changed
// ──────────────────────────────────────────────────────────────────────
// When the v2 agent edits a project file, the change lands in Supabase
// immediately — but the Fly preview runner (which actually serves the
// `*.preview.auroraly.co` iframe) keeps its own copy of the project on
// disk. Without a poke, that disk copy stays stale and the user sees
// "the AI says it edited the file but the preview never updates".
//
// This helper calls the runner's existing `/sync-from-supabase`
// endpoint, which re-pulls the freshly-updated file (Vite's HMR then
// hot-reloads the page). Failure is silent — preview refresh is a
// nice-to-have, never block the edit response on it.

import {
  findMachineForProject,
  machineControlUrl,
} from './machines.js'

/** Same derivation as the start route. Keep in lockstep. */
function projectRunnerSecret(projectId) {
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

/**
 * Best-effort: tell the running preview machine to re-sync this project
 * from Supabase. Returns a small status object for logging; never throws.
 *
 * @param {string} projectId
 * @returns {Promise<{notified: boolean, reason?: string, machineId?: string}>}
 */
export async function notifyPreviewOfFileChange(projectId) {
  if (!projectId) return { notified: false, reason: 'no-project-id' }

  // If Fly isn't configured (local dev, test runs), no-op silently.
  if (!process.env.FLY_API_TOKEN || !process.env.FLY_PREVIEW_APP_NAME) {
    return { notified: false, reason: 'fly-not-configured' }
  }

  let machine
  try {
    machine = await findMachineForProject(projectId)
  } catch (err) {
    return { notified: false, reason: 'machine-lookup-failed: ' + (err?.message || 'unknown') }
  }

  // No machine = preview hasn't been started for this project, so there
  // is nothing to refresh. The next "Start Preview" click will sync
  // fresh files. Not a failure.
  if (!machine) return { notified: false, reason: 'no-machine' }
  if (machine.state !== 'started') {
    return { notified: false, reason: 'machine-' + machine.state, machineId: machine.id }
  }

  const secret = projectRunnerSecret(projectId)
  const { url, headers } = machineControlUrl(machine.id)

  try {
    // 4-second cap so a slow runner never blocks the chat stream's
    // response back to the user.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${url}/sync-from-supabase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auroraly-Secret': secret,
        ...headers,
      },
      body: JSON.stringify({ projectId }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { notified: false, reason: `runner-${res.status}: ${text.slice(0, 200)}`, machineId: machine.id }
    }
    return { notified: true, machineId: machine.id }
  } catch (err) {
    return { notified: false, reason: 'fetch-failed: ' + (err?.message || 'unknown'), machineId: machine.id }
  }
}
