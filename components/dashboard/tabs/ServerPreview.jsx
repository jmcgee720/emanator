'use client'

// ──────────────────────────────────────────────────────────────────────
// ServerPreview — Phase 1 of the WebContainer replacement
// ──────────────────────────────────────────────────────────────────────
// Renders an iframe pointing at <projectId>.preview.auroraly.co (a real
// Linux container running the user's dev server on Fly Machines). No
// client-side npm install, no esbuild WASM, no CRA→Vite shim, no postcss
// rename — the project just runs as-is in a real Node environment.
//
// Lifecycle:
//   mount → POST /api/previews/:projectId/start → (cold-start)
//      ↳ Fly boots a machine, npm install runs, dev server spawns
//      ↳ orchestrator returns previewUrl as soon as runner is healthy
//   iframe loads previewUrl, polls until dev server responds
//   unmount or "Stop" button → POST /api/previews/:projectId/stop
// ──────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { authFetch } from '@/lib/auth-fetch'

export default function ServerPreview({ projectId, projectName, onRefreshReady }) {
  const [status, setStatus] = useState('idle') // idle | starting | ready | error | stopped
  const [previewUrl, setPreviewUrl] = useState(null)
  const [machineId, setMachineId] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])
  const [iframeKey, setIframeKey] = useState(0)
  const [drawerOpenOverride, setDrawerOpenOverride] = useState(false)
  // Transient state for the "Copy" button so users see a confirmation
  // flash instead of wondering if the click registered.
  const [copyState, setCopyState] = useState('idle') // idle | copied | failed
  const eventSourceRef = useRef(null)
  const cancelledRef = useRef(false)
  const logsScrollRef = useRef(null)

  // Expose refresh handler to parent via callback
  const handleRefresh = useCallback(() => {
    setIframeKey(k => k + 1)
  }, [])

  // Pull a friendly "currently installing X" hint out of the npm install
  // log stream so the collapsed drawer summary still reflects activity.
  // Real npm output looks like `npm install [50/312] something`. We grab
  // the most recent line that contains a useful verb.
  const lastInstallActivity = (() => {
    if (!Array.isArray(logs) || logs.length === 0) return null
    for (let i = logs.length - 1; i >= 0 && i >= logs.length - 30; i--) {
      const line = (logs[i]?.line || '').trim()
      if (!line) continue
      // Common npm/yarn progress markers we want to surface.
      const m = line.match(/(?:added|installing|fetching|extracting|building|compiling|webpack|babel|esbuild|vite|ready|listening|local:|server)/i)
      if (m) return line.slice(0, 60)
    }
    return null
  })()

  // Auto-scroll the open drawer to the bottom on each new log line so
  // the user always sees the most recent install activity. No-op when
  // collapsed.
  useEffect(() => {
    const el = logsScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs.length])

  const start = useCallback(async () => {
    cancelledRef.current = false
    setStatus('starting')
    setError(null)
    setLogs([])
    try {
      const res = await authFetch(`/api/previews/${projectId}/start`, { method: 'POST' })
      // Defensive parse — if Vercel timed out / returned an HTML error page,
      // res.json() throws "JSON.parse: unexpected character" and the UI
      // shows a useless raw error. Read text first, parse if possible.
      const raw = await res.text()
      let body = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = null }
      if (!res.ok || !body) {
        const snippet = raw?.slice(0, 200)?.replace(/<[^>]+>/g, '').trim() || `(empty body)`
        throw new Error(
          `start request failed (HTTP ${res.status})${
            res.status === 504 ? ' — Vercel timed out. Retrying…' : ''
          }${snippet ? ` · ${snippet}` : ''}`
        )
      }
      if (cancelledRef.current) return
      setMachineId(body.machineId || null)
      setPreviewUrl(body.previewUrl || null)
      // Orchestrator now returns IMMEDIATELY after kicking the runner.
      // We poll GET /start until runner.running === true (or error).
      await pollUntilReady()
      if (cancelledRef.current) return
      setStatus('ready')
      setIframeKey(k => k + 1)
    } catch (err) {
      if (cancelledRef.current) return
      setError(err.message)
      setStatus('error')
    }
  }, [projectId])

  // Poll the orchestrator's GET endpoint every 3s for up to 15 minutes.
  // Heavy CRA imports (Mangia-Mama, 130 files, 50+ deps) routinely take
  // 6-10 minutes on cold boot: npm install --legacy-peer-deps grinding
  // plus react-scripts' initial compile. Vite + Next.js usually <90s.
  // 15 min budget keeps users from getting "failed to start" while a
  // legit install is still progressing — they can also watch the
  // terminal drawer if curious.
  const pollUntilReady = useCallback(async () => {
    const POLL_INTERVAL = 3000
    const MAX_POLLS = 300 // 15 minutes
    for (let i = 0; i < MAX_POLLS; i++) {
      if (cancelledRef.current) return
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      try {
        const r = await authFetch(`/api/previews/${projectId}/start`, { method: 'GET' })
        const txt = await r.text()
        let j = null
        try { j = txt ? JSON.parse(txt) : null } catch {}
        if (!j) continue // transient — keep polling
        if (j.runner?.error) throw new Error(j.runner.error)
        if (j.previewUrl) setPreviewUrl(j.previewUrl)
        if (j.machineId) setMachineId(j.machineId)
        if (j.runner?.running) return // ready
      } catch (err) {
        // Hard error from runner → bubble up
        if (/exited|spawn error|no package\.json/i.test(err.message)) throw err
        // Transient (network blip, runner not yet reachable) → keep polling
      }
    }
    throw new Error('preview never became ready (15 min timeout). Open the terminal drawer to see what npm install is doing.')
  }, [projectId])

  const stop = useCallback(async () => {
    cancelledRef.current = true
    setStatus('stopped')
    try {
      await authFetch(`/api/previews/${projectId}/stop`, { method: 'POST' })
    } catch { /* best-effort */ }
  }, [projectId])

  // Hard reset = destroy the Fly machine outright so the next Start
  // provisions a fresh one with an empty filesystem. Use when files
  // were deleted from Supabase but a stale copy lingers on disk and
  // is breaking the dev server (e.g. an old middleware.js that Next
  // tries to compile and crashes on). After this, click Start again.
  const hardReset = useCallback(async () => {
    cancelledRef.current = true
    setStatus('stopped')
    setLogs(prev => [...prev, { level: 'info', message: '[dashboard] Hard-resetting Fly machine — wait ~10s then click Start.' }])
    try {
      const res = await authFetch(`/api/previews/${projectId}/reset`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setLogs(prev => [...prev, {
        level: res.ok ? 'info' : 'error',
        message: res.ok
          ? `[dashboard] ${data.message || 'Machine destroyed. Click Start to provision a fresh one.'}`
          : `[dashboard] Reset failed: ${data.error || res.status}`,
      }])
    } catch (err) {
      setLogs(prev => [...prev, { level: 'error', message: `[dashboard] Reset error: ${err?.message || 'unknown'}` }])
    }
  }, [projectId])

  // Tail the log stream while running. Reconnects on key bump.
  useEffect(() => {
    if (status !== 'ready' && status !== 'starting') return
    const es = new EventSource(`/api/previews/${projectId}/logs`, { withCredentials: true })
    eventSourceRef.current = es
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data)
        setLogs(prev => {
          const next = [...prev, entry]
          return next.length > 500 ? next.slice(-500) : next
        })
      } catch { /* ignore malformed line */ }
    }
    es.onerror = () => { /* let it auto-reconnect */ }
    return () => { try { es.close() } catch {} }
  }, [projectId, status, iframeKey])

  // Auto-start on mount. Clear stale preview URL when switching projects.
  useEffect(() => {
    // Reset state immediately when projectId changes to prevent showing
    // stale iframe from previous project while new one boots.
    setPreviewUrl(null)
    setMachineId(null)
    setError(null)
    setLogs([])
    start()
    return () => { cancelledRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Expose refresh handler to parent
  useEffect(() => {
    if (onRefreshReady) {
      onRefreshReady(handleRefresh)
    }
  }, [onRefreshReady, handleRefresh])

  return (
    <div className="flex h-full w-full flex-col" data-testid="server-preview">

      {/* Control bar */}
      {status === 'ready' && (
        <div className="flex items-center justify-between border-b border-border/40 bg-background px-3 py-1.5">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <span className="text-xs text-muted-foreground">
              {statusLabel(status, projectName)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs"
              onClick={handleRefresh}
              data-testid="server-preview-refresh"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs text-amber-400 hover:text-amber-300"
              onClick={hardReset}
              data-testid="server-preview-hard-reset"
              title="Destroy the machine and start fresh (fixes corrupted node_modules)"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Hard Reset
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs text-red-400 hover:text-red-300"
              onClick={stop}
              data-testid="server-preview-stop"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </Button>
          </div>
        </div>
      )}

      {/* main area — iframe + collapsed log drawer */}
      <div className="relative min-h-0 flex-1">
        {previewUrl && status === 'ready' && (
          <iframe
            key={iframeKey}
            src={previewUrl}
            className="h-full w-full border-0 bg-white"
            title={`${projectName} preview`}
            data-testid="server-preview-iframe"
            // Reasonable sandbox: allow what dev servers need.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            // ─── COEP fix ─────────────────────────────────────────────
            // The Auroraly dashboard sets COEP=credentialless globally
            // (required by WebContainers). Without `credentialless`
            // here, Firefox blocks the iframe with a "security
            // configuration doesn't match" page, because the user's
            // dev server (CRA, Next, etc) doesn't send CORP headers.
            // The credentialless attribute loads the iframe in a fresh
            // ephemeral context so it doesn't need to match COEP.
            credentialless="true"
            allow="cross-origin-isolated"
          />
        )}
        {status !== 'ready' && (
          <div className="flex h-full w-full items-center justify-center bg-black/20 p-6 text-center text-sm text-white/60">
            {status === 'starting' && (
              <div data-testid="server-preview-spinner" className="w-full max-w-2xl">
                <div className="mb-2 text-base text-white/80 flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                  </svg>
                  Starting your preview…
                </div>
                {lastInstallActivity && (
                  <div className="text-[11px] font-mono text-cyan-300/80 mb-3 truncate" data-testid="server-preview-activity">
                    ▸ {lastInstallActivity}
                  </div>
                )}
                <div className="text-xs text-white/40 mb-4">
                  First boot installs dependencies — usually 1–2 minutes for landing pages,<br />
                  but <strong>5–10 minutes for large imported projects</strong> (CRA, Next.js).<br />
                  Subsequent starts are usually under 10 seconds.
                </div>

                {/* Inline log stream — gives the loading screen a heartbeat so
                    users can see real activity instead of a static message. */}
                {logs.length > 0 && (
                  <div className="mb-4 rounded-lg border border-white/10 bg-black/60 text-left" data-testid="server-preview-inline-logs">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wider text-white/40">
                      <span>Build output · {logs.length} lines</span>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            // Copy the FULL log buffer (not just what's
                            // visible) so users can paste into a chat / issue
                            // without scrolling. Clipboard API requires a
                            // secure context (https) which the dashboard is.
                            const text = logs.map(e => e.line || e.message || '').join('\n')
                            navigator.clipboard?.writeText(text).then(
                              () => { setCopyState('copied'); setTimeout(() => setCopyState('idle'), 1500) },
                              () => { setCopyState('failed'); setTimeout(() => setCopyState('idle'), 1500) },
                            )
                          }}
                          className="text-white/50 hover:text-white normal-case tracking-normal"
                          data-testid="server-preview-copy-logs"
                          title="Copy all build output to clipboard"
                        >
                          {copyState === 'copied' ? '✓ Copied' : copyState === 'failed' ? '✗ Failed' : 'Copy'}
                        </button>
                        <button
                          onClick={() => setDrawerOpenOverride(o => !o)}
                          className="text-cyan-400 hover:text-cyan-300 normal-case tracking-normal"
                          data-testid="server-preview-toggle-logs"
                        >
                          {drawerOpenOverride ? 'Collapse' : 'Expand'}
                        </button>
                      </div>
                    </div>
                    <div
                      ref={logsScrollRef}
                      className={`px-3 py-2 font-mono text-[10px] leading-snug text-white/70 overflow-auto ${drawerOpenOverride ? 'max-h-80' : 'max-h-32'}`}
                    >
                      {logs.slice(drawerOpenOverride ? -300 : -8).map((entry, i) => (
                        <div key={i} className={
                          entry.level === 'error' || /error|ERR!|failed/i.test(entry.line || entry.message || '')
                            ? 'text-red-400'
                            : entry.level === 'warn' || /warn/i.test(entry.line || entry.message || '')
                              ? 'text-amber-400'
                              : (entry.line || entry.message || '').startsWith('[runner]') || (entry.line || entry.message || '').startsWith('[dashboard]') || (entry.line || entry.message || '').startsWith('[sync]')
                                ? 'text-cyan-400/80'
                                : 'text-white/60'
                        }>
                          {entry.line || entry.message || ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-2 justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={stop}
                    data-testid="server-preview-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {status === 'error' && (
              <div data-testid="server-preview-error" className="max-w-lg">
                <div className="mb-2 text-base text-red-300">Preview failed to start</div>
                <pre className="whitespace-pre-wrap rounded bg-black/40 p-3 text-left text-xs text-white/60">
                  {error}
                </pre>
                <div className="mt-4 flex gap-2 justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={start}
                    data-testid="server-preview-retry"
                  >
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs text-amber-400 hover:text-amber-300"
                    onClick={hardReset}
                    data-testid="server-preview-hard-reset-error"
                  >
                    Hard Reset
                  </Button>
                </div>
              </div>
            )}
            {(status === 'idle' || status === 'stopped') && (
              <div>
                <div className="text-white/60 mb-4">Preview stopped.</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={start}
                  data-testid="server-preview-start-btn"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Start Preview
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating logs panel — visible in the 'ready' state so users
          can debug post-boot issues (e.g. dev server crashed AFTER
          startup, or proxy ECONNREFUSED because port-bind is racing
          the iframe load). Without this, the BUILD OUTPUT box vanishes
          the moment status flips to ready, leaving the user blind.
          Closed by default; click the button to expand. */}
      {status === 'ready' && logs.length > 0 && (
        <FloatingLogsPanel logs={logs} />
      )}

      {/* Terminal drawer removed to maximize preview vertical space */}
    </div>
  )
}

function FloatingLogsPanel({ logs }) {
  const [open, setOpen] = useState(false)
  const [copyState, setCopyState] = useState('idle')
  return (
    <div className="absolute bottom-3 right-3 z-20" data-testid="server-preview-floating-logs">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 rounded-md bg-black/60 hover:bg-black/80 border border-white/10 text-[11px] text-white/70 hover:text-white font-mono backdrop-blur-md transition-colors"
          data-testid="server-preview-floating-logs-open"
          title="View runner logs (debug if preview shows ECONNREFUSED or blank)"
        >
          ▸ Logs · {logs.length}
        </button>
      ) : (
        <div className="w-[480px] max-w-[calc(100vw-24px)] rounded-lg border border-white/10 bg-black/85 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wider text-white/40">
            <span>Build output · {logs.length} lines</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const text = logs.map(e => e.line || e.message || '').join('\n')
                  navigator.clipboard?.writeText(text).then(
                    () => { setCopyState('copied'); setTimeout(() => setCopyState('idle'), 1500) },
                    () => { setCopyState('failed'); setTimeout(() => setCopyState('idle'), 1500) },
                  )
                }}
                className="text-white/50 hover:text-white normal-case tracking-normal"
                data-testid="server-preview-floating-logs-copy"
              >
                {copyState === 'copied' ? '✓' : copyState === 'failed' ? '✗' : 'Copy'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-white/50 hover:text-white normal-case tracking-normal"
                data-testid="server-preview-floating-logs-close"
              >
                Close
              </button>
            </div>
          </div>
          <div className="px-3 py-2 font-mono text-[10px] leading-snug text-white/70 overflow-auto max-h-80">
            {logs.slice(-300).map((entry, i) => (
              <div key={i} className={
                /error|ERR!|failed/i.test(entry.line || entry.message || '')
                  ? 'text-red-400'
                  : /warn/i.test(entry.line || entry.message || '')
                    ? 'text-amber-400'
                    : (entry.line || entry.message || '').startsWith('[runner]') || (entry.line || entry.message || '').startsWith('[sync]')
                      ? 'text-cyan-400/80'
                      : 'text-white/60'
              }>
                {entry.line || entry.message || ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }) {
  const color = {
    idle: 'bg-white/40',
    starting: 'bg-amber-400 animate-pulse',
    ready: 'bg-emerald-400',
    error: 'bg-red-400',
    stopped: 'bg-white/40',
  }[status] || 'bg-white/40'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
}

function statusLabel(status, name) {
  switch (status) {
    case 'starting': return `Starting ${name || 'preview'}…`
    case 'ready':    return 'Ready'
    case 'error':    return 'Failed to start'
    case 'stopped':  return 'Stopped'
    default:         return 'Idle'
  }
}
