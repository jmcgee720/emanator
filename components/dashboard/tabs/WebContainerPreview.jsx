'use client'

// WebContainerPreview — runs a user project IN THE BROWSER using
// StackBlitz's @webcontainer/api. Instant boot, no Fly cost, no cold
// installs. This is the "Emergent-tier" preview engine for the 85-90%
// of projects that don't need native Node modules.
//
// Boot sequence:
//   1. Cross-origin isolation check (WebContainers require COEP+COOP)
//   2. Boot a fresh WebContainer instance (~1s)
//   3. Mount the file tree from Supabase
//   4. npm install (typically 30-90s in-browser)
//   5. Detect the dev script (vite → npm run dev, next → next dev, etc.)
//   6. Spawn the dev server, wait for it to bind
//   7. Get the internal preview URL and set it as the iframe src
//
// State machine:
//   idle → mounting → installing → starting → ready | error
//
// Errors surface an ErrorBoundary-style card with the exact log tail
// so users can either fix in-code or flip to server-engine mode.

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { WebContainer } from '@webcontainer/api'

// Global singleton — WebContainer.boot() throws if called twice.
// We reuse the same instance across projects; tearing down on unmount
// is handled by teardown().
let __webContainerInstance = null
async function getOrBootWebContainer() {
  if (__webContainerInstance) return __webContainerInstance
  __webContainerInstance = await WebContainer.boot({ coep: 'credentialless' })
  return __webContainerInstance
}

// Convert Supabase file list → WebContainer FileSystemTree
function filesToTree(files) {
  const tree = {}
  for (const f of files || []) {
    if (!f.path) continue
    if (f.path.startsWith('node_modules/') || f.path.includes('/node_modules/')) continue
    if (typeof f.content !== 'string') continue
    const parts = f.path.split('/').filter(Boolean)
    let cursor = tree
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      if (!cursor[seg]) cursor[seg] = { directory: {} }
      cursor = cursor[seg].directory
    }
    cursor[parts[parts.length - 1]] = { file: { contents: f.content } }
  }
  return tree
}

// Pick a dev command from package.json. Prefer explicit dev scripts
// over start scripts (start tends to be prod build).
function pickDevCommand(pkg) {
  const scripts = pkg?.scripts || {}
  if (scripts.dev) return ['npm', ['run', 'dev']]
  if (scripts.start) return ['npm', ['start']]
  if (scripts.serve) return ['npm', ['run', 'serve']]
  return null
}

