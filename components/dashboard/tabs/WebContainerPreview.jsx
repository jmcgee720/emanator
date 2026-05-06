import React, { useEffect, useRef, useState, useMemo } from 'react'
import { Loader2, AlertTriangle, Zap, FileCode, ExternalLink, Terminal, ChevronUp, ChevronDown } from 'lucide-react'
import {
  isWebContainerEnabled,
  isWebContainerSupported,
  runDevServer,
  updateFiles,
} from '../../../lib/webcontainer/sandbox.js'

/**
 * WebContainerPreview — real Next.js dev server running in-browser via
 * @webcontainer/api. Used as an experimental alternative to the Babel
 * iframe. Off unless `NEXT_PUBLIC_WEBCONTAINERS_ENABLED=1` AND the host
 * serves cross-origin-isolation headers (COOP/COEP).
 *
 * Lifecycle per mount:
 *   boot  → mount → install → dev → ready (url)
 * File changes trigger hot `updateFiles` calls (no re-install).
 */
export default function WebContainerPreview({ files, viewport = '100%', projectId }) {
  const [stage, setStage] = useState('idle')
  const [stageDetail, setStageDetail] = useState('')
  const [logs, setLogs] = useState([])
  const [url, setUrl] = useState(null)
  const [iframeKey, setIframeKey] = useState(0) // bump to force-reload iframe
  const [showLogs, setShowLogs] = useState(false)
  const [ports, setPorts] = useState([]) // multi-service projects expose extra {port, url}
  const [error, setError] = useState(null)
  const stopRef = useRef(null)
  const mountedOnceRef = useRef(false)
  const lastHashRef = useRef('')
  const logScrollRef = useRef(null)

  const enabled = isWebContainerEnabled()
  const supported = isWebContainerSupported()

  // Stable hash so we only hot-update when content actually changes.
  const filesHash = useMemo(() => {
    if (!Array.isArray(files)) return ''
    return files
      .map((f) => `${f.path}:${typeof f.content === 'string' ? f.content.length : 0}`)
      .sort()
      .join('|')
  }, [files])

  useEffect(() => {
    if (!enabled || !supported) return
    if (!files?.length) return
    if (mountedOnceRef.current) return
    mountedOnceRef.current = true

    setStage('boot')
    setError(null)
    setPorts([])

    runDevServer(files, {
      projectId,
      onStage: (s, detail) => {
        setStage(s)
        if (detail) setStageDetail(detail)
      },
      onLog: (line) => {
        setLogs((prev) => [...prev.slice(-199), line])
      },
      onReady: (readyUrl) => {
        setUrl(readyUrl)
        setStage('ready')
        // Next.js dev binds the port BEFORE first compile finishes — the
        // initial iframe load can hit a not-yet-compiled page and stay blank.
        // Soft-reload the iframe once after a short delay so the user always
        // sees the first render without manually clicking Refresh.
        setTimeout(() => setIframeKey((k) => k + 1), 4500)
      },
      onPort: (port, portUrl) => {
        setPorts((prev) => prev.some((p) => p.port === port) ? prev : [...prev, { port, url: portUrl }])
      },
      onError: (err) => {
        setError(err?.message || String(err))
        setStage('error')
      },
    })
      .then(({ stop }) => { stopRef.current = stop })
      .catch((err) => {
        setError(err?.message || String(err))
        setStage('error')
      })

    return () => {
      if (stopRef.current) stopRef.current().catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, supported])

  // Hot-update when files change after initial mount.
  useEffect(() => {
    if (!mountedOnceRef.current || stage !== 'ready') return
    if (!filesHash || filesHash === lastHashRef.current) return
    lastHashRef.current = filesHash
    updateFiles(files).catch((err) => {
      console.warn('[WebContainerPreview] update failed', err)
    })
  }, [filesHash, stage, files])

  if (!enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-2 px-6 text-center" data-testid="wc-disabled">
        <Zap className="w-6 h-6 opacity-40" />
        <p className="text-sm">WebContainer preview is off.</p>
        <p className="text-[11px] opacity-70 max-w-xs">
          Enable by setting <code className="px-1 rounded bg-muted/50">NEXT_PUBLIC_WEBCONTAINERS_ENABLED=1</code> and serving COOP/COEP headers on the preview route.
        </p>
      </div>
    )
  }

  if (!supported) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-2 px-6 text-center" data-testid="wc-unsupported">
        <AlertTriangle className="w-6 h-6 opacity-60 text-amber-400" />
        <p className="text-sm">Cross-origin isolation unavailable.</p>
        <p className="text-[11px] opacity-70 max-w-xs">
          WebContainers require <code>SharedArrayBuffer</code> + COOP/COEP. Using Chrome/Firefox on this preview URL is required.
        </p>
      </div>
    )
  }

  // Auto-scroll the log drawer to the bottom on each new line.
  useEffect(() => {
    if (showLogs && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
    }
  }, [logs, showLogs])

  return (
    <div className="h-full flex flex-col bg-background min-h-0" data-testid="wc-preview">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-[11px]">
        <Zap className="w-3.5 h-3.5 text-emerald-400" />
        <span className="font-medium">WebContainer</span>
        <span className="text-muted-foreground">·</span>
        <StageBadge stage={stage} detail={stageDetail} />
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground/80 hover:text-emerald-300 truncate max-w-[320px]"
            title={`Open in new tab: ${url}`}
            data-testid="wc-open-external"
          >
            <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        )}
        <button
          onClick={() => setShowLogs((v) => !v)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${showLogs ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/40'} ${url ? '' : 'ml-auto'}`}
          title="Toggle terminal log"
          data-testid="wc-toggle-logs"
        >
          <Terminal className="w-3 h-3" />
          {showLogs ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          <span>{logs.length > 0 ? `${logs.length}` : 'logs'}</span>
        </button>
        {url && (
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted/40"
            title="Reload preview iframe"
            data-testid="wc-reload-iframe"
          >
            ↻
          </button>
        )}
      </div>

      {ports.length > 1 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/40 text-[10px] text-muted-foreground/70 overflow-x-auto" data-testid="wc-extra-ports">
          <span className="uppercase tracking-wider opacity-60">Ports</span>
          {ports.map(({ port, url: pUrl }) => (
            <a
              key={port}
              href={pUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono px-1.5 py-0.5 rounded border border-white/10 hover:border-emerald-400/40 hover:text-emerald-300"
              title={pUrl}
              data-testid={`wc-port-${port}`}
            >
              :{port}
            </a>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {error ? (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <div className="max-w-md space-y-2" data-testid="wc-error">
              <AlertTriangle className="w-8 h-8 mx-auto text-rose-400" />
              <p className="text-sm font-medium text-rose-300">{error}</p>
              <details className="text-[11px] text-muted-foreground text-left mt-2 max-h-40 overflow-auto">
                <summary className="cursor-pointer">Container log</summary>
                <pre className="font-mono text-[10px] whitespace-pre-wrap">{logs.join('')}</pre>
              </details>
            </div>
          </div>
        ) : url ? (
          <div className="flex-1 min-h-0 bg-white flex justify-center">
            <iframe
              key={iframeKey}
              src={url}
              title="WebContainer preview"
              className="w-full h-full border-0"
              style={{ maxWidth: viewport === '100%' ? '100%' : viewport, margin: viewport === '100%' ? undefined : '0 auto' }}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              data-testid="wc-iframe"
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground" data-testid="wc-loading">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs">
              {stage === 'boot' && 'Booting WebContainer…'}
              {stage === 'mount' && 'Mounting project files…'}
              {stage === 'install' && (stageDetail || 'Running npm install…')}
              {stage === 'dev' && (stageDetail || 'Starting dev server…')}
              {stage === 'ready' && 'Waiting for first render…'}
              {stage === 'idle' && 'Preparing…'}
            </p>
            {logs.length > 0 && (
              <pre className="max-w-lg max-h-40 overflow-auto font-mono text-[10px] text-muted-foreground/60 bg-muted/20 rounded px-2 py-1">
                {logs.slice(-12).join('')}
              </pre>
            )}
          </div>
        )}
      </div>

      {showLogs && (
        <div className="border-t border-border/40 bg-black/60 max-h-56 overflow-hidden flex flex-col" data-testid="wc-logs-drawer">
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
            <Terminal className="w-3 h-3" />
            <span>Terminal</span>
            <span className="opacity-60">· {logs.length} lines</span>
            <button
              onClick={() => setLogs([])}
              className="ml-auto opacity-60 hover:opacity-100"
              data-testid="wc-clear-logs"
            >
              Clear
            </button>
          </div>
          <pre
            ref={logScrollRef}
            className="flex-1 overflow-auto px-3 py-1.5 font-mono text-[10px] leading-snug text-emerald-200/80 whitespace-pre-wrap"
          >
            {logs.length === 0 ? <span className="text-muted-foreground/50">(no output yet)</span> : logs.join('')}
          </pre>
        </div>
      )}
    </div>
  )
}

function StageBadge({ stage, detail }) {
  const map = {
    idle:    { cls: 'text-muted-foreground bg-muted/40', label: 'idle' },
    boot:    { cls: 'text-sky-300 bg-sky-500/10',        label: 'booting' },
    mount:   { cls: 'text-sky-300 bg-sky-500/10',        label: 'mounting' },
    install: { cls: 'text-amber-300 bg-amber-500/10',    label: 'installing' },
    dev:     { cls: 'text-amber-300 bg-amber-500/10',    label: 'starting' },
    ready:   { cls: 'text-emerald-300 bg-emerald-500/10', label: 'ready' },
    error:   { cls: 'text-rose-300 bg-rose-500/10',      label: 'error' },
  }
  const m = map[stage] || map.idle
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${m.cls}`} data-testid={`wc-stage-${stage}`}>
      <FileCode className="w-3 h-3" /> {m.label}
      {detail && stage !== 'ready' && <span className="text-muted-foreground/70 truncate max-w-[220px]">· {detail}</span>}
    </span>
  )
}
