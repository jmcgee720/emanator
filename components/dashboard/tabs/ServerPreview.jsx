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

  // Auto-start on mount.
  useEffect(() => {
    start()
    return () => { cancelledRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return (
    <div className="flex h-full w-full flex-col" data-testid="server-preview">

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
              <div data-testid="server-preview-spinner">
                <div className="mb-2 text-base text-white/80">Starting your preview…</div>
                <div className="text-xs text-white/40">
                  First boot installs dependencies — usually 1–2 minutes for landing pages,<br />
                  but <strong>5–10 minutes for large imported projects</strong> (CRA, Next.js).<br />
                  Subsequent starts are usually under 10 seconds. Open the terminal drawer to watch progress.
                </div>
              </div>
            )}
            {status === 'error' && (
              <div data-testid="server-preview-error" className="max-w-lg">
                <div className="mb-2 text-base text-red-300">Preview failed to start</div>
                <pre className="whitespace-pre-wrap rounded bg-black/40 p-3 text-left text-xs text-white/60">
                  {error}
                </pre>
              </div>
            )}
            {(status === 'idle' || status === 'stopped') && (
              <div className="text-white/60">
                Preview stopped.{' '}
                <button
                  onClick={start}
                  className="text-white/90 underline hover:text-white"
                  data-testid="server-preview-start-link"
                >
                  Start it
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Terminal drawer removed to maximize preview vertical space */}
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
