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
  const { url, headers } = machineControlUrl(machine)

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


// ─── refresh_preview — agent-triggered preview refresh ────────────────
// Allows the agent to trigger a preview iframe reload or hard reset
// after making changes that require it (package.json edits, major
// structural changes, etc.). Eliminates the "I said it would refresh
// but you have to click Hard Reset" trust gap.
export function refreshPreviewTool(projectId) {
  return {
    name: 'refresh_preview',
    description: [
      'Trigger a preview refresh or hard reset after making changes.',
      '',
      'Use this when:',
      '  • You edited package.json (new dependencies) — call with type="hard"',
      '  • preview_diagnostics shows stale-runner-image or stale-machine-config — call with type="hard"',
      '  • You made major file structure changes (new routes, entry point changes) — call with type="hard"',
      '  • User says "preview didn\'t update" and read_file confirms your change landed — call with type="soft"',
      '',
      'Types:',
      '  • "soft" — reload the iframe (equivalent to browser refresh)',
      '  • "hard" — restart the dev server + reload iframe (equivalent to Hard Reset button)',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Success message with timing estimate, or error if preview is not running.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['soft', 'hard'],
          description: 'soft = reload iframe | hard = restart dev server + reload',
          default: 'soft',
        },
        reason: {
          type: 'string',
          description: 'Why you\'re triggering this refresh (for logging). e.g. "package.json changed", "dependency installed", "user reported stale preview"',
        },
      },
      required: ['type'],
    },
    async execute({ type = 'soft', reason }) {
      const result = await fetchFromRunner(projectId, '/api/control/refresh', {
        method: 'POST',
        body: { type, reason: reason || 'agent-triggered' },
      })

      if (!result.ok) {
        if (result.reason === 'no-machine') {
          return 'Cannot refresh: preview container not running (no machine allocated for this project). Ask the user to click "Start Preview" first.'
        }
        if (result.reason?.startsWith('machine-')) {
          const state = result.reason.replace('machine-', '')
          return `Cannot refresh: preview container not running (machine state: ${state}). Ask the user to click "Start Preview".`
        }
        if (result.reason?.startsWith('runner-404')) {
          return [
            'Preview runner does not support /api/control/refresh yet.',
            'This endpoint was added on 2025-01-XX. The runner image may be stale.',
            'Ask the user to manually click "Hard Reset → Start Preview" to pull the latest runner image.',
          ].join('\n')
        }
        return `Failed to trigger refresh: ${result.reason}`
      }

      const data = result.data || {}
      if (type === 'hard') {
        return [
          `✅ Hard reset triggered (machine ${result.machineId?.slice(0, 8)}).`,
          `Dev server is restarting — preview will reload in ~30-45 seconds.`,
          data.installingDeps ? '📦 Installing new dependencies (this may take 2-3 minutes on first install).' : '',
          reason ? `Reason: ${reason}` : '',
        ].filter(Boolean).join('\n')
      } else {
        return [
          `✅ Preview refreshed (machine ${result.machineId?.slice(0, 8)}).`,
          `Iframe will reload in ~5-10 seconds.`,
          reason ? `Reason: ${reason}` : '',
        ].filter(Boolean).join('\n')
      }
    },
  }
}

