'use client'

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Globe, Search, BarChart3, Loader2, Trash2, ExternalLink, AlertCircle, CheckCircle2, ChevronRight, Sparkles, TrendingUp, FileSearch } from 'lucide-react'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const ISSUE_SECTIONS = [
  { key: 'title_issues', label: 'Title', icon: FileSearch, gradient: 'linear-gradient(135deg, #00E5FF, #0EA5E9)' },
  { key: 'meta_issues', label: 'Meta', icon: Globe, gradient: 'linear-gradient(135deg, #7C3AED, #A78BFA)' },
  { key: 'content_issues', label: 'Content', icon: BarChart3, gradient: 'linear-gradient(135deg, #F59E0B, #FBBF24)' },
  { key: 'structure_issues', label: 'Structure', icon: TrendingUp, gradient: 'linear-gradient(135deg, #F87171, #FB923C)' },
  { key: 'recommendations', label: 'Recommendations', icon: Sparkles, gradient: 'linear-gradient(135deg, #34D399, #6EE7B7)' },
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
  const totalIssues = selectedPage?.opportunities
    ? Object.values(selectedPage.opportunities).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--em-void)' }} data-testid="growth-panel">

      {/* ── Header ── */}
      <div className="em-glass-topbar h-14 flex items-center gap-4 px-6 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 hover:bg-[rgba(255,255,255,0.08)]"
          data-testid="growth-back-btn"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--em-text-muted)]" />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="growth-icon-glow flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: 'rgba(0,229,255,0.08)' }}>
            <BarChart3 className="w-3.5 h-3.5 text-[var(--em-cyan)]" />
          </div>
          <span className="em-gradient-text text-sm font-bold tracking-wide">Growth Engine</span>
        </div>
        {pages.length > 0 && (
          <span className="ml-auto text-[11px] text-[var(--em-text-muted)] font-medium tabular-nums">
            {pages.length} page{pages.length !== 1 ? 's' : ''} crawled
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Sidebar ── */}
        <div className="em-glass-sidebar em-glass-sidebar-edge w-80 flex flex-col shrink-0 relative">

          {/* URL Input */}
          <div className="p-4 space-y-3">
            <div className="em-input flex items-center gap-2 px-3 h-10 rounded-xl">
              <Globe className="w-3.5 h-3.5 text-[var(--em-text-muted)] shrink-0" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCrawl()}
                placeholder="Enter URL to analyze..."
                className="flex-1 bg-transparent text-xs text-[var(--em-text-primary)] placeholder:text-[var(--em-text-muted)] outline-none"
                disabled={crawling}
                data-testid="growth-url-input"
              />
            </div>
            <button
              onClick={handleCrawl}
              disabled={crawling || !url.trim()}
              className="w-full h-9 rounded-xl text-xs font-semibold transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: crawling ? 'rgba(0,229,255,0.15)' : 'linear-gradient(135deg, rgba(0,229,255,0.15) 0%, rgba(124,58,237,0.12) 100%)',
                border: '1px solid rgba(0,229,255,0.25)',
                color: 'var(--em-cyan)',
              }}
              data-testid="growth-crawl-btn"
            >
              {crawling ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Crawling...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Search className="w-3.5 h-3.5" />
                  Crawl & Extract
                </span>
              )}
            </button>
            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.15)]" data-testid="growth-error">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                <span className="text-[11px] text-red-300 leading-relaxed">{error}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.12), rgba(124,58,237,0.08), transparent)' }} />

          {/* Pages List */}
          <div className="flex-1 overflow-y-auto py-2">
            {loadingPages ? (
              <div className="flex flex-col items-center justify-center py-16" data-testid="growth-pages-loading">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--em-cyan)]" style={{ opacity: 0.5 }} />
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6" data-testid="growth-pages-empty">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.1)' }}>
                  <Globe className="w-5 h-5 text-[var(--em-cyan)]" style={{ opacity: 0.4 }} />
                </div>
                <p className="text-xs text-[var(--em-text-muted)] font-medium">No pages yet</p>
                <p className="text-[10px] text-[var(--em-text-muted)] mt-1" style={{ opacity: 0.6 }}>Enter a URL above to begin</p>
              </div>
            ) : (
              <div data-testid="growth-pages-list">
                {pages.map((page) => {
                  const isActive = selectedPage?.id === page.id
                  return (
                    <div
                      key={page.id}
                      onClick={() => {
                        authFetch(`/api/growth/pages/${page.id}`)
                          .then(r => r.json())
                          .then(d => { if (d.page) setSelectedPage(d.page) })
                      }}
                      className="group relative mx-2 mb-0.5 rounded-xl px-3 py-2.5 cursor-pointer transition-all duration-200"
                      style={{
                        background: isActive ? 'rgba(0,229,255,0.06)' : 'transparent',
                        border: isActive ? '1px solid rgba(0,229,255,0.12)' : '1px solid transparent',
                      }}
                      data-testid={`growth-page-item-${page.id}`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full" style={{ background: 'var(--em-cyan)' }} />
                      )}
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--em-text-primary)] truncate leading-snug">
                            {page.extracted_data?.title || page.url}
                          </p>
                          <p className="text-[10px] text-[var(--em-text-muted)] truncate mt-0.5">{page.url}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {page.opportunities && (
                            <div className="flex items-center justify-center w-5 h-5 rounded-md" style={{ background: 'rgba(52,211,153,0.1)' }}>
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            </div>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(page.id) }}
                            className="flex items-center justify-center w-5 h-5 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150 hover:bg-[rgba(248,113,113,0.12)]"
                            data-testid={`growth-delete-${page.id}`}
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Detail ── */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPage ? (
            <div className="flex flex-col items-center justify-center h-full" data-testid="growth-detail-empty">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.06)' }}>
                <BarChart3 className="w-7 h-7 text-[var(--em-cyan)]" style={{ opacity: 0.25 }} />
              </div>
              <p className="text-sm text-[var(--em-text-muted)] font-medium">Select a page to inspect</p>
              <p className="text-xs text-[var(--em-text-muted)] mt-1.5" style={{ opacity: 0.5 }}>Crawl a URL or choose from the sidebar</p>
            </div>
          ) : (
            <div className="p-8 max-w-4xl mx-auto space-y-8">

              {/* Page header */}
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-[var(--em-text-primary)] leading-tight tracking-tight">
                    {ext?.title || 'Untitled Page'}
                  </h2>
                  <a
                    href={selectedPage.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-xs text-[var(--em-text-muted)] hover:text-[var(--em-cyan)] transition-colors duration-200"
                    data-testid="growth-page-url-link"
                  >
                    {selectedPage.url}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="shrink-0 em-btn-brand h-9 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-40 transition-all duration-300"
                  data-testid="growth-analyze-btn"
                >
                  {analyzing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing...</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" />Analyze SEO</>
                  )}
                </button>
              </div>

              {/* Metrics grid */}
              {ext && (
                <div className="grid grid-cols-4 gap-4" data-testid="growth-extracted-summary">
                  {[
                    { label: 'Word Count', value: ext.word_count?.toLocaleString(), accent: '--em-cyan' },
                    { label: 'Internal Links', value: ext.internal_links, accent: '--em-violet' },
                    { label: 'External Links', value: ext.external_links, accent: '--em-magenta' },
                    { label: 'Image Alt Coverage', value: `${ext.images_with_alt}/${ext.total_images}`, accent: '--em-cyan' },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="growth-metric-card em-card p-4">
                      <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: `var(${accent})`, opacity: 0.7 }}>{label}</p>
                      <p className="text-2xl font-bold text-[var(--em-text-primary)] mt-2 tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Meta details */}
              {ext && (
                <div className="space-y-3" data-testid="growth-meta-details">
                  <h3 className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">Page Metadata</h3>
                  <div className="em-card p-5 space-y-4">
                    <MetaRow label="Title" value={ext.title} length={ext.title_length} ideal="50-60" />
                    <div className="h-px" style={{ background: 'rgba(124,58,237,0.08)' }} />
                    <MetaRow label="Meta Description" value={ext.meta_description} length={ext.meta_description_length} ideal="150-160" />
                    <div className="h-px" style={{ background: 'rgba(124,58,237,0.08)' }} />
                    <MetaRow label="Canonical URL" value={ext.canonical} />
                    <div className="h-px" style={{ background: 'rgba(124,58,237,0.08)' }} />
                    <MetaRow label="Robots" value={ext.meta_robots} />
                  </div>
                  {ext.headings && Object.keys(ext.headings).length > 0 && (
                    <div className="em-card p-5">
                      <h4 className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)] mb-3">Heading Hierarchy</h4>
                      <div className="space-y-2">
                        {Object.entries(ext.headings).map(([tag, texts]) => (
                          <div key={tag} className="flex gap-3 items-start">
                            <span className="text-[10px] font-mono font-bold uppercase w-7 shrink-0 text-[var(--em-cyan)] mt-px" style={{ opacity: 0.7 }}>{tag}</span>
                            <span className="text-xs text-[var(--em-text-secondary)] leading-relaxed">{texts.join(' \u2022 ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SEO Opportunities */}
              {selectedPage.opportunities ? (
                <div className="space-y-4" data-testid="growth-opportunities">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">SEO Opportunities</h3>
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: 'var(--em-cyan)', opacity: 0.6 }}>
                      {totalIssues} finding{totalIssues !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {ISSUE_SECTIONS.map(({ key, label, icon: Icon, gradient }) => {
                    const items = selectedPage.opportunities[key]
                    if (!items || items.length === 0) return null
                    return (
                      <div key={key} className="growth-issue-section em-card overflow-hidden" data-testid={`growth-section-${key}`}>
                        <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid rgba(124,58,237,0.08)' }}>
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: gradient, opacity: 0.9 }}>
                            <Icon className="w-3 h-3 text-white" />
                          </div>
                          <span className="text-xs font-semibold text-[var(--em-text-primary)]">{label}</span>
                          <span className="ml-auto text-[10px] font-bold tabular-nums rounded-md px-1.5 py-0.5" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--em-text-muted)' }}>
                            {items.length}
                          </span>
                        </div>
                        <div className="px-5 py-3 space-y-2.5">
                          {items.map((item, i) => (
                            <div key={i} className="flex items-start gap-3">
                              <ChevronRight className="w-3 h-3 mt-1 shrink-0 text-[var(--em-text-muted)]" style={{ opacity: 0.4 }} />
                              <span className="text-xs text-[var(--em-text-secondary)] leading-relaxed">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="em-card p-10 text-center" data-testid="growth-no-analysis">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.1)' }}>
                    <Sparkles className="w-5 h-5 text-[var(--em-violet)]" style={{ opacity: 0.4 }} />
                  </div>
                  <p className="text-sm font-medium text-[var(--em-text-muted)]">Ready for analysis</p>
                  <p className="text-xs text-[var(--em-text-muted)] mt-1.5" style={{ opacity: 0.5 }}>
                    Click "Analyze SEO" to generate AI-powered insights
                  </p>
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
  const charInfo = length !== undefined && ideal
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--em-text-muted)]">{label}</span>
          {charInfo && (
            <span className="text-[10px] tabular-nums text-[var(--em-text-muted)]" style={{ opacity: 0.5 }}>
              {length} chars (ideal: {ideal})
            </span>
          )}
        </div>
        <p className={`text-xs mt-1 leading-relaxed ${missing ? 'italic text-red-400/60' : 'text-[var(--em-text-secondary)]'}`}>
          {missing ? 'Not set' : value}
        </p>
      </div>
      {!missing && (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/40 shrink-0 mt-1" />
      )}
    </div>
  )
}
