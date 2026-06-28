'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Globe, Eye, Clock, Code2, Loader2, GitFork } from 'lucide-react'

export default function SharedPreviewPage({ params }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCode, setShowCode] = useState(false)
  const [remixing, setRemixing] = useState(false)
  const [remixError, setRemixError] = useState('')
  const iframeRef = useRef(null)
  const router = useRouter()
  const resolvedParams = params instanceof Promise ? null : params

  useEffect(() => {
    async function load() {
      try {
        const resolved = resolvedParams || await params
        const token = resolved.token
        const res = await fetch(`/api/shared/${token}`)
        if (!res.ok) {
          const err = await res.json()
          setError(err.error || 'Preview not found')
          return
        }
        const d = await res.json()
        setData(d)
      } catch (e) {
        setError('Failed to load preview')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleRemix() {
    const resolved = resolvedParams || await params
    const token = resolved.token
    setRemixing(true)
    setRemixError('')
    try {
      // authFetch is not available on the public share page; use raw fetch.
      // If unauthenticated, redirect to login with a return-URL back here so
      // the user can immediately retry the remix.
      const res = await fetch(`/api/shared/${token}/remix`, { method: 'POST', credentials: 'include' })
      if (res.status === 401) {
        const returnUrl = encodeURIComponent(`/share/${token}?remix=1`)
        router.push(`/auth/login?next=${returnUrl}`)
        return
      }
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Remix failed')
      // Navigate the user straight into their new project
      router.push(`/?project=${result.project.id}`)
    } catch (e) {
      setRemixError(e.message || 'Remix failed')
    } finally {
      setRemixing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0A0E17 0%, #0C1020 50%, #0A0E17 100%)' }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          <p className="text-sm text-white/40">Loading preview...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0A0E17 0%, #0C1020 50%, #0A0E17 100%)' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)' }}>
            <Globe className="w-7 h-7 text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-white mb-2">{error.includes('expired') ? 'Link Expired' : 'Preview Not Found'}</h1>
          <p className="text-sm text-white/40">{error}</p>
        </div>
      </div>
    )
  }

  // Build preview HTML from files
  const files = data.files || []
  const htmlFile = files.find(f => f.path.endsWith('.html') || f.path.endsWith('index.html'))
  const jsxFiles = files.filter(f => f.path.endsWith('.jsx') || f.path.endsWith('.tsx'))
  const cssFiles = files.filter(f => f.path.endsWith('.css'))

  let previewHtml = ''
  if (htmlFile) {
    previewHtml = htmlFile.content
    // Inject CSS files inline
    const cssContent = cssFiles.map(f => f.content).join('\n')
    if (cssContent) {
      previewHtml = previewHtml.replace('</head>', `<style>${cssContent}</style></head>`)
    }
  } else if (jsxFiles.length > 0) {
    // Build React preview with Babel standalone
    const mainFile = jsxFiles.find(f => f.path.includes('page') || f.path.includes('index') || f.path.includes('App')) || jsxFiles[0]
    const cssContent = cssFiles.map(f => f.content).join('\n')
    const allComponents = {}
    jsxFiles.forEach(f => {
      const name = f.path.split('/').pop().replace(/\.(jsx|tsx)$/, '')
      allComponents[name] = f.content
    })

    previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <style>${cssContent}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
    const { useState, useEffect, useRef, useCallback, useMemo } = React;
    ${Object.entries(allComponents).map(([name, code]) => {
      let processed = code
        .replace(/^import\s+.*$/gm, '')
        .replace(/^export\s+default\s+/gm, '')
        .replace(/^export\s+/gm, '')
      return `// ${name}\n${processed}`
    }).join('\n\n')}
    
    const rootEl = document.getElementById('root');
    ReactDOM.createRoot(rootEl).render(React.createElement(${mainFile.path.split('/').pop().replace(/\.(jsx|tsx)$/, '')}));
  <\/script>
</body>
</html>`
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(135deg, #0A0E17 0%, #0C1020 50%, #0A0E17 100%)' }}>
      {/* Header Bar */}
      <div className="h-12 flex items-center justify-between px-5 shrink-0" style={{ background: 'rgba(12,16,32,0.8)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)' }}>
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">{data.title}</h1>
            <div className="flex items-center gap-3 text-[10px] text-white/30">
              <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{data.views} views</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(data.created_at).toLocaleDateString()}</span>
              <span>{files.length} files</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRemix}
            disabled={remixing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
            style={{
              background: 'linear-gradient(135deg, rgba(0,229,255,0.18), rgba(138,43,226,0.18))',
              border: '1px solid rgba(0,229,255,0.30)',
              color: '#5eead4',
            }}
            data-testid="share-remix-btn"
            aria-label="Remix this app into a new project"
          >
            {remixing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Remixing…
              </>
            ) : (
              <>
                <GitFork className="w-3 h-3" /> Remix this app
              </>
            )}
          </button>
          {remixError ? (
            <span role="alert" className="text-[10px] text-red-400" data-testid="share-remix-error">{remixError}</span>
          ) : null}
          <button
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200"
            style={{
              background: showCode ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.04)',
              border: showCode ? '1px solid rgba(0,229,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
              color: showCode ? '#00E5FF' : 'rgba(255,255,255,0.5)',
            }}
            data-testid="share-toggle-code"
          >
            <Code2 className="w-3 h-3" />
            {showCode ? 'Preview' : 'Code'}
          </button>
          <a
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200"
            style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)', color: '#00E5FF' }}
            data-testid="share-build-own"
          >
            Build Your Own
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {showCode ? (
          <div className="h-full overflow-auto p-6 space-y-4">
            {files.map((f, i) => (
              <div key={i} className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-4 py-2 text-[11px] font-mono font-semibold text-cyan-400" style={{ background: 'rgba(0,229,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {f.path}
                </div>
                <pre className="p-4 text-xs text-white/70 overflow-x-auto font-mono leading-relaxed" style={{ background: 'rgba(12,16,32,0.5)' }}>
                  {f.content}
                </pre>
              </div>
            ))}
          </div>
        ) : previewHtml ? (
          <iframe
            ref={iframeRef}
            srcDoc={previewHtml}
            className="w-full h-full border-0"
            style={{ background: 'white' }}
            sandbox="allow-scripts allow-same-origin"
            title={data.title}
            data-testid="share-preview-iframe"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Code2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
              <p className="text-sm text-white/40">No preview available for this project type</p>
              <button onClick={() => setShowCode(true)} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">View source code instead</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
