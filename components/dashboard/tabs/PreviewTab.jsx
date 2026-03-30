'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { authFetch } from '@/lib/auth-fetch'
import {
  RefreshCw, AlertTriangle, MonitorSmartphone, Tablet, Monitor,
  Loader2, FileCode, AlertCircle, Terminal, Play, Square, RotateCcw
} from 'lucide-react'

// ─── Project classifier ────────────────────────────────────────────
function classifyProject(files) {
  if (!files?.length) return { type: 'empty', files: [] }

  const codeFiles = files.filter(f => {
    if (!f.path) return false
    if (f.path.startsWith('_generated/')) return false
    if (f.path.startsWith('_uploads/')) return false
    if (f.path.startsWith('_assets/')) return false
    if (f.file_type === 'image') return false
    return true
  })

  if (codeFiles.length === 0) {
    const assetCount = files.filter(f => f.path?.startsWith('_generated/') || f.path?.startsWith('_uploads/')).length
    if (assetCount > 0) {
      return { type: 'assets-only', assetCount, files }
    }
    return { type: 'empty', files: [] }
  }

  // Check for package.json → Node project requiring execution
  const hasPackageJson = codeFiles.some(f => f.path === 'package.json' || f.path?.endsWith('/package.json'))
  if (hasPackageJson) {
    return { type: 'node', files: codeFiles }
  }

  const htmlFiles = codeFiles.filter(f => f.path?.match(/\.html?$/i) && f.content)
  const cssFiles = codeFiles.filter(f => f.path?.match(/\.(css|scss)$/i) && f.content)
  const jsFiles = codeFiles.filter(f => f.path?.match(/\.js$/i) && f.content && !f.path.includes('node_modules'))
  const jsxFiles = codeFiles.filter(f => f.path?.match(/\.(jsx|tsx)$/i) && f.content)
  const tsFiles = codeFiles.filter(f => f.path?.match(/\.ts$/i) && f.content && !f.path.match(/\.d\.ts$/i))

  const allCode = codeFiles.map(f => f.content || '').join('\n')
  const usesTailwind = allCode.includes('tailwind') ||
    /class(?:Name)?=["'][^"']*(?:flex|grid|text-|bg-|p-|m-|rounded|shadow|border|w-|h-|gap-)/.test(allCode)
  const usesReact = allCode.includes('import React') || allCode.includes('from "react"') ||
    allCode.includes("from 'react'") || allCode.includes('useState') ||
    allCode.includes('jsx') || jsxFiles.length > 0

  if (htmlFiles.length > 0) {
    const indexHtml = htmlFiles.find(f => f.path.match(/(^|\/)index\.html?$/i))
    if (indexHtml) {
      const c = indexHtml.content
      const isFullDoc = c.includes('<!DOCTYPE') || c.includes('<html')
      const hasInlineStyles = /<style[\s>]/.test(c) && c.length > 500
      if (isFullDoc && hasInlineStyles) {
        return { type: 'html', htmlFiles: [indexHtml], cssFiles, jsFiles, usesTailwind }
      }
    }
    if (!usesReact) {
      return { type: 'html', htmlFiles, cssFiles, jsFiles, usesTailwind }
    }
  }

  if (usesReact || jsxFiles.length > 0) {
    return { type: 'react', htmlFiles, cssFiles, jsFiles, jsxFiles, tsFiles, usesTailwind }
  }
  if (jsFiles.length > 0) {
    return { type: 'js', htmlFiles, cssFiles, jsFiles, usesTailwind }
  }
  if (cssFiles.length > 0) {
    return { type: 'css-only', cssFiles, usesTailwind }
  }
  return { type: 'unsupported', files }
}

// ─── Regex helper ──────────────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Strip ALL React-related imports and declarations from a code string ──
function stripReactBindings(code) {
  code = code.replace(/import\s+(?:React\s*,\s*)?\{[^}]*\}\s+from\s+['"]react['"];?\s*/g, '')
  code = code.replace(/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+['"]react['"];?\s*/g, '')
  code = code.replace(/import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]react-dom(?:\/client)?['"];?\s*/g, '')
  code = code.replace(/(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*['"]react(?:-dom)?(?:\/client)?['"]\s*\)\s*;?\s*/g, '')
  code = code.replace(/(?:const|let|var)\s+\{[^}]*\}\s*=\s*React\s*;?\s*/g, '')
  code = code.replace(/import\s+.*?\s+from\s+['"]\.\.?\/[^'"]+['"];?\s*/g, '')
  code = code.replace(/import\s+['"][^'"]+\.css['"];?\s*/g, '')
  code = code.replace(/import\s+type\s+.*?from\s+['"][^'"]+['"]\s*;?/g, '')
  return code
}

// ─── Strip simple TypeScript annotations ───────────────────────────
function stripTypeScript(code) {
  code = code.replace(/(?<=\w\??)\s*:\s*(?:string|number|boolean|any|void|never|unknown|React\.\w+(?:<[^>]*>)?|JSX\.Element)(?:\[\])?\s*(?=[,)=;{\n])/g, '')
  code = code.replace(/(?:export\s+)?(?:interface|type)\s+\w+\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]+)?\{[^}]*\}/g, '')
  return code
}

// ─── Build: HTML/CSS/JS ────────────────────────────────────────────
function buildHtmlPreview({ htmlFiles, cssFiles, jsFiles, usesTailwind }) {
  let html = htmlFiles[0].content

  if (usesTailwind && !html.includes('tailwindcss')) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n<script src="https://cdn.tailwindcss.com"><\/script>`)
  }

  for (const cssFile of cssFiles) {
    const fileName = cssFile.path.split('/').pop()
    const linkPattern = new RegExp('<link[^>]*href=["\'](?:\\.\\/)?' + escapeRegex(fileName) + '["\'][^>]*\\/?>', 'gi')
    if (linkPattern.test(html)) {
      html = html.replace(linkPattern, '<style>\n' + cssFile.content + '\n</style>')
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', '<style>\n' + cssFile.content + '\n</style>\n</head>')
    }
  }

  for (const jsFile of jsFiles) {
    const fileName = jsFile.path.split('/').pop()
    const scriptPattern = new RegExp('<script[^>]*src=["\'](?:\\.\\/)?' + escapeRegex(fileName) + '["\'][^>]*>\\s*<\\/script>', 'gi')
    if (scriptPattern.test(html)) {
      html = html.replace(scriptPattern, '<script>\n' + jsFile.content + '\n<\/script>')
    }
  }

  return wrapWithErrorHandler(html)
}

// ─── Build: React/JSX ──────────────────────────────────────────────
function buildReactPreview({ cssFiles, jsFiles, jsxFiles, tsFiles, usesTailwind }) {
  const allCss = cssFiles?.map(f => f.content).join('\n') || ''
  const normalizePreviewPath = (p = '') => String(p).replace(/^\.\//, '')

  const componentFiles = [...(jsxFiles || []), ...(tsFiles || [])].filter(f => {
    const p = normalizePreviewPath(f.path)
    return !/\.d\.ts$/.test(p)
  })

  const reactJsFiles = (jsFiles || []).filter(f => {
    const c = f.content || ''
    return (
      c.includes('React') ||
      c.includes('useState') ||
      c.includes('export default') ||
      /<\/?[A-Z]/.test(c)
    )
  })

  const allComponents = [...componentFiles, ...reactJsFiles]

  const entryFile =
    allComponents.find(f => /App\.(jsx|tsx|js)$/i.test(normalizePreviewPath(f.path))) ||
    allComponents.find(f => /index\.(jsx|tsx|js)$/i.test(normalizePreviewPath(f.path))) ||
    allComponents.find(f => /page\.(jsx|tsx|js)$/i.test(normalizePreviewPath(f.path))) ||
    allComponents[0] ||
    null

  if (!entryFile) return null

  const entryName = normalizePreviewPath(entryFile.path)
    .replace(/\.(jsx|tsx|js|ts)$/, '')
    .split('/')
    .pop()

  const debugFiles = allComponents.map(f => f.path).join(', ')

  let assembledCode = ''
  for (const f of allComponents) {
    let code = f.content
    code = stripTypeScript(code)
    code = stripReactBindings(code)

    const modName = f.path.replace(/^\.\//, '').replace(/\.(jsx|tsx|js|ts)$/, '').split('/').pop()

    code = code.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    code = code.replace(/import\s+['"][^'"]+['"];?/g, '')
    code = code.replace(/^\s*import\s.*$/gm, '')

    code = code.replace(/^\s*export\s+\*\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    code = code.replace(/^\s*export\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    code = code.replace(/^\s*export\s+\{[^}]+\};?\s*$/gm, '')

    code = code.replace(/^\s*export\s+default\s+class\s+/gm, 'window.__COMPONENTS__["' + modName + '"] = class ')
    code = code.replace(/^\s*export\s+default\s+function\s+/gm, 'window.__COMPONENTS__["' + modName + '"] = function ')
    code = code.replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, 'function $1; window.__COMPONENTS__["' + modName + '"] = $1')
    code = code.replace(/export\s+default\s+class\s+([A-Za-z0-9_]+)/g, 'class $1; window.__COMPONENTS__["' + modName + '"] = $1')
    code = code.replace(/export\s+default\s+(.+)/g, 'window.__COMPONENTS__["' + modName + '"] = $1')

    code = code.replace(/^\s*export\s+(async\s+function)\s+/gm, '$1 ')
    code = code.replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ')
    code = code.replace(/^\s*export\b.*$/gm, '')

    assembledCode += '\n\n// FILE: ' + f.path + '\n' + code
  }

  const safeEntryName = entryName.replace(/'/g, "\\'")
  const safeDebugFiles = debugFiles.replace(/'/g, "\\'")

  const html = [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Preview</title>',
    usesTailwind ? '<script src="https://cdn.tailwindcss.com"><\/script>' : '',
    '<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: system-ui, -apple-system, sans-serif; }',
    allCss,
    '</style>',
    '<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin><\/script>',
    '<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin><\/script>',
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>',
    '</head><body><div id="root"></div>',
    '<script type="text/babel" data-presets="react">',
    'var { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useLayoutEffect, useDeferredValue, useTransition, useId, useSyncExternalStore, createContext, createElement, Fragment, memo, forwardRef, lazy, Suspense } = React;',
    'var createRoot = ReactDOM.createRoot;',
    'window.__COMPONENTS__ = {};',
    assembledCode,
    'try {',
    "  var _Entry = window.__COMPONENTS__['" + safeEntryName + "'] || window.__COMPONENTS__['App'] || Object.values(window.__COMPONENTS__)[0];",
    '  if (_Entry) { createRoot(document.getElementById("root")).render(createElement(_Entry)); }',
    "  else { document.getElementById('root').innerHTML = '<div style=\"padding:2rem;color:#888;font-family:system-ui;\">No renderable component found. Files: " + safeDebugFiles + "</div>'; }",
    '} catch (_e) {',
    "  document.getElementById('root').innerHTML = '<div style=\"padding:2rem;color:#ef4444;font-family:monospace;white-space:pre-wrap;\">Render Error: ' + _e.message + '</div>';",
    "  window.parent.postMessage({ type: '__PREVIEW_ERROR__', error: _e.message, stack: _e.stack }, '*');",
    '}',
    '<\/script></body></html>'
  ].join('\n')

  return wrapWithErrorHandler(html)
}

// ─── Build: CSS-only ───────────────────────────────────────────────
function buildCssPreview({ cssFiles, usesTailwind }) {
  const allCss = cssFiles.map(f => `/* ${f.path} */\n${f.content}`).join('\n\n')
  return wrapWithErrorHandler(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSS Preview</title>
${usesTailwind ? '<script src="https://cdn.tailwindcss.com"><\/script>' : ''}
<style>${allCss}</style></head>
<body><div id="root" style="padding:2rem;font-family:system-ui;color:#666;">
<p>CSS loaded. Add an <code>index.html</code> file for full preview.</p>
</div></body></html>`)
}

// ─── Build: vanilla JS ─────────────────────────────────────────────
function buildJsPreview({ jsFiles, cssFiles, usesTailwind }) {
  const allCss = cssFiles?.map(f => f.content).join('\n') || ''
  const allJs = jsFiles.map(f => `// --- ${f.path} ---\n${f.content}`).join('\n;\n')
  return wrapWithErrorHandler(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JS Preview</title>
${usesTailwind ? '<script src="https://cdn.tailwindcss.com"><\/script>' : ''}
<style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family:system-ui; } ${allCss}</style></head>
<body><div id="root"></div>
<script>\n${allJs}\n<\/script>
</body></html>`)
}

// ─── Error handler injected into every preview ─────────────────────
function wrapWithErrorHandler(html) {
  const errorScript = `<script>
window.onerror = function(msg, src, line, col, err) {
  window.parent.postMessage({ type: '__PREVIEW_ERROR__', error: msg, line: line, col: col, stack: err && err.stack || '' }, '*');
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  window.parent.postMessage({ type: '__PREVIEW_ERROR__', error: 'Unhandled Promise: ' + (e.reason && e.reason.message || e.reason) }, '*');
});
['log','warn','error','info'].forEach(function(level) {
  var orig = console[level];
  console[level] = function() {
    var args = Array.from(arguments).map(function(a) { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e) { return String(a); } });
    window.parent.postMessage({ type: '__PREVIEW_CONSOLE__', level: level, message: args.join(' ') }, '*');
    orig.apply(console, arguments);
  };
});
<\/script>`

  if (html.includes('<head')) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${errorScript}`)
  }
  return `<!DOCTYPE html><html><head>${errorScript}</head><body>${html}</body></html>`
}


