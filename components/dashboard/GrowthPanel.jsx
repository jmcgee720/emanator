'use client'

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Globe, Search, BarChart3, Loader2, Trash2, ExternalLink, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const ISSUE_SECTIONS = [
  { key: 'title_issues', label: 'Title Issues', color: 'var(--em-cyan)' },
  { key: 'meta_issues', label: 'Meta Issues', color: '#a78bfa' },
  { key: 'content_issues', label: 'Content Issues', color: '#f59e0b' },
  { key: 'structure_issues', label: 'Structure Issues', color: '#f87171' },
  { key: 'recommendations', label: 'Recommendations', color: '#34d399' },
]

export default function GrowthPanel({ onClose }) {
  const [url, setUrl] = useState('')
  const [pages, setPages] = useState([])
  const [selectedPage, setSelectedPage] = useState(null)
  const [crawling, setCrawling] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [loadingPages, setLoadingPages] = useState(true)
  const [error, setError] = useState(null)

  const fetchPages = useCallback(async () => {
    setLoadingPages(true)
    try {
      const res = await authFetch('/api/growth/pages')
      const data = await res.json()
      if (data.pages) setPages(data.pages)
    } catch {
      // silent
    } finally {
      setLoadingPages(false)
    }
  }, [])

  useEffect(() => { fetchPages() }, [fetchPages])

  const handleCrawl = async () => {
    if (!url.trim()) return
    setError(null)
    setCrawling(true)
    try {
      const res = await authFetch('/api/growth/crawl', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ url: url.trim() }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { setError(text.slice(0, 200) || 'Crawl failed'); return }
      if (!res.ok) { setError(data.error || 'Crawl failed'); return }
      setUrl('')
      await fetchPages()
      // Auto-select the newly crawled page
      if (data.page_id) {
        const pageRes = await authFetch(`/api/growth/pages/${data.page_id}`)
        const pageData = await pageRes.json()
        if (pageData.page) setSelectedPage(pageData.page)
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setCrawling(false)
    }
  }

  const handleAnalyze = async () => {
    if (!selectedPage?.id) return
    setError(null)
    setAnalyzing(true)
    try {
      const res = await authFetch('/api/growth/analyze', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ page_id: selectedPage.id }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { setError(text.slice(0, 200) || 'Analysis failed'); return }
      if (!res.ok) { setError(data.error || 'Analysis failed'); return }
      setSelectedPage(prev => ({ ...prev, opportunities: data.opportunities }))
      // Refresh list to show updated status
      fetchPages()
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleDelete = async (pageId) => {
    try {
      await authFetch(`/api/growth/pages/${pageId}`, { method: 'DELETE' })
      if (selectedPage?.id === pageId) setSelectedPage(null)
      fetchPages()
    } catch {
      // silent
    }
  }

  const ext = selectedPage?.extracted_data

  return (
    <div className="flex flex-col h-full" data-testid="growth-panel">
      {/* Header */}
      <div className="h-12 em-glass-topbar flex items-center gap-3 px-5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 em-text-muted hover:text-[var(--em-cyan)]"
          data-testid="growth-back-btn"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <BarChart3 className="w-4 h-4 text-[var(--em-cyan)]" />
        <span className="text-sm font-semibold text-[var(--em-text-primary)]">Growth Engine</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: URL input + pages list */}
        <div className="w-80 border-r border-[rgba(255,255,255,0.08)] flex flex-col shrink-0">
          {/* URL input */}
          <div className="p-3 border-b border-[rgba(255,255,255,0.08)]">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 em-text-muted" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCrawl()}
                  placeholder="Enter URL to crawl..."
                  className="w-full h-8 pl-8 pr-3 rounded-lg text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--em-text-primary)] placeholder:text-[var(--em-text-muted)] focus:outline-none focus:border-[var(--em-cyan)] transition-colors"
                  disabled={crawling}
                  data-testid="growth-url-input"
                />
              </div>
              <Button
                onClick={handleCrawl}
                disabled={crawling || !url.trim()}
                className="h-8 px-3 text-xs font-semibold bg-[var(--em-cyan)] text-[#0C1018] hover:brightness-110 disabled:opacity-40"
                data-testid="growth-crawl-btn"
              >
                {crawling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Crawl'}
              </Button>
            </div>
            {error && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-400" data-testid="growth-error">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Pages list */}
          <div className="flex-1 overflow-y-auto">
            {loadingPages ? (
              <div className="flex items-center justify-center py-8" data-testid="growth-pages-loading">
                <Loader2 className="w-4 h-4 animate-spin em-text-muted" />
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center" data-testid="growth-pages-empty">
                <Search className="w-6 h-6 em-text-muted mb-2" />
                <p className="text-xs em-text-muted">No pages crawled yet</p>
                <p className="text-[10px] em-text-muted mt-1">Enter a URL above to start</p>
              </div>
            ) : (
              <div className="py-1" data-testid="growth-pages-list">
                {pages.map((page) => (
                  <div
                    key={page.id}
                    onClick={() => {
                      // Fetch full page detail
                      authFetch(`/api/growth/pages/${page.id}`)
                        .then(r => r.json())
                        .then(d => { if (d.page) setSelectedPage(d.page) })
                    }}
                    className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                      selectedPage?.id === page.id
                        ? 'bg-[rgba(255,255,255,0.08)]'
                        : 'hover:bg-[rgba(255,255,255,0.04)]'
                    }`}
                    data-testid={`growth-page-item-${page.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--em-text-primary)] truncate font-medium">
                        {page.extracted_data?.title || page.url}
                      </p>
                      <p className="text-[10px] em-text-muted truncate">{page.url}</p>
                    </div>
                    {page.opportunities && (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(page.id) }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-opacity"
                      data-testid={`growth-delete-${page.id}`}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Page detail + opportunities */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPage ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6" data-testid="growth-detail-empty">
              <BarChart3 className="w-8 h-8 em-text-muted mb-3" />
              <p className="text-sm em-text-muted">Select a page to view SEO data</p>
              <p className="text-xs em-text-muted mt-1">Or crawl a new URL to get started</p>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Page header */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--em-text-primary)] truncate">
                    {ext?.title || 'Untitled Page'}
                  </h2>
                  <a
                    href={selectedPage.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[var(--em-cyan)] hover:underline mt-0.5"
                    data-testid="growth-page-url-link"
                  >
                    {selectedPage.url}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="shrink-0 h-8 px-4 text-xs font-semibold bg-[var(--em-cyan)] text-[#0C1018] hover:brightness-110 disabled:opacity-40"
                  data-testid="growth-analyze-btn"
                >
                  {analyzing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Analyzing...</>
                  ) : (
                    <><BarChart3 className="w-3.5 h-3.5 mr-1.5" />Analyze SEO</>
                  )}
                </Button>
              </div>

              {/* Extracted data summary */}
              {ext && (
                <div className="grid grid-cols-4 gap-3" data-testid="growth-extracted-summary">
                  {[
                    { label: 'Words', value: ext.word_count },
                    { label: 'Internal Links', value: ext.internal_links },
                    { label: 'External Links', value: ext.external_links },
                    { label: 'Images', value: `${ext.images_with_alt}/${ext.total_images}` },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] p-3">
                      <p className="text-[10px] em-text-muted uppercase tracking-wider">{label}</p>
                      <p className="text-lg font-semibold text-[var(--em-text-primary)] mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Meta details */}
              {ext && (
                <div className="space-y-2" data-testid="growth-meta-details">
                  <MetaRow label="Title" value={ext.title} length={ext.title_length} ideal="50-60 chars" />
                  <MetaRow label="Meta Description" value={ext.meta_description} length={ext.meta_description_length} ideal="150-160 chars" />
                  <MetaRow label="Canonical" value={ext.canonical} />
                  <MetaRow label="Robots" value={ext.meta_robots} />
                  {ext.headings && Object.keys(ext.headings).length > 0 && (
                    <div className="rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-3">
                      <p className="text-[10px] em-text-muted uppercase tracking-wider mb-1.5">Headings</p>
                      {Object.entries(ext.headings).map(([tag, texts]) => (
                        <div key={tag} className="flex gap-2 mt-1">
                          <span className="text-[10px] font-mono text-[var(--em-cyan)] uppercase w-6 shrink-0">{tag}</span>
                          <span className="text-xs text-[var(--em-text-secondary)] truncate">{texts.join(' | ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SEO Opportunities */}
              {selectedPage.opportunities ? (
                <div className="space-y-3" data-testid="growth-opportunities">
                  <h3 className="text-xs font-semibold em-text-muted uppercase tracking-wider">SEO Opportunities</h3>
                  {ISSUE_SECTIONS.map(({ key, label, color }) => {
                    const items = selectedPage.opportunities[key]
                    if (!items || items.length === 0) return null
                    return (
                      <div key={key} className="rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-3" data-testid={`growth-section-${key}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          <p className="text-xs font-semibold text-[var(--em-text-primary)]">{label}</p>
                          <span className="text-[10px] em-text-muted ml-auto">{items.length}</span>
                        </div>
                        <ul className="space-y-1.5">
                          {items.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-[var(--em-text-secondary)]">
                              <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" style={{ color }} />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-6 text-center" data-testid="growth-no-analysis">
                  <BarChart3 className="w-5 h-5 em-text-muted mx-auto mb-2" />
                  <p className="text-xs em-text-muted">No analysis yet</p>
                  <p className="text-[10px] em-text-muted mt-1">Click "Analyze SEO" to generate opportunities</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value, length, ideal }) {
  const missing = !value
  return (
    <div className="rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] em-text-muted uppercase tracking-wider">{label}</p>
        {length !== undefined && (
          <span className="text-[10px] em-text-muted">{length} chars {ideal && `(ideal: ${ideal})`}</span>
        )}
      </div>
      <p className={`text-xs mt-1 ${missing ? 'text-red-400 italic' : 'text-[var(--em-text-secondary)]'}`}>
        {missing ? 'Missing' : value}
      </p>
    </div>
  )
}
