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

export default function ServerPreview({ projectId, projectName }) {
  const [status, setStatus] = useState('idle') // idle | starting | ready | error | stopped
  const [previewUrl, setPreviewUrl] = useState(null)
  const [machineId, setMachineId] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])
  const [iframeKey, setIframeKey] = useState(0)
  const eventSourceRef = useRef(null)
  const cancelledRef = useRef(false)

  const start = useCallback(async () => {
    cancelledRef.current = false
    setStatus('starting')
    setError(null)
    setLogs([])
    try {
      const res = await authFetch(`/api/previews/${projectId}/start`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || `start failed (${res.status})`)
      if (cancelledRef.current) return
      setMachineId(body.machineId)
      setPreviewUrl(body.previewUrl)
      setStatus('ready')
      setIframeKey(k => k + 1) // force iframe reload
    } catch (err) {
      if (cancelledRef.current) return
      setError(err.message)
      setStatus('error')
    }
  }, [projectId])

  const stop = useCallback(async () => {
    cancelledRef.current = true
    setStatus('stopped')
    try {
      await authFetch(`/api/previews/${projectId}/stop`, { method: 'POST' })
    } catch { /* best-effort */ }
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
      {/* status bar */}
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/30 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-white/70" data-testid="server-preview-status">
            {statusLabel(status, projectName)}
          </span>
          {previewUrl && status === 'ready' && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-1 truncate text-white/40 hover:text-white/80"
              data-testid="server-preview-url"
            >
              {previewUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'error' && (
            <Button size="sm" variant="ghost" onClick={start} data-testid="server-preview-retry">
              Retry
            </Button>
          )}
          {(status === 'ready' || status === 'starting') && (
            <Button size="sm" variant="ghost" onClick={() => setIframeKey(k => k + 1)} data-testid="server-preview-refresh">
              Refresh
            </Button>
          )}
          {(status === 'ready' || status === 'starting') && (
            <Button size="sm" variant="ghost" onClick={stop} data-testid="server-preview-stop">
              Stop
            </Button>
          )}
          {(status === 'idle' || status === 'stopped' || status === 'error') && (
            <Button size="sm" onClick={start} data-testid="server-preview-start">
              Start
            </Button>
          )}
        </div>
      </div>

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
          />
        )}
        {status !== 'ready' && (
          <div className="flex h-full w-full items-center justify-center bg-black/20 p-6 text-center text-sm text-white/60">
            {status === 'starting' && (
              <div data-testid="server-preview-spinner">
                <div className="mb-2 text-base text-white/80">Starting your preview…</div>
                <div className="text-xs text-white/40">
                  First boot installs dependencies — this can take 1–2 minutes.<br />
                  Subsequent starts are usually under 10 seconds.
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

      {/* log drawer (always-visible bottom strip) */}
      <details className="border-t border-white/5 bg-black/40 text-xs" data-testid="server-preview-logs-drawer">
        <summary className="cursor-pointer select-none px-3 py-1.5 text-white/50 hover:text-white/80">
          Terminal &middot; {logs.length} lines
        </summary>
        <pre className="max-h-64 overflow-auto bg-black/70 p-3 font-mono text-[11px] leading-snug text-white/70" data-testid="server-preview-logs">
          {logs.length === 0
            ? '(no output yet)'
            : logs.map((l, i) => (
                <div key={i} className={l.stream === 'dev' ? 'text-emerald-300/80' : l.stream === 'install' ? 'text-amber-300/70' : 'text-white/50'}>
                  {l.line}
                </div>
              ))}
        </pre>
      </details>
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