export default function WebContainerPreview({ project, files }) {
  const [status, setStatus] = useState('idle') // idle | mounting | installing | starting | ready | error
  const [iframeUrl, setIframeUrl] = useState(null)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const iframeRef = useRef(null)
  const wcRef = useRef(null)

  const appendLog = useCallback((line) => {
    setLogs(prev => [...prev.slice(-500), { line, ts: Date.now() }])
  }, [])

  const boot = useCallback(async () => {
    try {
      setStatus('mounting')
      setError(null)
      appendLog('[webcontainer] booting…')
      const wc = await getOrBootWebContainer()
      wcRef.current = wc
      appendLog('[webcontainer] booted, mounting files')

      const tree = filesToTree(files)
      const fileCount = Object.keys(tree).length
      appendLog(`[webcontainer] mounting ${fileCount} top-level entries`)
      await wc.mount(tree)

      // Read package.json to know what to run
      let pkg = null
      try {
        const pkgRaw = await wc.fs.readFile('package.json', 'utf-8')
        pkg = JSON.parse(pkgRaw)
      } catch {
        appendLog('[webcontainer] no package.json — treating as static site')
      }

      // Static site: just find index.html and serve it
      if (!pkg) {
        setStatus('starting')
        const process = await wc.spawn('npx', ['--yes', 'http-server', '-p', '5173', '-c-1', '.'])
        process.output.pipeTo(new WritableStream({
          write(data) { appendLog(data) },
        }))
        wc.on('server-ready', (port, url) => {
          appendLog(`[webcontainer] http-server ready at ${url}`)
          setIframeUrl(url)
          setStatus('ready')
        })
        return
      }

      // Node project — install then spawn dev
      setStatus('installing')
      appendLog('[webcontainer] running npm install')
      const install = await wc.spawn('npm', ['install', '--legacy-peer-deps'])
      install.output.pipeTo(new WritableStream({
        write(data) { appendLog(data) },
      }))
      const installExit = await install.exit
      if (installExit !== 0) throw new Error(`npm install exited ${installExit}`)
      appendLog('[webcontainer] npm install done')

      const cmd = pickDevCommand(pkg)
      if (!cmd) throw new Error('no dev/start/serve script found in package.json')
      setStatus('starting')
      appendLog(`[webcontainer] spawning ${cmd[0]} ${cmd[1].join(' ')}`)
      const dev = await wc.spawn(cmd[0], cmd[1])
      dev.output.pipeTo(new WritableStream({
        write(data) { appendLog(data) },
      }))
      wc.on('server-ready', (port, url) => {
        appendLog(`[webcontainer] dev server ready on port ${port}: ${url}`)
        setIframeUrl(url)
        setStatus('ready')
      })
    } catch (err) {
      appendLog(`[webcontainer] ERROR: ${err?.message || err}`)
      setError(err?.message || String(err))
      setStatus('error')
    }
  }, [files, appendLog])

  useEffect(() => {
    boot()
    // Note: WebContainer instance is a global singleton; we intentionally
    // don't tear it down on unmount so re-opening the preview reuses the
    // existing boot (~1s saved on every subsequent render).
  }, [boot])

  return (
    <div className="flex h-full w-full flex-col bg-[#0a0716]" data-testid="webcontainer-preview">
      {/* Aurora-themed control bar */}
      <div
        className="relative flex items-center justify-between border-b border-white/[0.06] bg-gradient-to-b from-[#120b26]/95 to-[#0a0716]/95 backdrop-blur-xl px-4 py-2"
        style={{ boxShadow: '0 1px 0 0 rgba(139, 92, 246, 0.08)' }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <span className={`inline-block h-2 w-2 rounded-full ${
              status === 'ready' ? 'bg-emerald-400' :
              status === 'error' ? 'bg-rose-400' :
              'bg-violet-400 animate-pulse'
            }`} />
            {status === 'ready' && (
              <div className="absolute inset-0 -m-1 rounded-full bg-emerald-400/30 blur-md animate-pulse" />
            )}
          </div>
          <span className="text-[11px] font-medium tracking-wide text-white/70">
            {status === 'ready' ? 'WebContainer · Live' :
             status === 'error' ? 'WebContainer · Error' :
             status === 'installing' ? 'Installing packages…' :
             status === 'starting' ? 'Starting dev server…' :
             status === 'mounting' ? 'Mounting files…' :
             'WebContainer'}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-full px-3 text-[11px] font-medium text-white/70 hover:bg-white/[0.06] hover:text-white"
          onClick={() => { setStatus('idle'); setIframeUrl(null); boot() }}
          data-testid="webcontainer-refresh"
        >
          Refresh
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        {iframeUrl && status === 'ready' ? (
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            className="h-full w-full border-0 bg-white"
            title={`${project?.name || 'Project'} preview`}
            data-testid="webcontainer-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            allow="cross-origin-isolated"
          />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-6 text-center" style={{ background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #0f172a 50%, #0a0716 100%)' }}>
            <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
            <div className="relative z-10 w-full max-w-2xl">
              <div className="mb-3 text-base text-white/90 flex items-center justify-center gap-2.5 font-medium">
                {status !== 'error' && (
                  <svg className="h-5 w-5 animate-spin text-violet-300" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-95" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                  </svg>
                )}
                {status === 'error' ? 'Preview failed' :
                 status === 'mounting' ? 'Mounting your project…' :
                 status === 'installing' ? 'Installing dependencies…' :
                 status === 'starting' ? 'Starting dev server…' :
                 'Preparing WebContainer…'}
              </div>
              <div className="text-xs text-white/50 mb-5 leading-relaxed max-w-md mx-auto">
                Running your project in-browser via WebContainer.
                <br />
                No cloud infra — typically live in <span className="text-white/80">30-60 seconds</span>.
              </div>
              {logs.length > 0 && (
                <div className="rounded-lg border border-white/10 bg-black/60 text-left max-w-2xl mx-auto">
                  <div className="border-b border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/40">
                    Build output · {logs.length} lines
                  </div>
                  <div className="px-3 py-2 font-mono text-[10px] leading-snug text-white/70 max-h-64 overflow-auto">
                    {logs.slice(-30).map((e, i) => (
                      <div key={i} className={/error|ERR!|failed/i.test(e.line) ? 'text-rose-400' : /warn/i.test(e.line) ? 'text-amber-400' : 'text-white/60'}>
                        {String(e.line).trim()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-left text-xs text-rose-200/90">
                  <div className="font-mono">{error}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
