// ──────────────────────────────────────────────────────────────────────
// Preview diagnostic tools for project-scoped agents
// ──────────────────────────────────────────────────────────────────────
// Expose runtime state from the Fly preview runner so agents can diagnose
// blank-screen bugs without asking users to manually copy-paste logs.
//
// Three tools:
//   • get_preview_logs — stdout/stderr from the dev server (Vite/CRA/etc)
//   • get_browser_console — console.error/warn from the preview iframe
//   • get_network_log — HTTP requests from the preview iframe (404s, CORS, etc)
//
// All three hit the preview runner's control-plane endpoints (port 8443)
// and return structured data. Failures are graceful — if the runner is
// stopped or the endpoint doesn't exist yet, the tool returns a clear
// message instead of throwing.

import {
  findMachineForProject,
  machineControlUrl,
} from '@/lib/fly/machines.js'

/** Same derivation as notify-preview.js. Keep in lockstep. */
function projectRunnerSecret(projectId) {
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

/**
 * Best-effort fetch to the preview runner's control plane. Returns
 * { ok: true, data } on success, { ok: false, reason } on failure.
 * Never throws — all errors are surfaced as structured results.
 */
async function fetchFromRunner(projectId, endpoint, opts = {}) {
  if (!projectId) return { ok: false, reason: 'no-project-id' }

  // If Fly isn't configured (local dev, test runs), no-op silently.
  if (!process.env.FLY_API_TOKEN || !process.env.FLY_PREVIEW_APP_NAME) {
    return { ok: false, reason: 'fly-not-configured' }
  }

  let machine
  try {
    machine = await findMachineForProject(projectId)
  } catch (err) {
    return { ok: false, reason: 'machine-lookup-failed: ' + (err?.message || 'unknown') }
  }

  // No machine = preview hasn't been started for this project
  if (!machine) return { ok: false, reason: 'no-machine' }
  if (machine.state !== 'started') {
    return { ok: false, reason: 'machine-' + machine.state, machineId: machine.id }
  }

  const secret = projectRunnerSecret(projectId)
  const { url, headers } = machineControlUrl(machine.id)

  try {
    // 5-second cap so a slow runner never blocks the agent loop
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(`${url}${endpoint}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Auroraly-Secret': secret,
        ...headers,
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, reason: `runner-${res.status}: ${text.slice(0, 200)}`, machineId: machine.id }
    }

    const data = await res.json().catch(() => null)
    return { ok: true, data, machineId: machine.id }
  } catch (err) {
    return { ok: false, reason: 'fetch-failed: ' + (err?.message || 'unknown'), machineId: machine.id }
  }
}

/**
 * get_preview_logs — fetch stdout/stderr from the preview container.
 * Returns the last N lines of dev server output (Vite/CRA/Next.js logs).
 */
export function getPreviewLogsTool(projectId) {
  return {
    name: 'get_preview_logs',
    description: [
      'Fetch the last N lines of stdout/stderr from the preview container (Docker/Fly runner).',
      'Use this to check if Vite crashed, see module resolution errors, verify "VITE v5.x.x ready in XXXms" message.',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Last N lines of dev server output. If the preview container is not running, returns "Preview container not running" (not a failure — just info).',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        lines: {
          type: 'integer',
          description: 'Number of lines to return (default 100)',
          default: 100,
        },
      },
      required: [],
    },
    async execute({ lines = 100 }) {
      const result = await fetchFromRunner(projectId, '/api/diagnostics/logs', {
        method: 'POST',
        body: { lines },
      })

      if (!result.ok) {
        if (result.reason === 'no-machine') {
          return 'Preview container not running (no machine allocated for this project).'
        }
        if (result.reason?.startsWith('machine-')) {
          const state = result.reason.replace('machine-', '')
          return `Preview container not running (machine state: ${state}).`
        }
        if (result.reason?.startsWith('runner-404')) {
          return [
            'Preview runner does not support /api/diagnostics/logs yet.',
            'This endpoint was added on 2025-01-XX. The runner image may be stale.',
            'Ask the user to click "Hard Reset → Start Preview" to pull the latest runner image.',
          ].join('\n')
        }
        return `Failed to fetch logs: ${result.reason}`
      }

      const logs = result.data?.logs || []
      if (logs.length === 0) {
        return 'No logs available (dev server may not have started yet).'
      }

      return [
        `Preview logs (last ${logs.length} lines):`,
        '',
        ...logs,
      ].join('\n')
    },
  }
}

/**
 * get_browser_console — fetch console.error/warn from the preview iframe.
 * Captured server-side via injected logger script or CDP.
 */
export function getBrowserConsoleTool(projectId) {
  return {
    name: 'get_browser_console',
    description: [
      'Fetch console messages from the preview iframe, captured server-side.',
      'Use this to see React errors, import failures, runtime exceptions (e.g., "Uncaught ReferenceError: App is not defined").',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Console messages (error/warn/all) from the preview iframe. Empty array if no console access or no errors.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['error', 'warn', 'all'],
          description: 'Filter by log level (default: error)',
          default: 'error',
        },
        since: {
          type: 'string',
          description: 'ISO timestamp — only return messages after this time (default: last 5 minutes)',
        },
      },
      required: [],
    },
    async execute({ level = 'error', since }) {
      const result = await fetchFromRunner(projectId, '/api/diagnostics/console', {
        method: 'POST',
        body: { level, since },
      })

      if (!result.ok) {
        if (result.reason === 'no-machine') {
          return 'Preview container not running (no machine allocated for this project).'
        }
        if (result.reason?.startsWith('machine-')) {
          const state = result.reason.replace('machine-', '')
          return `Preview container not running (machine state: ${state}).`
        }
        if (result.reason?.startsWith('runner-404')) {
          return [
            'Preview runner does not support /api/diagnostics/console yet.',
            'This endpoint was added on 2025-01-XX. The runner image may be stale.',
            'Ask the user to click "Hard Reset → Start Preview" to pull the latest runner image.',
          ].join('\n')
        }
        return `Failed to fetch console: ${result.reason}`
      }

      const messages = result.data?.messages || []
      if (messages.length === 0) {
        return `No ${level} messages in the browser console (last 5 minutes).`
      }

      return [
        `Browser console (${level}, ${messages.length} messages):`,
        '',
        ...messages.map((m) => {
          const ts = m.timestamp ? new Date(m.timestamp).toISOString() : 'unknown'
          const lvl = m.level || 'log'
          const msg = m.message || '(empty)'
          const loc = m.source ? ` (${m.source})` : ''
          return `[${ts}] ${lvl.toUpperCase()}: ${msg}${loc}`
        }),
      ].join('\n')
    },
  }
}

/**
 * get_network_log — fetch HTTP requests from the preview iframe.
 * Captured server-side via injected fetch/XHR interceptor or CDP.
 */
export function getNetworkLogTool(projectId) {
  return {
    name: 'get_network_log',
    description: [
      'Fetch recent HTTP requests from the preview iframe (URL, status code, timing).',
      'Use this to diagnose 404s on assets, CORS failures, failed API calls.',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Recent HTTP requests. Empty array if no network access or no failed requests.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['errors', 'all'],
          description: 'Filter by status (errors = 4xx/5xx only, all = everything). Default: errors',
          default: 'errors',
        },
        since: {
          type: 'string',
          description: 'ISO timestamp — only return requests after this time (default: last 5 minutes)',
        },
      },
      required: [],
    },
    async execute({ filter = 'errors', since }) {
      const result = await fetchFromRunner(projectId, '/api/diagnostics/network', {
        method: 'POST',
        body: { filter, since },
      })

      if (!result.ok) {
        if (result.reason === 'no-machine') {
          return 'Preview container not running (no machine allocated for this project).'
        }
        if (result.reason?.startsWith('machine-')) {
          const state = result.reason.replace('machine-', '')
          return `Preview container not running (machine state: ${state}).`
        }
        if (result.reason?.startsWith('runner-404')) {
          return [
            'Preview runner does not support /api/diagnostics/network yet.',
            'This endpoint was added on 2025-01-XX. The runner image may be stale.',
            'Ask the user to click "Hard Reset → Start Preview" to pull the latest runner image.',
          ].join('\n')
        }
        return `Failed to fetch network log: ${result.reason}`
      }

      const requests = result.data?.requests || []
      if (requests.length === 0) {
        return filter === 'errors'
          ? 'No failed HTTP requests (last 5 minutes).'
          : 'No HTTP requests captured (last 5 minutes).'
      }

      return [
        `Network log (${filter}, ${requests.length} requests):`,
        '',
        ...requests.map((r) => {
          const ts = r.timestamp ? new Date(r.timestamp).toISOString() : 'unknown'
          const status = r.status || '???'
          const method = r.method || 'GET'
          const url = r.url || '(unknown)'
          const timing = r.timing ? ` (${r.timing}ms)` : ''
          return `[${ts}] ${method} ${url} → ${status}${timing}`
        }),
      ].join('\n')
    },
  }
}
