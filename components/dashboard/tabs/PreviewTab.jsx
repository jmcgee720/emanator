'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  RefreshCw, AlertTriangle, MonitorSmartphone, Tablet, Monitor,
  Loader2, FileCode, AlertCircle, Terminal
} from 'lucide-react'

// ─── Project classifier ────────────────────────────────────────────
function classifyProject(files) {
  if (!files?.length) return { type: 'empty', files: [] }

  // Filter out generated assets and uploads — they are NOT code files
  const codeFiles = files.filter(f => {
    if (!f.path) return false
    if (f.path.startsWith('_generated/')) return false
    if (f.path.startsWith('_uploads/')) return false
    if (f.path.startsWith('_assets/')) return false
    if (f.file_type === 'image') return false
    return true
  })

  // If the project only contains non-code files (assets/images), show a clear message
  if (codeFiles.length === 0) {
    const assetCount = files.filter(f => f.path?.startsWith('_generated/') || f.path?.startsWith('_uploads/')).length
    if (assetCount > 0) {
      return { type: 'assets-only', assetCount, files }
    }
    return { type: 'empty', files: [] }
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

  // Priority check: if index.html is a complete standalone HTML document
  // (has <!DOCTYPE or <html AND inline <style>), use HTML mode regardless
  // of whether other .jsx files exist in the project.
  // This handles mixed projects where the user generated a standalone HTML page.
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
// This is the critical function that prevents duplicate identifier errors.
// It removes every form of "bring React / hooks into scope" because the
// preview shell already provides them as globals via CDN + a single `var`.
function stripReactBindings(code) {
  // 1. ESM imports from 'react' / 'react-dom' / 'react-dom/client'
  //    import React from 'react'
  //    import { useState, useEffect } from 'react'
  //    import * as React from 'react'
  //    import React, { useState } from 'react'
  code = code.replace(/import\s+(?:React\s*,\s*)?\{[^}]*\}\s+from\s+['"]react['"];?\s*/g, '')
  code = code.replace(/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+['"]react['"];?\s*/g, '')
  code = code.replace(/import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]react-dom(?:\/client)?['"];?\s*/g, '')

  // 2. CJS require
  //    const React = require('react')
  //    const { useState } = require('react')
  code = code.replace(/(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*['"]react(?:-dom)?(?:\/client)?['"]\s*\)\s*;?\s*/g, '')

  // 3. Destructuring from the React global
  //    const { useState, useEffect, useRef } = React;
  //    This is the pattern that caused the original crash.
  code = code.replace(/(?:const|let|var)\s+\{[^}]*\}\s*=\s*React\s*;?\s*/g, '')

  // 4. Relative imports (the inlined components are concatenated, not modules)
  code = code.replace(/import\s+.*?\s+from\s+['"]\.\.?\/[^'"]+['"];?\s*/g, '')

  // 5. CSS imports
  code = code.replace(/import\s+['"][^'"]+\.css['"];?\s*/g, '')

  // 6. TypeScript `import type`
  code = code.replace(/import\s+type\s+.*?from\s+['"][^'"]+['"]\s*;?/g, '')

  return code
}

// ─── Strip simple TypeScript annotations ───────────────────────────
// IMPORTANT: Only strip annotations that cannot be JavaScript values.
// DO NOT strip `: null`, `: undefined`, `: object` etc. as these are
// commonly used as property values in plain JS objects.
function stripTypeScript(code) {
  // Only strip unambiguous TS-only annotations that never appear as JS values
  // e.g., param: string, arg: number, x: boolean, cb: React.FC<Props>
  // These are preceded by an identifier and followed by , ) = ; { or newline.
  // We use a lookbehind for a word char + optional ? to ensure this is a param annotation.
  code = code.replace(/(?<=\w\??)\s*:\s*(?:string|number|boolean|any|void|never|unknown|React\.\w+(?:<[^>]*>)?|JSX\.Element)(?:\[\])?\s*(?=[,)=;{\n])/g, '')
  // Remove interface / type declarations (top-level only)
  code = code.replace(/(?:export\s+)?(?:interface|type)\s+\w+\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]+)?\{[^}]*\}/g, '')
  return code
}

// ─── Convert exports to window.__COMPONENTS__ assignments ──────────
function convertExports(code, fallbackName) {
  const safeName = fallbackName.replace(/[^a-zA-Z0-9_]/g, '_')
  code = code.replace(/export\s+default\s+function\s+(\w+)/g, `window.__COMPONENTS__.$1 = function $1`)
  code = code.replace(/export\s+default\s+class\s+(\w+)/g, `window.__COMPONENTS__.$1 = class $1`)
  code = code.replace(/export\s+default\s+/g, `window.__COMPONENTS__.${safeName} = `)
  // Named exports: export const Foo = …  →  window.__COMPONENTS__.Foo = …
  code = code.replace(/export\s+(const|let|var|function|class)\s+(\w+)/g, (_, kw, name) => {
    return `window.__COMPONENTS__.${name} = ${kw === 'function' || kw === 'class' ? `${kw} ${name}` : ''}`
  })
  // Cleanup leftover `export { … };`
  code = code.replace(/export\s+\{[^}]*\}\s*;?/g, '')
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
    const linkPattern = new RegExp('<link[^>]*href=["\'](?:\\.\\/)?'+ escapeRegex(fileName) +'["\'][^>]*\\/?>','gi')
    if (linkPattern.test(html)) {
      html = html.replace(linkPattern, '<style>\n' + cssFile.content + '\n</style>')
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', '<style>\n' + cssFile.content + '\n</style>\n</head>')
    }
  }

  for (const jsFile of jsFiles) {
    const fileName = jsFile.path.split('/').pop()
    const scriptPattern = new RegExp('<script[^>]*src=["\'](?:\\.\\/)?'+ escapeRegex(fileName) +'["\'][^>]*>\\s*<\\/script>','gi')
    if (scriptPattern.test(html)) {
      html = html.replace(scriptPattern, '<script>\n' + jsFile.content + '\n<\/script>')
    }
    // Only inline JS files that are referenced in the HTML via <script src="...">.
    // Do NOT blindly append unrelated JS files (e.g., React entry points with
    // `import` statements) — they cause SyntaxError in a non-module context.
  }

  return wrapWithErrorHandler(html)
}

// ─── Build: React/JSX ──────────────────────────────────────────────
//
// Strategy:
//   • React 18 UMD + ReactDOM UMD loaded via CDN  → `React` and `ReactDOM` are globals
//   • ONE `<script type="text/babel">` block with:
//       – A SINGLE `var` destructure of hooks from `React`
//       – All component code concatenated (imports stripped, exports converted)
//       – A render call at the bottom
//   • Babel standalone transpiles JSX at runtime, then injects ONE regular <script>
//   • Because we use `var` (not `const`) for the destructure, a stray re-declaration
//     in component code would merely shadow — but we strip those too, so it's clean.
//
function buildReactPreview({ htmlFiles, cssFiles, jsFiles, jsxFiles, tsFiles, usesTailwind }) {
  const allCss = cssFiles?.map(f => f.content).join('\n') || ''

  // Collect component files
  const componentFiles = [...(jsxFiles || []), ...(tsFiles || [])]
  const reactJsFiles = (jsFiles || []).filter(f => {
    const c = f.content || ''
    return c.includes('React') || c.includes('useState') || c.includes('export default') || /<\w+[\s/>]/.test(c)
  })
  const allComponents = [...componentFiles, ...reactJsFiles]

  // Find entry point
  const entryFile =
    allComponents.find(f => f.path.match(/App\.(jsx|tsx|js)$/i)) ||
    allComponents.find(f => f.path.match(/index\.(jsx|tsx|js)$/i)) ||
    allComponents.find(f => f.path.match(/page\.(jsx|tsx|js)$/i)) ||
    allComponents[0]

  if (!entryFile) return null

  const entryName = entryFile.path.replace(/^\.\//, '').replace(/\.(jsx|tsx|js|ts)$/, '').split('/').pop()

  // Build debug info
  const debugFiles = allComponents.map(f => f.path).join(', ')

  // Process each component file
  let assembledCode = ''
  for (const f of allComponents) {
    let code = f.content
    code = stripTypeScript(code)
    code = stripReactBindings(code)

    const modName = f.path.replace(/^\.\//, '').replace(/\.(jsx|tsx|js|ts)$/, '').split('/').pop()

    code = code.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
code = code.replace(/import\s+['"][^'"]+['"];?/g, '')
code = code.replace(/^\s*import\s.*$/gm, '')
    code = code.replace(/export\s+default/g, 'window.__COMPONENTS__["' + modName + '"] =')
code = code.replace(/export\s+\{[^}]+\};?/g, '')
    assembledCode += '\n// --- ' + f.path + ' ---\n' + code + '\n'
  }

  // CRITICAL: Build HTML via concatenation, NOT template literals.
  // User code may contain ${...} (e.g. "${ price }" in JSX text for currency)
  // which would be evaluated as template expressions if placed inside backticks.
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
// Component
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

  // Auto-refresh when files change
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

  // Listen for messages from iframe
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

  // Build preview
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
    p.endsWith('.html')
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
      case 'html':   html = buildHtmlPreview(info); break
      case 'react':  html = buildReactPreview({ ...info, files: clientFiles }); break
      case 'js':     html = buildJsPreview(info); break
      case 'css-only': html = buildCssPreview(info); break
    }

    if (html) log.push(`Output: ${html.length} chars`)

    return { previewHtml: html, projectInfo: info, buildLog: log }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, refreshKey])

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
    setIframeErrors([])
    setConsoleLogs([])
    setIframeLoaded(false)
  }, [])

  // ─── Empty states ──────────────────────────────────────────────

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground" data-testid="preview-empty">
        <p className="text-sm">Select a project to preview</p>
      </div>
    )
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
          <p className="text-xs mt-2 opacity-50">
            Ask the AI to build a web page or app to see a live preview here.
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
            This project contains {files?.length} file(s) of other types.
          </p>
          <div className="mt-3 text-xs opacity-50">
            {files?.slice(0, 5).map(f => f.path).join(', ')}
          </div>
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
            Try regenerating the files with an index.html entry point.
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

  // ─── Preview render ────────────────────────────────────────────

  const modeLabel = projectInfo.type === 'react' ? 'React (Babel)' :
    projectInfo.type === 'html' ? 'HTML' :
    projectInfo.type === 'js' ? 'JavaScript' :
    projectInfo.type === 'css-only' ? 'CSS Only' : 'Preview'

  return (
    <div className="h-full flex flex-col bg-background" data-testid="preview-tab">
      {/* Toolbar */}
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
          <span className="ml-2 text-[10px] font-mono text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded"
                data-testid="preview-mode-label">
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

      {/* Error banner */}
      {iframeErrors.length > 0 && (
        <div className="px-3 py-1.5 bg-red-950/40 border-b border-red-900/40 text-red-300 text-[11px] font-mono max-h-24 overflow-auto"
             data-testid="preview-error-banner">
          {iframeErrors.map((err, i) => (
            <div key={i} className="flex gap-1.5 items-start py-0.5">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {/* iframe */}
      <div className="flex-1 overflow-auto bg-white flex justify-center relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10" data-testid="preview-loading">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading preview…</span>
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

      {/* Console panel */}
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