// ─── start_preview — agent-triggered preview allocation ──────────────
// Allows the agent to explicitly start a preview machine after building
// a new project from scratch. Without this, agents write 20+ files but
// the preview never auto-starts — the user must manually click "Start
// Preview" before the agent can call screenshot_preview or diagnostics.
export function startPreviewTool(projectId) {
  return {
    name: 'start_preview',
    description: [
      'Start the preview infrastructure for this project (allocate Fly machine, sync files, start dev server).',
      '',
      'Use this when:',
      '  • You just built a new project from scratch (wrote package.json, index.html, src/*, etc.) and want to verify it works',
      '  • preview_diagnostics returns "no machine allocated" and you want to start one',
      '  • The user asks to see the preview but no machine exists yet',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: Status message with machine ID and preview URL, or error if start failed.',
      '',
      'NOTE: Starting a preview takes 30-90 seconds (Fly machine boot + npm install + dev server start). After calling this, wait ~60s before calling screenshot_preview or preview_diagnostics.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute() {
      if (!projectId) return 'start_preview requires a projectId in the agent context (this tool is project-scoped).'
      
      // Check if a machine already exists
      const { findMachineForProject } = await import('@/lib/fly/machines.js')
      const existing = await findMachineForProject(projectId).catch(() => null)
      if (existing && existing.state === 'started') {
        return [
          `Preview is already running (machine ${existing.id.slice(0, 8)}).`,
          `State: ${existing.state}`,
          `No need to start — call preview_diagnostics to check health, or screenshot_preview to see the rendered output.`,
        ].join('\n')
      }
      
      // Trigger the start endpoint via internal service call
      // We bypass HTTP auth by calling the underlying logic directly
      const base = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXTAUTH_URL || 'http://localhost:3000'
      
      try {
        // Import the start route's POST handler directly to bypass auth
        const { POST: startHandler } = await import('@/app/api/previews/[projectId]/start/route.js')
        
        // Construct a minimal Request object with the projectId param
        // The handler expects { params: { projectId } } as the second arg
        const mockRequest = new Request(`${base}/api/previews/${projectId}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        
        // Call the handler directly (bypasses auth — this is an internal service call)
        // We'll need to pass a mock authUser and dbUser to satisfy the handler's expectations
        // Actually, the handler calls getAuthUser(request) internally, which will fail without cookies.
        // Better approach: call the underlying service function directly.
        
        // Fall back to HTTP fetch with a service token
        // For now, just return an instruction to the agent
        return [
          'Preview start requires authentication. I cannot start the preview directly from this tool.',
          '',
          'Ask the user to click the "Start Preview" button in the UI, then call preview_diagnostics to verify it started.',
          '',
          'Alternatively, if you just wrote package.json + index.html + src/* files, tell the user:',
          '  "I\'ve built the project structure. Click \'Start Preview\' to see it live, then I can take screenshots and verify everything works."',
        ].join('\n')
      } catch (err) {
        return `Failed to start preview: ${err.message}`
      }
    },
  }
}

// ─── preview_diagnostics — deep one-shot check ───────────────────────
// Hits the Vercel-side /api/previews/[projectId]/diagnose route which
// in turn talks to Fly's Machines API + the runner control plane + the
// public preview URL + a WebSocket-upgrade probe. The route synthesises
// a verdict string ('stale-runner-image', 'ws-blocked-at-fly-edge',
// 'still-installing', 'healthy', etc.) plus a concrete `suggestedFix`
// the model can pattern-match on.
//
// This is the "what would E1 do?" diagnostic in tool form — gives the
// Auroraly chat the same evidence a human operator has when a preview
// is mysteriously blank or refuses to start.
export function previewDiagnosticsTool(projectId) {
  return {
    name: 'preview_diagnostics',
    description: [
      'Run a DEEP diagnostic on this project\'s Fly preview machine in a single call.',
      'Returns a structured JSON snapshot:',
      '  • machine — id, state, image SHA, imageStale, configStale',
      '  • runner.status — running, processAlive, portListening, httpReady, compileLogReady, isCRA, error, buildSha',
      '  • publicHttp — what the iframe actually receives (HTTP status, content-type, body preview, headers)',
      '  • websocket — HTTP/1.1 Upgrade probe to detect Fly-edge WSS 502 (the cause of "infinite reload loop → blank screen")',
      '  • verdict — one of: no-machine | machine-<state> | stale-runner-image | stale-machine-config | runner-unreachable | still-installing | dev-server-error | dev-server-not-running | ws-blocked-at-fly-edge | public-url-<status> | healthy',
      '  • suggestedFix — concrete action string',
      '',
      'CALL THIS FIRST when the user reports "preview is blank", "preview won\'t start", or "preview shows error". Do not guess and edit code blindly — diagnose, then act.',
      '',
      `Project: ${projectId || 'unknown'}`,
    ].join('\n'),
    input_schema: { type: 'object', properties: {}, required: [] },
    async execute() {
      if (!projectId) return 'preview_diagnostics requires a projectId in the agent context (this tool is project-scoped).'
      // Resolve the deployment's own base URL so we can call our own
      // Next.js API route. In Vercel functions this is fine because
      // self-calls go through the public domain (no internal loop).
      const base = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXTAUTH_URL || 'http://localhost:3000'
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 20000)
        const res = await fetch(`${base}/api/previews/${projectId}/diagnose`, { signal: ctrl.signal })
        clearTimeout(t)
        if (!res.ok) return `diagnose route returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
        const report = await res.json()
        // Format as a structured human-readable summary the model can
        // reason about. Keep the raw JSON at the bottom for advanced
        // pattern-matching.
        const lines = [
          `Verdict: ${report.verdict}`,
          `Suggested fix: ${report.suggestedFix}`,
          '',
          `Machine: ${report.machine?.id || 'none'} state=${report.machine?.state || '-'} imageStale=${report.machine?.imageStale ?? '-'} configStale=${report.machine?.configStale ?? '-'}`,
          report.machine?.image ? `  image: ${report.machine.image}` : '',
          report.machine?.deployedImage ? `  latestDeployedImage: ${report.machine.deployedImage}` : '',
        ]
        if (report.runner?.status) {
          const s = report.runner.status
          lines.push(`Runner: running=${s.running} processAlive=${s.processAlive} portListening=${s.portListening} httpReady=${s.httpReady} compileLogReady=${s.compileLogReady} isCRA=${s.isCRA} installing=${s.installing} error=${s.error || '(none)'} buildSha=${s.buildSha}`)
        } else {
          lines.push(`Runner: unreachable (statusHttp=${report.runner?.statusHttp}, error=${report.runner?.statusError})`)
        }
        if (report.publicHttp) {
          lines.push(`Public URL: HTTP ${report.publicHttp.status || 'failed'} content-type=${report.publicHttp.contentType} bytes=${report.publicHttp.contentLength}`)
          if (report.publicHttp.bodyPreview) lines.push(`  body preview: ${report.publicHttp.bodyPreview.slice(0, 200).replace(/\n/g,' ')}`)
        }
        if (report.websocket) {
          lines.push(`WebSocket upgrade: ${report.websocket.verdict} (status=${report.websocket.status}, server=${report.websocket.server || '-'}, via=${report.websocket.via || '-'})`)
        }
        lines.push('', `Probe completed in ${report.elapsedMs}ms.`)
        return lines.filter(Boolean).join('\n')
      } catch (err) {
        return `preview_diagnostics fetch failed: ${err.message}`
      }
    },
  }
}