// ═══════════════════════════════════════════════════════════════════
// Node Preview Runner UI
// ═══════════════════════════════════════════════════════════════════
function NodePreviewRunner({ project, files, onLog }) {
  const [status, setStatus] = useState('idle') // idle | starting | installing | running | failed | stopped
  const [logs, setLogs] = useState([])
  const [port, setPort] = useState(null)
  const pollingRef = useRef(null)
  const logsEndRef = useRef(null)

  const backendUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || process.env.REACT_APP_BACKEND_URL || '')
    : ''

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Clean up on unmount or project change
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [project?.id])

  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`/api/preview/status/${project.id}`)
        if (!res.ok) return
        const data = await res.json()
        setStatus(data.status)
        setLogs(data.logs || [])
        if (data.status === 'running') {
          setPort(data.port)
          onLog?.('success', 'Preview server is running')
        }
        if (data.status === 'failed' || data.status === 'stopped' || data.status === 'none') {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      } catch { /* ignore */ }
    }, 2000)
  }, [project?.id, onLog])

  const handleStart = async () => {
    setStatus('starting')
    setLogs(['[emanator] Starting preview...'])
    setPort(null)
    onLog?.('info', 'Starting preview...')

    try {
      const res = await authFetch('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          files: files.filter(f => f.content != null).map(f => ({ path: f.path, content: f.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('failed')
        setLogs(prev => [...prev, `[error] ${data.error}`])
        onLog?.('error', `Preview start failed: ${data.error}`)
        return
      }
      setStatus(data.status)
      setPort(data.port)
      if (data.status === 'running') {
        onLog?.('success', 'Preview server started')
      } else {
        startPolling()
      }
    } catch (err) {
      setStatus('failed')
      setLogs(prev => [...prev, `[error] ${err.message}`])
      onLog?.('error', `Preview error: ${err.message}`)
    }
  }

  const handleStop = async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    try {
      await authFetch(`/api/preview/stop/${project.id}`, { method: 'POST' })
    } catch { /* ignore */ }
    setStatus('stopped')
    setPort(null)
    onLog?.('info', 'Preview stopped')
  }

  const previewUrl = port ? `${backendUrl}/api/preview/serve/${project.id}/` : null
  const isLoading = status === 'starting' || status === 'installing'
  const isRunning = status === 'running'
  const isFailed = status === 'failed'
  const isStopped = status === 'stopped'

  // Detect framework from package.json
  const pkgFile = files?.find(f => f.path === 'package.json' || f.path?.endsWith('/package.json'))
  let frameworkLabel = 'Node.js'
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content)
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      if (deps.next) frameworkLabel = 'Next.js'
      else if (deps['react-scripts']) frameworkLabel = 'Create React App'
      else if (deps.vite) frameworkLabel = 'Vite'
      else if (deps.express) frameworkLabel = 'Express'
      else if (deps.react) frameworkLabel = 'React'
    } catch { /* ignore */ }
  }

  // Idle state — show start button
  if (!isLoading && !isRunning && !isFailed && !isStopped) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-4" data-testid="preview-node-idle">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <Play className="w-7 h-7 text-emerald-400" />
        </div>
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-foreground" data-testid="preview-framework-label">{frameworkLabel} Project</p>
          <p className="text-xs mt-1.5 opacity-70 leading-relaxed">
            This project requires <code className="text-[10px] bg-muted/60 px-1 py-0.5 rounded">npm install</code> and a dev server to preview.
            Click below to start.
          </p>
        </div>
        <Button
          onClick={handleStart}
          className="gap-2"
          data-testid="preview-start-btn"
        >
          <Play className="w-4 h-4" /> Start Preview
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background" data-testid="preview-node-runner">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded ${
            isRunning ? 'bg-emerald-500/15 text-emerald-400' :
            isLoading ? 'bg-amber-500/15 text-amber-400' :
            isFailed ? 'bg-red-500/15 text-red-400' :
            'bg-muted/40 text-muted-foreground'
          }`} data-testid="preview-runner-status">
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            {isFailed && <AlertCircle className="w-3 h-3" />}
            {status === 'installing' ? 'Installing...' :
             status === 'starting' ? 'Starting...' :
             status === 'running' ? `Running (${frameworkLabel})` :
             status === 'failed' ? 'Failed' : 'Stopped'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isRunning && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5"
              onClick={() => {
                const iframe = document.querySelector('[data-testid="preview-node-iframe"]')
                if (iframe) iframe.src = iframe.src
              }}
              data-testid="preview-node-refresh">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          )}
          {(isRunning || isLoading) && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-red-400 hover:text-red-300"
              onClick={handleStop} data-testid="preview-stop-btn">
              <Square className="w-3.5 h-3.5" /> Stop
            </Button>
          )}
          {(isFailed || isStopped) && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5"
              onClick={handleStart} data-testid="preview-restart-btn">
              <RotateCcw className="w-3.5 h-3.5" /> Restart
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {isRunning && previewUrl ? (
        <div className="flex-1 overflow-hidden bg-white">
          <iframe
            src={previewUrl}
            title="Node Preview"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
            data-testid="preview-node-iframe"
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Build Logs */}
      <div className="border-t border-border/40 bg-muted/20 max-h-52 min-h-[80px] overflow-auto" data-testid="preview-build-logs">
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/30">
          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> Build Output
            {logs.length > 0 && <span className="opacity-50">({logs.length} lines)</span>}
          </span>
        </div>
        <div className="px-3 py-1 font-mono text-[10px] space-y-0 leading-relaxed">
          {logs.length === 0 ? (
            <div className="py-2 text-muted-foreground/50">No output yet</div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={
                line.includes('[error]') || line.includes('ERR!') || line.includes('Error:') ? 'text-red-400' :
                line.includes('[warn') || line.includes('WARN') ? 'text-yellow-400' :
                line.startsWith('[emanator]') ? 'text-blue-400' :
                'text-muted-foreground'
              }>{line}</div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════
// Main PreviewTab Component
// ═══════════════════════════════════════════════════════════════════
export default function PreviewTab({ project, files, onLog }) {
  const [viewportSize, setViewportSize] = useState('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const [iframeErrors, setIframeErrors] = useState([])
  const [consoleLogs, setConsoleLogs] = useState([])
  const [showConsole, setShowConsole] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef(null)
  const prevFilesRef = useRef(null)

  const viewports = {
    mobile: { width: '375px', label: 'Mobile' },
    tablet: { width: '768px', label: 'Tablet' },
    desktop: { width: '100%', label: 'Desktop' }
  }

  useEffect(() => {
    const prevHash = prevFilesRef.current
    const currentHash = files?.map(f => `${f.path}:${f.version || 0}`).join('|') || ''
    if (prevHash !== null && prevHash !== currentHash) {
      setRefreshKey(k => k + 1)
      setIframeErrors([])
      setConsoleLogs([])
      setIframeLoaded(false)
    }
    prevFilesRef.current = currentHash
  }, [files])

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__PREVIEW_ERROR__') {
        const errMsg = `${e.data.error}${e.data.line ? ` (line ${e.data.line})` : ''}`
        setIframeErrors(prev => {
          if (prev.includes(errMsg)) return prev
          return [...prev.slice(-9), errMsg]
        })
        onLog?.('error', `Preview: ${errMsg}`)
      }
      if (e.data?.type === '__PREVIEW_CONSOLE__') {
        setConsoleLogs(prev => [...prev.slice(-49), { level: e.data.level, message: e.data.message }])
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onLog])

  const { previewHtml, projectInfo, buildLog } = useMemo(() => {
    const clientFiles = (files || []).filter(f => {
      const p = f.path || ''
      return (
        p.startsWith('components/') ||
        p.startsWith('app/') ||
        p.endsWith('.jsx') ||
        p.endsWith('.tsx') ||
        p.endsWith('.js') ||
        p.endsWith('.css') ||
        p.endsWith('.html') ||
        p === 'package.json' ||
        p.endsWith('/package.json')
      ) &&
      !p.includes('lib/self_builder') &&
      !p.includes('supabase') &&
      !p.includes('api/')
    })

    const info = classifyProject(clientFiles)
    const log = []

    log.push(`Type: ${info.type}`)
    if (info.type === 'react') {
      const components = [...(info.jsxFiles || []), ...(info.tsFiles || [])]
      const reactJs = (info.jsFiles || []).filter(f => {
        const c = f.content || ''
        return c.includes('React') || c.includes('useState') || c.includes('export default') || /<\w+[\s/>]/.test(c)
      })
      const all = [...components, ...reactJs]
      const entry = all.find(f => f.path.match(/App\.(jsx|tsx|js)$/i)) ||
                    all.find(f => f.path.match(/index\.(jsx|tsx|js)$/i)) ||
                    all[0]
      log.push(`Entry: ${entry?.path || 'none'}`)
      log.push(`Files: ${all.map(f => f.path).join(', ')}`)
      log.push(`Tailwind: ${info.usesTailwind}`)
    }

    let html = null
    switch (info.type) {
      case 'html': html = buildHtmlPreview(info); break
      case 'react': html = buildReactPreview(info); break
      case 'js': html = buildJsPreview(info); break
      case 'css-only': html = buildCssPreview(info); break
    }

    if (html) log.push(`Output: ${html.length} chars`)

    return { previewHtml: html, projectInfo: info, buildLog: log }
  }, [files, refreshKey])

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
    setIframeErrors([])
    setConsoleLogs([])
    setIframeLoaded(false)
  }, [])

  const isCoreSystemProject =
    project?.name === 'Emanator Backend' ||
    project?.name === 'Emanator' ||
    project?.type === 'core'

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground" data-testid="preview-empty">
        <p className="text-sm">Select a project to preview</p>
      </div>
    )
  }

  if (isCoreSystemProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-core-disabled">
        <AlertTriangle className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">Core System Preview Disabled</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Emanator cannot preview itself through the isolated Babel component pipeline.
          </p>
        </div>
      </div>
    )
  }

  // Node project → delegate to runner
  if (projectInfo.type === 'node') {
    return <NodePreviewRunner project={project} files={files} onLog={onLog} />
  }

  if (projectInfo.type === 'empty') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-no-files">
        <FileCode className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">No preview available yet</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Ask the AI to generate a web page, landing site, or React app — it will appear here automatically.
          </p>
        </div>
      </div>
    )
  }

  if (projectInfo.type === 'assets-only') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-assets-only">
        <FileCode className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">No previewable code files</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            This project contains {projectInfo.assetCount} generated asset{projectInfo.assetCount !== 1 ? 's' : ''} but no HTML, CSS, or JavaScript files.
            Check the <strong>Assets</strong> tab to view generated images.
          </p>
        </div>
      </div>
    )
  }

  if (projectInfo.type === 'unsupported') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-unsupported">
        <AlertTriangle className="w-10 h-10 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">Unsupported project structure</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Preview supports HTML, CSS, JavaScript, and React/JSX projects.
          </p>
        </div>
      </div>
    )
  }

  if (!previewHtml) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground gap-3" data-testid="preview-render-error">
        <AlertCircle className="w-10 h-10 text-red-400 opacity-60" />
        <div className="text-center">
          <p className="text-sm font-medium">Preview render failed</p>
          <p className="text-xs mt-1 max-w-xs opacity-70">
            Could not assemble a preview from {files?.length} file(s).
          </p>
          {buildLog.length > 0 && (
            <pre className="mt-3 text-[10px] text-left bg-muted/40 rounded p-2 max-w-md overflow-auto">
              {buildLog.join('\n')}
            </pre>
          )}
        </div>
      </div>
    )
  }

  const modeLabel = projectInfo.type === 'react' ? 'React (Babel)' :
    projectInfo.type === 'html' ? 'HTML' :
    projectInfo.type === 'js' ? 'JavaScript' :
    projectInfo.type === 'css-only' ? 'CSS Only' : 'Preview'

  return (
    <div className="h-full flex flex-col bg-background" data-testid="preview-tab">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-1">
          <Button size="sm" variant={viewportSize === 'mobile' ? 'secondary' : 'ghost'}
            className="h-7 w-7 p-0" onClick={() => setViewportSize('mobile')} data-testid="preview-viewport-mobile">
            <MonitorSmartphone className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant={viewportSize === 'tablet' ? 'secondary' : 'ghost'}
            className="h-7 w-7 p-0" onClick={() => setViewportSize('tablet')} data-testid="preview-viewport-tablet">
            <Tablet className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant={viewportSize === 'desktop' ? 'secondary' : 'ghost'}
            className="h-7 w-7 p-0" onClick={() => setViewportSize('desktop')} data-testid="preview-viewport-desktop">
            <Monitor className="w-3.5 h-3.5" />
          </Button>
          <span className="ml-2 text-[10px] font-mono text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded" data-testid="preview-mode-label">
            {modeLabel}{projectInfo.usesTailwind ? ' + Tailwind' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {iframeErrors.length > 0 && (
            <span className="text-[10px] text-red-400 mr-1" data-testid="preview-error-count">
              {iframeErrors.length} error{iframeErrors.length > 1 ? 's' : ''}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={() => setShowConsole(v => !v)} data-testid="preview-toggle-console">
            <Terminal className={`w-3.5 h-3.5 ${consoleLogs.length > 0 ? 'text-blue-400' : ''}`} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5"
            onClick={handleRefresh} data-testid="preview-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {iframeErrors.length > 0 && (
        <div className="px-3 py-1.5 bg-red-950/40 border-b border-red-900/40 text-red-300 text-[11px] font-mono max-h-24 overflow-auto" data-testid="preview-error-banner">
          {iframeErrors.map((err, i) => (
            <div key={i} className="flex gap-1.5 items-start py-0.5">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto bg-white flex justify-center relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10" data-testid="preview-loading">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading preview...</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={refreshKey}
          srcDoc={previewHtml}
          title="Preview"
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          className="h-full border-0 transition-all"
          style={{ width: viewports[viewportSize].width, maxWidth: '100%' }}
          onLoad={() => setIframeLoaded(true)}
          data-testid="preview-iframe"
        />
      </div>

      {showConsole && (
        <div className="border-t border-border/40 bg-muted/20 max-h-40 overflow-auto" data-testid="preview-console">
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/30">
            <span className="text-[10px] font-medium text-muted-foreground">
              Console {buildLog.length > 0 && <span className="opacity-50 ml-1">| {buildLog[0]}</span>}
            </span>
            <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setConsoleLogs([])}>
              <span className="text-[9px]">Clear</span>
            </Button>
          </div>
          {consoleLogs.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/50">
              <p>No console output</p>
              {buildLog.length > 1 && (
                <pre className="mt-1 opacity-40">{buildLog.slice(1).join('\n')}</pre>
              )}
            </div>
          ) : (
            <div className="px-3 py-1 font-mono text-[10px] space-y-0.5">
              {consoleLogs.map((log, i) => (
                <div key={i} className={
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'
                }>
                  <span className="opacity-50">[{log.level}]</span> {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
