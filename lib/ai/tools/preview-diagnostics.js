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

// ─── run_command_in_preview — execute terminal commands in the preview container ──
// Allows the agent to run deployment commands (firebase deploy, npm run build, etc.)
// in the project's preview environment. Commands run in the same working directory
// as the dev server, with the same environment variables and node_modules.
//
// Security: allowlist of safe command prefixes (npm, firebase, git, etc.) + blocklist
// of destructive patterns (rm -rf, curl to arbitrary URLs, sudo, etc.). 10-minute
// hard timeout. Output truncated to 50KB.
export function runCommandInPreviewTool(projectId) {
  return {
    name: 'run_command_in_preview',
    description: [
      'Execute a terminal command in the project\'s preview container (Fly runner).',
      '',
      'Use this for:',
      '  • Deploying Firebase Functions: firebase deploy --only functions',
      '  • Installing dependencies: npm install <package>',
      '  • Running build scripts: npm run build',
      '  • Git operations: git status, git log, git diff',
      '  • Vercel deployments: vercel deploy',
      '',
      'Security:',
      '  • Allowlist: npm, npx, yarn, pnpm, firebase, vercel, netlify, git (read-only), node, tsc, eslint, prettier, ls, cat, grep, find, pwd, echo',
      '  • Blocklist: rm -rf, curl/wget to URLs, sudo, eval, ssh, scp, rsync',
      '  • Timeout: 10 minutes max',
      '  • Output: truncated to 50KB',
      '',
      `Project: ${projectId || 'unknown'}`,
      '',
      'Returns: { exitCode, stdout, stderr, duration } on success, or error message if command is blocked/fails.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g., "firebase deploy --only functions", "npm install firebase-admin")',
        },
        reason: {
          type: 'string',
          description: 'Why you\'re running this command (for logging). e.g. "deploying Firebase Functions for OAuth", "installing missing dependency"',
        },
        timeout: {
          type: 'integer',
          description: 'Command timeout in seconds (default: 600, max: 600)',
          default: 600,
        },
      },
      required: ['command'],
    },
    async execute({ command, reason, timeout = 600 }) {
      const result = await fetchFromRunner(projectId, '/api/control/run-command', {
        method: 'POST',
        body: { command, reason: reason || 'agent-triggered', timeout },
      })

      if (!result.ok) {
        if (result.reason === 'no-machine') {
          return 'Cannot run command: preview container not running (no machine allocated for this project). Ask the user to click "Start Preview" first.'
        }
        if (result.reason?.startsWith('machine-')) {
          const state = result.reason.replace('machine-', '')
          return `Cannot run command: preview container not running (machine state: ${state}). Ask the user to click "Start Preview".`
        }
        if (result.reason?.startsWith('runner-403')) {
          // Extract the error message from the runner's 403 response
          const match = result.reason.match(/runner-403:\s*(.+)/)
          const msg = match ? match[1] : 'command blocked by security policy'
          return [
            `Command blocked: ${msg}`,
            '',
            'The preview runner only allows safe commands (npm, firebase, git read-only, etc.) and blocks destructive patterns (rm -rf, curl to URLs, sudo, etc.).',
            '',
            `Command: ${command}`,
          ].join('\n')
        }
        if (result.reason?.startsWith('runner-404')) {
          return [
            'Preview runner does not support /api/control/run-command yet.',
            'This endpoint was added on 2025-01-XX. The runner image may be stale.',
            'Ask the user to click "Hard Reset → Start Preview" to pull the latest runner image.',
          ].join('\n')
        }
        return `Failed to run command: ${result.reason}`
      }

      const data = result.data || {}
      const lines = []
      
      if (data.exitCode === 0) {
        lines.push(`✅ Command succeeded (exit code 0, ${data.duration}ms)`)
      } else {
        lines.push(`❌ Command failed (exit code ${data.exitCode}, ${data.duration}ms)`)
      }
      
      lines.push(`Command: ${data.command || command}`)
      if (reason) lines.push(`Reason: ${reason}`)
      lines.push('')
      
      if (data.stdout && data.stdout.trim()) {
        lines.push('STDOUT:')
        lines.push(data.stdout.trim())
        lines.push('')
      }
      
      if (data.stderr && data.stderr.trim()) {
        lines.push('STDERR:')
        lines.push(data.stderr.trim())
        lines.push('')
      }
      
      if (!data.stdout?.trim() && !data.stderr?.trim()) {
        lines.push('(no output)')
      }
      
      return lines.join('\n')
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
