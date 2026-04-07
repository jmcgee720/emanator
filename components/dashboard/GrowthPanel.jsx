'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Globe, Search, BarChart3, Loader2, Trash2, ExternalLink, AlertCircle, CheckCircle2, ChevronRight, Sparkles, TrendingUp, FileSearch, Copy, Check, Users, Plus, X, ThumbsUp, ThumbsDown, Network, List, Download, Zap, Eye, RefreshCw, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const ISSUE_SECTIONS = [
  { key: 'title_issues', label: 'Title', icon: FileSearch, gradient: 'linear-gradient(135deg, #00E5FF, #0EA5E9)' },
  { key: 'meta_issues', label: 'Meta', icon: Globe, gradient: 'linear-gradient(135deg, #7C3AED, #A78BFA)' },
  { key: 'content_issues', label: 'Content', icon: BarChart3, gradient: 'linear-gradient(135deg, #F59E0B, #FBBF24)' },
  { key: 'structure_issues', label: 'Structure', icon: TrendingUp, gradient: 'linear-gradient(135deg, #F87171, #FB923C)' },
  { key: 'recommendations', label: 'Recommendations', icon: Sparkles, gradient: 'linear-gradient(135deg, #34D399, #6EE7B7)' },
]

export default function GrowthPanel({ onClose, onFixIssue, onBuildBetter }) {
  const [url, setUrl] = useState('')
  const [pages, setPages] = useState([])
  const [selectedPage, setSelectedPage] = useState(null)
  const [crawling, setCrawling] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [loadingPages, setLoadingPages] = useState(true)
  const [error, setError] = useState(null)
  const [trends, setTrends] = useState([])
  const [fetchingTrends, setFetchingTrends] = useState(false)
  const [personas, setPersonas] = useState([])
  const [showPersonaForm, setShowPersonaForm] = useState(false)
  const [newPersonaName, setNewPersonaName] = useState('')
  const [newPersonaDesc, setNewPersonaDesc] = useState('')
  const [creatingPersona, setCreatingPersona] = useState(false)
  const [selectedPersonaId, setSelectedPersonaId] = useState(null) // null = "Auto"
  const [personaResults, setPersonaResults] = useState({}) // { personaKey: { opportunities, fixes, persona_name } }
  const [activeResultTab, setActiveResultTab] = useState(null) // which result tab is active
  const [generatingDrafts, setGeneratingDrafts] = useState(false)
  const [feedbackMap, setFeedbackMap] = useState({}) // { content_type: rating }
  const [crawlMode, setCrawlMode] = useState('single')
  const [maxPages, setMaxPages] = useState(10)
  const [batchSummary, setBatchSummary] = useState(null)
  const [pagesView, setPagesView] = useState('list') // 'list' | 'map'
  const [batchProgress, setBatchProgress] = useState(null) // { pages_attempted, pages_saved, pages_failed, max_pages, current_url }
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState(null) // { current, total, currentTitle }
  const [monitors, setMonitors] = useState([])
  const [loadingMonitors, setLoadingMonitors] = useState(false)
  const [selectedMonitor, setSelectedMonitor] = useState(null)
  const [checkingMonitor, setCheckingMonitor] = useState(null)
  const [sidebarTab, setSidebarTab] = useState('pages') // 'pages' | 'monitors'

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await authFetch('/api/personas')
      const data = await res.json()
      if (data.personas) setPersonas(data.personas)
    } catch {}
  }, [])

  const handleCreatePersona = async () => {
    if (!newPersonaName.trim()) return
    setCreatingPersona(true)
    try {
      const res = await authFetch('/api/personas/create', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: newPersonaName.trim(), description: newPersonaDesc.trim() }),
      })
      if (res.ok) {
        setNewPersonaName('')
        setNewPersonaDesc('')
        setShowPersonaForm(false)
        fetchPersonas()
      }
    } catch {}
    setCreatingPersona(false)
  }

  const handleDeletePersona = async (personaId) => {
    try {
      await authFetch(`/api/personas/${personaId}`, { method: 'DELETE' })
      fetchPersonas()
    } catch {}
  }

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

  useEffect(() => { fetchPersonas() }, [fetchPersonas])

  useEffect(() => {
    authFetch('/api/trends')
      .then(r => r.json())
      .then(d => { if (d.trends) setTrends(d.trends) })
      .catch(() => {})
  }, [])

  const handleFetchTrends = async () => {
    setFetchingTrends(true)
    try {
      await authFetch('/api/trends/fetch', { method: 'POST', headers: JSON_HEADERS, body: '{}' })
      const res = await authFetch('/api/trends')
      const data = await res.json()
      if (data.trends) setTrends(data.trends)
    } catch {
      // silent
    } finally {
      setFetchingTrends(false)
    }
  }

  const handleCrawl = async () => {
    if (!url.trim()) return
    setError(null)
    setCrawling(true)
    setBatchSummary(null)
    setBatchProgress(null)

    // Start polling for batch mode
    let pollInterval = null
    if (crawlMode === 'batch') {
      pollInterval = setInterval(async () => {
        try {
          const r = await authFetch('/api/growth/crawl/progress')
          const p = await r.json()
          if (p.active) setBatchProgress(p)
        } catch { /* ignore */ }
      }, 1500)
    }

    try {
      const payload = { url: url.trim() }
      if (crawlMode === 'batch') {
        payload.mode = 'batch'
        payload.max_pages = maxPages
      }
      const res = await authFetch('/api/growth/crawl', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { setError(text.slice(0, 200) || 'Crawl failed'); return }
      if (!res.ok) { setError(data.error || 'Crawl failed'); return }
      setUrl('')
      await fetchPages()
      if (data.seeded_personas && data.seeded_personas.length > 0) fetchPersonas()

      if (data.mode === 'batch') {
        setBatchSummary({
          seed_url: data.seed_url,
          pages_saved: data.pages_saved,
          pages_failed: data.pages_failed,
          pages_attempted: data.pages_attempted,
        })
      } else if (data.page_id) {
        const pageRes = await authFetch(`/api/growth/pages/${data.page_id}`)
        const pageData = await pageRes.json()
        if (pageData.page) { setSelectedPage(pageData.page); loadFeedback(pageData.page.id) }
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      if (pollInterval) clearInterval(pollInterval)
      setCrawling(false)
      setBatchProgress(null)
    }
  }

  const handleAnalyze = async () => {
    if (!selectedPage?.id) return
    setError(null)
    setAnalyzing(true)
    try {
      const payload = { page_id: selectedPage.id }
      if (selectedPersonaId) payload.persona_id = selectedPersonaId
      const res = await authFetch('/api/growth/analyze', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { setError(text.slice(0, 200) || 'Analysis failed'); return }
      if (!res.ok) { setError(data.error || 'Analysis failed'); return }

      // Store result in comparison map
      const resultKey = selectedPersonaId || '_auto'
      const resultLabel = data.persona_name || 'Auto'
      setPersonaResults(prev => ({
        ...prev,
        [resultKey]: { opportunities: data.opportunities, fixes: data.fixes, persona_name: resultLabel },
      }))
      setActiveResultTab(resultKey)

      // Also update selectedPage for backward compat
      setSelectedPage(prev => ({ ...prev, opportunities: data.opportunities, fixes: data.fixes }))
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

  const handleBulkAnalyze = async () => {
    const unanalyzed = pages.filter(p => !p.opportunities)
    if (!unanalyzed.length) return
    setBulkAnalyzeProgress({ current: 0, total: unanalyzed.length, currentTitle: '' })
    for (let i = 0; i < unanalyzed.length; i++) {
      const page = unanalyzed[i]
      setBulkAnalyzeProgress({ current: i + 1, total: unanalyzed.length, currentTitle: page.extracted_data?.title || page.url })
      try {
        const payload = { page_id: page.id }
        if (selectedPersonaId) payload.persona_id = selectedPersonaId
        await authFetch('/api/growth/analyze', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) })
      } catch { /* continue on error */ }
    }
    await fetchPages()
    setBulkAnalyzeProgress(null)
  }

  const handleGenerateDrafts = async () => {
    if (!selectedPage?.id) return
    setError(null)
    setGeneratingDrafts(true)
    try {
      const payload = { page_id: selectedPage.id }
      if (selectedPersonaId) payload.persona_id = selectedPersonaId
      const res = await authFetch('/api/growth/generate-drafts', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { setError(text.slice(0, 200) || 'Draft generation failed'); return }
      if (!res.ok) { setError(data.error || 'Draft generation failed'); return }
      setSelectedPage(prev => ({ ...prev, drafts: data.drafts }))
      fetchPages()
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setGeneratingDrafts(false)
    }
  }

  const ext = selectedPage?.extracted_data

  const loadFeedback = async (pageId) => {
    setFeedbackMap({})
    try {
      const res = await authFetch(`/api/growth/feedback/${pageId}`)
      const data = await res.json()
      if (data.feedback) {
        const map = {}
        data.feedback.forEach(f => { map[f.content_type] = f.rating })
        setFeedbackMap(map)
      }
    } catch {}
  }

  const handleFeedback = async (contentType, rating) => {
    if (!selectedPage?.id) return
    const current = feedbackMap[contentType]
    const newRating = current === rating ? 0 : rating // toggle off if same
    if (newRating === 0) return // can't remove for now, just toggle
    setFeedbackMap(prev => ({ ...prev, [contentType]: newRating }))
    try {
      await authFetch('/api/growth/feedback', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          page_id: selectedPage.id,
          content_type: contentType,
          rating: newRating,
          persona_id: selectedPersonaId || null,
        }),
      })
      fetchPersonas() // refresh scores
    } catch {}
  }

  // Active comparison result (from persona results map or fallback to selectedPage)
  const activeResult = activeResultTab && personaResults[activeResultTab]
    ? personaResults[activeResultTab]
    : null
  const displayOpportunities = activeResult?.opportunities || selectedPage?.opportunities
  const displayFixes = activeResult?.fixes || selectedPage?.fixes
  const totalIssues = displayOpportunities
    ? Object.values(displayOpportunities).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0
  const resultTabs = Object.entries(personaResults)

  // Build site tree from flat pages list
  const siteTree = useMemo(() => {
    const roots = []
    const childrenMap = {}
    for (const page of pages) {
      if (!page.parent_seed_url || page.url === page.parent_seed_url) {
        roots.push(page)
      } else {
        const key = page.parent_seed_url
        if (!childrenMap[key]) childrenMap[key] = []
        childrenMap[key].push(page)
      }
    }
    // Attach children, orphans become roots
    const orphans = []
    for (const [seedUrl, children] of Object.entries(childrenMap)) {
      if (!roots.some(r => r.url === seedUrl)) {
        orphans.push(...children)
      }
    }
    return [...roots.map(r => ({ ...r, children: childrenMap[r.url] || [] })), ...orphans.map(o => ({ ...o, children: [] }))]
  }, [pages])

  const selectPage = (page) => {
    authFetch(`/api/growth/pages/${page.id}`)
      .then(r => r.json())
      .then(d => { if (d.page) { setSelectedPage(d.page); setPersonaResults({}); setActiveResultTab(null); loadFeedback(d.page.id) } })
  }

  const handleExport = async (format = 'csv') => {
    try {
      const res = await authFetch('/api/growth/pages')
      const data = await res.json()
      const exportPages = data.pages || pages

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(exportPages, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `growth-export-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        // CSV export
        const csvRows = [
          ['URL', 'Title', 'Meta Description', 'Word Count', 'Internal Links', 'External Links', 'Images', 'Images with Alt', 'Title Issues', 'Meta Issues', 'Content Issues', 'Structure Issues', 'Recommendations', 'Crawled At'].join(',')
        ]
        for (const p of exportPages) {
          const ext = p.extracted_data || {}
          const opps = p.opportunities || {}
          const escCsv = (v) => `"${String(v || '').replace(/"/g, '""')}"`
          const countArr = (arr) => Array.isArray(arr) ? arr.length : 0
          const joinArr = (arr) => Array.isArray(arr) ? arr.map(i => typeof i === 'string' ? i : i?.issue || i?.recommendation || i?.text || JSON.stringify(i)).join('; ') : ''
          csvRows.push([
            escCsv(p.url),
            escCsv(ext.title),
            escCsv(ext.meta_description),
            ext.word_count || 0,
            ext.internal_links || 0,
            ext.external_links || 0,
            ext.total_images || 0,
            ext.images_with_alt || 0,
            countArr(opps.title_issues),
            countArr(opps.meta_issues),
            countArr(opps.content_issues),
            countArr(opps.structure_issues),
            escCsv(joinArr(opps.recommendations)),
            escCsv(p.created_at || ''),
          ].join(','))
        }
        const csvContent = csvRows.join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `growth-export-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch { /* silent */ }
  }

  // ── Monitor Functions ──
  const fetchMonitors = useCallback(async () => {
    setLoadingMonitors(true)
    try {
      const res = await authFetch('/api/growth/monitors')
      const data = await res.json()
      if (data.monitors) setMonitors(data.monitors)
    } catch {} finally { setLoadingMonitors(false) }
  }, [])

  useEffect(() => { fetchMonitors() }, [fetchMonitors])

  const addToMonitor = async (pageUrl, baseline) => {
    try {
      const res = await authFetch('/api/growth/monitors', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ url: pageUrl, baseline }),
      })
      const data = await res.json()
      if (data.monitor && !data.monitor.already_exists) {
        setMonitors(prev => [data.monitor, ...prev])
      }
      return data.monitor
    } catch { return null }
  }

  const checkMonitor = async (monitorId) => {
    setCheckingMonitor(monitorId)
    try {
      const res = await authFetch(`/api/growth/monitors/${monitorId}/check`, {
        method: 'POST',
        headers: JSON_HEADERS,
      })
      const data = await res.json()
      if (data.monitor) {
        setMonitors(prev => prev.map(m => m.id === monitorId ? data.monitor : m))
        setSelectedMonitor(data.monitor)
      }
      return data
    } catch { return null } finally { setCheckingMonitor(null) }
  }

  const deleteMonitor = async (monitorId) => {
    try {
      await authFetch(`/api/growth/monitors/${monitorId}`, { method: 'DELETE' })
      setMonitors(prev => prev.filter(m => m.id !== monitorId))
      if (selectedMonitor?.id === monitorId) setSelectedMonitor(null)
    } catch {}
  }

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
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-[var(--em-text-muted)] font-medium tabular-nums">
              {pages.length} page{pages.length !== 1 ? 's' : ''} crawled
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleExport('csv')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200 hover:bg-[rgba(0,229,255,0.08)]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--em-text-secondary)' }}
                data-testid="growth-export-csv-btn"
              >
                <Download className="w-3 h-3" />CSV
              </button>
              <button
                onClick={() => handleExport('json')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200 hover:bg-[rgba(124,58,237,0.08)]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--em-text-secondary)' }}
                data-testid="growth-export-json-btn"
              >
                <Download className="w-3 h-3" />JSON
              </button>
            </div>
          </div>
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

            {/* Crawl Mode Toggle */}
            <div className="flex items-center gap-2" data-testid="crawl-mode-selector">
              <button
                onClick={() => { setCrawlMode('single'); setBatchSummary(null) }}
                className="flex-1 h-7 rounded-lg text-[10px] font-semibold transition-all duration-200"
                style={{
                  background: crawlMode === 'single' ? 'rgba(0,229,255,0.12)' : 'transparent',
                  border: crawlMode === 'single' ? '1px solid rgba(0,229,255,0.2)' : '1px solid rgba(255,255,255,0.06)',
                  color: crawlMode === 'single' ? 'var(--em-cyan)' : 'var(--em-text-muted)',
                }}
                data-testid="crawl-mode-single"
              >
                Single Page
              </button>
              <button
                onClick={() => setCrawlMode('batch')}
                className="flex-1 h-7 rounded-lg text-[10px] font-semibold transition-all duration-200"
                style={{
                  background: crawlMode === 'batch' ? 'rgba(124,58,237,0.12)' : 'transparent',
                  border: crawlMode === 'batch' ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(255,255,255,0.06)',
                  color: crawlMode === 'batch' ? 'var(--em-violet)' : 'var(--em-text-muted)',
                }}
                data-testid="crawl-mode-batch"
              >
                Batch Crawl
              </button>
            </div>

            {crawlMode === 'batch' && (
              <div className="flex items-center gap-2" data-testid="batch-max-pages">
                <span className="text-[10px] text-[var(--em-text-muted)] whitespace-nowrap">Max pages:</span>
                <input
                  type="number"
                  min={2}
                  max={25}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Math.min(25, Math.max(2, parseInt(e.target.value) || 10)))}
                  className="w-16 bg-transparent text-xs text-[var(--em-text-primary)] outline-none px-2 py-1 rounded-lg text-center"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.12)' }}
                  data-testid="batch-max-pages-input"
                />
              </div>
            )}

            <button
              onClick={handleCrawl}
              disabled={crawling || !url.trim()}
              className="w-full h-9 rounded-xl text-xs font-semibold transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: crawling ? 'rgba(0,229,255,0.15)' : crawlMode === 'batch'
                  ? 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(0,229,255,0.12) 100%)'
                  : 'linear-gradient(135deg, rgba(0,229,255,0.15) 0%, rgba(124,58,237,0.12) 100%)',
                border: crawlMode === 'batch' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,229,255,0.25)',
                color: crawlMode === 'batch' ? 'var(--em-violet)' : 'var(--em-cyan)',
              }}
              data-testid="growth-crawl-btn"
            >
              {crawling ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {crawlMode === 'batch' ? 'Batch Crawling...' : 'Crawling...'}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Search className="w-3.5 h-3.5" />
                  {crawlMode === 'batch' ? `Batch Crawl (up to ${maxPages})` : 'Crawl & Extract'}
                </span>
              )}
            </button>

            {/* Live Batch Progress */}
            {batchProgress && (
              <div className="p-3 rounded-xl space-y-2" style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.12)' }} data-testid="batch-progress">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-[var(--em-cyan)]" />
                  <span className="text-[11px] font-semibold text-[var(--em-cyan)]">Crawling {batchProgress.pages_attempted} / {batchProgress.max_pages}</span>
                </div>
                <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round((batchProgress.pages_attempted / batchProgress.max_pages) * 100)}%`, background: 'var(--em-cyan)' }} />
                </div>
                <div className="flex gap-4 text-[10px]">
                  <span className="text-[var(--em-text-muted)]">Saved: <span className="font-bold text-emerald-400">{batchProgress.pages_saved}</span></span>
                  {batchProgress.pages_failed > 0 && <span className="text-[var(--em-text-muted)]">Failed: <span className="font-bold text-red-400">{batchProgress.pages_failed}</span></span>}
                </div>
                <p className="text-[9px] text-[var(--em-text-muted)] truncate" style={{ opacity: 0.6 }}>{batchProgress.current_url}</p>
              </div>
            )}

            {/* Batch Summary Banner */}
            {batchSummary && (
              <div className="p-3 rounded-xl space-y-1" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }} data-testid="batch-summary">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] font-semibold text-emerald-300">Batch Crawl Complete</span>
                </div>
                <div className="flex gap-4 text-[10px]">
                  <span className="text-[var(--em-text-muted)]">Saved: <span className="font-bold text-emerald-400">{batchSummary.pages_saved}</span></span>
                  {batchSummary.pages_failed > 0 && <span className="text-[var(--em-text-muted)]">Failed: <span className="font-bold text-red-400">{batchSummary.pages_failed}</span></span>}
                  <span className="text-[var(--em-text-muted)]">Attempted: <span className="font-bold text-[var(--em-text-secondary)]">{batchSummary.pages_attempted}</span></span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.15)]" data-testid="growth-error">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                <span className="text-[11px] text-red-300 leading-relaxed">{error}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.12), rgba(124,58,237,0.08), transparent)' }} />

          {/* Bulk Analyze */}
          {pages.length > 1 && !bulkAnalyzeProgress && (() => {
            const unanalyzed = pages.filter(p => !p.opportunities).length
            return unanalyzed > 0 ? (
              <div className="px-4 py-1.5">
                <button
                  onClick={handleBulkAnalyze}
                  disabled={crawling || analyzing}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 disabled:opacity-40"
                  style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--em-violet)' }}
                  data-testid="bulk-analyze-btn"
                >
                  <Sparkles className="w-3 h-3" />
                  Analyze All ({unanalyzed} unanalyzed)
                </button>
              </div>
            ) : null
          })()}
          {bulkAnalyzeProgress && (
            <div className="px-4 py-1.5">
              <div className="p-3 rounded-xl space-y-2" style={{ background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.12)' }} data-testid="bulk-analyze-progress">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-[var(--em-violet)]" />
                  <span className="text-[11px] font-semibold text-[var(--em-violet)]">Analyzing {bulkAnalyzeProgress.current} / {bulkAnalyzeProgress.total}</span>
                </div>
                <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round((bulkAnalyzeProgress.current / bulkAnalyzeProgress.total) * 100)}%`, background: 'var(--em-violet)' }} />
                </div>
                <p className="text-[9px] text-[var(--em-text-muted)] truncate" style={{ opacity: 0.6 }}>{bulkAnalyzeProgress.currentTitle}</p>
              </div>
            </div>
          )}

          {/* Pages/Monitors Tab Toggle */}
          <div className="flex items-center gap-1 px-4 py-2" data-testid="sidebar-tab-toggle">
            <button
              onClick={() => { setSidebarTab('pages'); setSelectedMonitor(null) }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200"
              style={{
                background: sidebarTab === 'pages' ? 'rgba(0,229,255,0.12)' : 'transparent',
                border: sidebarTab === 'pages' ? '1px solid rgba(0,229,255,0.2)' : '1px solid transparent',
                color: sidebarTab === 'pages' ? 'var(--em-cyan)' : 'var(--em-text-muted)',
              }}
              data-testid="sidebar-tab-pages"
            >
              <Globe className="w-3 h-3" />
              Pages {pages.length > 0 && <span className="text-[9px] opacity-70">({pages.length})</span>}
            </button>
            <button
              onClick={() => { setSidebarTab('monitors'); setSelectedPage(null) }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200"
              style={{
                background: sidebarTab === 'monitors' ? 'rgba(52,211,153,0.12)' : 'transparent',
                border: sidebarTab === 'monitors' ? '1px solid rgba(52,211,153,0.2)' : '1px solid transparent',
                color: sidebarTab === 'monitors' ? '#34D399' : 'var(--em-text-muted)',
              }}
              data-testid="sidebar-tab-monitors"
            >
              <Eye className="w-3 h-3" />
              Monitors {monitors.length > 0 && <span className="text-[9px] opacity-70">({monitors.length})</span>}
            </button>
            {sidebarTab === 'pages' && pages.length > 1 && (
              <div className="ml-auto flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  onClick={() => setPagesView('list')}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors"
                  style={{ background: pagesView === 'list' ? 'rgba(0,229,255,0.1)' : 'transparent', color: pagesView === 'list' ? 'var(--em-cyan)' : 'var(--em-text-muted)' }}
                  data-testid="pages-view-list"
                >
                  <List className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setPagesView('map')}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors"
                  style={{ background: pagesView === 'map' ? 'rgba(124,58,237,0.1)' : 'transparent', color: pagesView === 'map' ? 'var(--em-violet)' : 'var(--em-text-muted)' }}
                  data-testid="pages-view-map"
                >
                  <Network className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Pages Content */}
          {sidebarTab === 'pages' && (
          <div className="flex-1 overflow-y-auto py-1">
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
            ) : pagesView === 'map' ? (
              <SiteMapTree tree={siteTree} selectedPage={selectedPage} onSelect={selectPage} onDelete={handleDelete} />
            ) : (
              <div data-testid="growth-pages-list">
                {pages.map((page) => {
                  const isActive = selectedPage?.id === page.id
                  return (
                    <div
                      key={page.id}
                      onClick={() => selectPage(page)}
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
          )}

          {/* Monitors Content */}
          {sidebarTab === 'monitors' && (
          <div className="flex-1 overflow-y-auto py-1">
            {loadingMonitors ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-400" style={{ opacity: 0.5 }} />
              </div>
            ) : monitors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6" data-testid="monitors-empty">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.1)' }}>
                  <Eye className="w-5 h-5 text-emerald-400" style={{ opacity: 0.4 }} />
                </div>
                <p className="text-xs text-[var(--em-text-muted)] font-medium">No monitors yet</p>
                <p className="text-[10px] text-[var(--em-text-muted)] mt-1 text-center" style={{ opacity: 0.6 }}>Crawl a page first, then add it to monitoring</p>
              </div>
            ) : (
              <div data-testid="monitors-list">
                {/* Check All Button */}
                <div className="px-3 mb-2">
                  <button
                    onClick={async () => {
                      for (const mon of monitors) {
                        await checkMonitor(mon.id)
                      }
                    }}
                    disabled={!!checkingMonitor}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-200 disabled:opacity-30"
                    style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.12)', color: '#34D399' }}
                    data-testid="monitors-check-all-btn"
                  >
                    {checkingMonitor ? <><Loader2 className="w-3 h-3 animate-spin" /> Checking...</> : <><RefreshCw className="w-3 h-3" /> Check All</>}
                  </button>
                </div>
                {monitors.map((mon) => {
                  const isActive = selectedMonitor?.id === mon.id
                  const isChecking = checkingMonitor === mon.id
                  const hasChanges = mon.changes && mon.changes.length > 0
                  const degraded = mon.changes?.filter(c => c.type === 'degraded').length || 0
                  const improved = mon.changes?.filter(c => c.type === 'improved').length || 0
                  return (
                    <div
                      key={mon.id}
                      onClick={() => setSelectedMonitor(mon)}
                      className="group relative mx-2 mb-0.5 rounded-xl px-3 py-2.5 cursor-pointer transition-all duration-200"
                      style={{
                        background: isActive ? 'rgba(52,211,153,0.06)' : 'transparent',
                        border: isActive ? '1px solid rgba(52,211,153,0.12)' : '1px solid transparent',
                      }}
                      data-testid={`monitor-item-${mon.id}`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full" style={{ background: '#34D399' }} />
                      )}
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--em-text-primary)] truncate leading-snug">{mon.label}</p>
                          <p className="text-[10px] text-[var(--em-text-muted)] truncate mt-0.5">{mon.url}</p>
                          {mon.last_checked_at && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] text-[var(--em-text-muted)]" style={{ opacity: 0.5 }}>
                                Checked {new Date(mon.last_checked_at).toLocaleDateString()}
                              </span>
                              {hasChanges && (
                                <span className="flex items-center gap-1 text-[9px]">
                                  {improved > 0 && <span className="text-emerald-400 flex items-center gap-0.5"><ArrowUpRight className="w-2.5 h-2.5" />{improved}</span>}
                                  {degraded > 0 && <span className="text-red-400 flex items-center gap-0.5"><ArrowDownRight className="w-2.5 h-2.5" />{degraded}</span>}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); checkMonitor(mon.id) }}
                            disabled={isChecking}
                            className="flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150 hover:bg-[rgba(52,211,153,0.12)]"
                            title="Re-check now"
                            data-testid={`monitor-check-${mon.id}`}
                          >
                            {isChecking ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> : <RefreshCw className="w-3 h-3 text-emerald-400" />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteMonitor(mon.id) }}
                            className="flex items-center justify-center w-5 h-5 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150 hover:bg-[rgba(248,113,113,0.12)]"
                            data-testid={`monitor-delete-${mon.id}`}
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
          )}

          {/* Divider */}
          <div className="mx-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.12), rgba(0,229,255,0.08), transparent)' }} />
          <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Users className="w-3 h-3 text-[var(--em-violet)]" style={{ opacity: 0.6 }} />
                <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">Personas</span>
                {personas.length > 0 && (
                  <span className="text-[9px] font-bold tabular-nums rounded px-1 py-0.5" style={{ background: 'rgba(124,58,237,0.1)', color: 'var(--em-violet)' }}>
                    {personas.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowPersonaForm(prev => !prev)}
                className="text-[10px] font-medium px-2 py-0.5 rounded-md transition-all duration-200 hover:bg-[rgba(124,58,237,0.08)]"
                style={{ color: 'var(--em-violet)', opacity: 0.7 }}
                data-testid="persona-add-btn"
              >
                {showPersonaForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              </button>
            </div>

            {showPersonaForm && (
              <div className="px-3 pb-2 space-y-2" data-testid="persona-form">
                <input
                  type="text"
                  value={newPersonaName}
                  onChange={(e) => setNewPersonaName(e.target.value)}
                  placeholder="Persona name..."
                  className="w-full bg-transparent text-xs text-[var(--em-text-primary)] placeholder:text-[var(--em-text-muted)] outline-none px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.12)' }}
                  data-testid="persona-name-input"
                />
                <input
                  type="text"
                  value={newPersonaDesc}
                  onChange={(e) => setNewPersonaDesc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePersona()}
                  placeholder="Description (optional)..."
                  className="w-full bg-transparent text-xs text-[var(--em-text-primary)] placeholder:text-[var(--em-text-muted)] outline-none px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.12)' }}
                  data-testid="persona-desc-input"
                />
                <button
                  onClick={handleCreatePersona}
                  disabled={creatingPersona || !newPersonaName.trim()}
                  className="w-full h-7 rounded-lg text-[10px] font-semibold transition-all duration-200 disabled:opacity-30"
                  style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--em-violet)' }}
                  data-testid="persona-create-btn"
                >
                  {creatingPersona ? 'Creating...' : 'Create Persona'}
                </button>
              </div>
            )}

            <div className="px-3 pb-3 space-y-1 max-h-36 overflow-y-auto" data-testid="persona-list">
              {personas.length === 0 ? (
                <p className="text-[10px] text-[var(--em-text-muted)] text-center py-2" style={{ opacity: 0.5 }}>
                  Personas auto-created on first crawl
                </p>
              ) : (
                personas.map((p) => (
                  <div key={p.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }} data-testid={`persona-item-${p.id}`}>
                    <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: 'rgba(124,58,237,0.1)' }}>
                      <Users className="w-2.5 h-2.5 text-[var(--em-violet)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-medium text-[var(--em-text-secondary)] truncate">{p.name}</p>
                        {(p.performance_score !== 0 || p.feedback_count > 0) && (
                          <span className="text-[8px] font-bold tabular-nums shrink-0 px-1 rounded" style={{
                            background: p.performance_score > 0 ? 'rgba(52,211,153,0.1)' : p.performance_score < 0 ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)',
                            color: p.performance_score > 0 ? '#34D399' : p.performance_score < 0 ? '#F87171' : 'var(--em-text-muted)',
                          }} data-testid={`persona-score-${p.id}`}>
                            {p.performance_score > 0 ? '+' : ''}{p.performance_score || 0} / {p.feedback_count || 0}
                          </span>
                        )}
                      </div>
                      {p.description && <p className="text-[9px] text-[var(--em-text-muted)] truncate" style={{ opacity: 0.6 }}>{p.description}</p>}
                    </div>
                    <button
                      onClick={() => handleDeletePersona(p.id)}
                      className="flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 transition-all duration-150 hover:bg-[rgba(248,113,113,0.12)]"
                      data-testid={`persona-delete-${p.id}`}
                    >
                      <Trash2 className="w-2.5 h-2.5 text-red-400" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Trending Now */}
          <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3 h-3 text-[var(--em-cyan)]" style={{ opacity: 0.6 }} />
                <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">Trending</span>
              </div>
              <button
                onClick={handleFetchTrends}
                disabled={fetchingTrends}
                className="text-[10px] font-medium px-2 py-0.5 rounded-md transition-all duration-200 hover:bg-[rgba(0,229,255,0.08)]"
                style={{ color: 'var(--em-cyan)', opacity: fetchingTrends ? 0.4 : 0.7 }}
                data-testid="growth-fetch-trends-btn"
              >
                {fetchingTrends ? 'Fetching...' : 'Refresh'}
              </button>
            </div>
            <div className="px-3 pb-3 space-y-1" data-testid="growth-trends-list">
              {trends.length === 0 ? (
                <p className="text-[10px] text-[var(--em-text-muted)] text-center py-3" style={{ opacity: 0.5 }}>
                  Click Refresh to load trends
                </p>
              ) : (
                trends.slice(0, 5).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <span className="text-[10px] font-mono font-bold w-4 text-[var(--em-text-muted)]" style={{ opacity: 0.4 }}>{i + 1}</span>
                    <span className="text-[11px] text-[var(--em-text-secondary)] truncate flex-1">{t.keyword}</span>
                    <span className="text-[9px] font-medium rounded px-1.5 py-0.5 shrink-0" style={{
                      background: t.source === 'google_trends' ? 'rgba(0,229,255,0.08)' : 'rgba(248,156,49,0.08)',
                      color: t.source === 'google_trends' ? 'var(--em-cyan)' : '#F59E0B',
                    }}>
                      {t.source === 'google_trends' ? 'Google' : 'HN'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Right Detail ── */}
        <div className="flex-1 overflow-y-auto">
          {selectedMonitor ? (
            <div className="p-8 max-w-4xl mx-auto space-y-8" data-testid="monitor-detail">
              {/* Monitor Header */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Eye className="w-4 h-4 text-emerald-400" />
                      <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-400">Site Monitor</span>
                    </div>
                    <h2 className="text-xl font-bold text-[var(--em-text-primary)] leading-tight tracking-tight">{selectedMonitor.label}</h2>
                    <a href={selectedMonitor.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-1 text-xs text-[var(--em-text-muted)] hover:text-emerald-400 transition-colors">
                      {selectedMonitor.url} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <button
                    onClick={() => checkMonitor(selectedMonitor.id)}
                    disabled={checkingMonitor === selectedMonitor.id}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 disabled:opacity-40"
                    style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', color: '#34D399' }}
                    data-testid="monitor-recheck-btn"
                  >
                    {checkingMonitor === selectedMonitor.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {checkingMonitor === selectedMonitor.id ? 'Checking...' : 'Re-check Now'}
                  </button>
                </div>

                {/* Stats Row */}
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-[var(--em-text-muted)]">Checks: <span className="font-bold text-[var(--em-text-primary)]">{selectedMonitor.checks || 0}</span></span>
                  {selectedMonitor.last_checked_at && (
                    <span className="text-[var(--em-text-muted)]">Last: <span className="font-bold text-[var(--em-text-primary)]">{new Date(selectedMonitor.last_checked_at).toLocaleString()}</span></span>
                  )}
                </div>
              </div>

              {/* Changes Section */}
              {selectedMonitor.changes && selectedMonitor.changes.length > 0 ? (
                <div className="space-y-3" data-testid="monitor-changes">
                  <h3 className="text-sm font-semibold text-[var(--em-text-primary)]">Detected Changes</h3>
                  <div className="grid gap-2">
                    {selectedMonitor.changes.map((change, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200"
                        style={{
                          background: change.type === 'improved' ? 'rgba(52,211,153,0.04)' : change.type === 'degraded' ? 'rgba(248,113,113,0.04)' : 'rgba(255,255,255,0.02)',
                          border: change.type === 'improved' ? '1px solid rgba(52,211,153,0.12)' : change.type === 'degraded' ? '1px solid rgba(248,113,113,0.12)' : '1px solid rgba(255,255,255,0.06)',
                        }}
                        data-testid={`monitor-change-${i}`}
                      >
                        <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center" style={{
                          background: change.type === 'improved' ? 'rgba(52,211,153,0.1)' : change.type === 'degraded' ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.06)',
                        }}>
                          {change.type === 'improved' ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> : change.type === 'degraded' ? <ArrowDownRight className="w-3.5 h-3.5 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-[var(--em-text-muted)]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[var(--em-text-primary)]">{change.field}</p>
                          <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5 truncate">
                            <span style={{ opacity: 0.6 }}>{String(change.old)}</span>
                            <span className="mx-1.5 text-[var(--em-text-muted)]">&rarr;</span>
                            <span className="font-medium" style={{ color: change.type === 'improved' ? '#34D399' : change.type === 'degraded' ? '#F87171' : 'var(--em-text-secondary)' }}>{String(change.new)}</span>
                          </p>
                        </div>
                        {change.delta !== undefined && (
                          <span className={`shrink-0 text-[11px] font-bold tabular-nums ${change.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {change.delta > 0 ? '+' : ''}{change.delta}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : selectedMonitor.checks > 0 ? (
                <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.12)' }} data-testid="monitor-no-changes">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">No changes detected</p>
                    <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5">The page content matches the baseline snapshot.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }} data-testid="monitor-initial">
                  <RefreshCw className="w-5 h-5 text-[var(--em-text-muted)] shrink-0" style={{ opacity: 0.4 }} />
                  <div>
                    <p className="text-xs font-medium text-[var(--em-text-secondary)]">Ready to check</p>
                    <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5">Click &quot;Re-check Now&quot; to establish a baseline and start tracking changes.</p>
                  </div>
                </div>
              )}

              {/* Counter Moves Section */}
              {selectedMonitor.counter_moves && selectedMonitor.counter_moves.length > 0 && (
                <div className="space-y-3" data-testid="monitor-counter-moves">
                  <h3 className="text-sm font-semibold text-[var(--em-text-primary)]">Counter Moves</h3>
                  <div className="grid gap-2">
                    {selectedMonitor.counter_moves.map((move, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl"
                        style={{
                          background: move.priority === 'high' ? 'rgba(248,113,113,0.04)' : move.priority === 'info' ? 'rgba(52,211,153,0.04)' : 'rgba(245,158,11,0.04)',
                          border: move.priority === 'high' ? '1px solid rgba(248,113,113,0.12)' : move.priority === 'info' ? '1px solid rgba(52,211,153,0.12)' : '1px solid rgba(245,158,11,0.12)',
                        }}
                        data-testid={`counter-move-${i}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded" style={{
                            background: move.priority === 'high' ? 'rgba(248,113,113,0.1)' : move.priority === 'info' ? 'rgba(52,211,153,0.1)' : 'rgba(245,158,11,0.1)',
                            color: move.priority === 'high' ? '#F87171' : move.priority === 'info' ? '#34D399' : '#FBBF24',
                          }}>{move.priority}</span>
                          <span className="text-[11px] font-semibold text-[var(--em-text-primary)]">{move.field}</span>
                        </div>
                        <p className="text-[11px] text-[var(--em-text-secondary)] leading-relaxed">{move.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : !selectedPage ? (
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
              <div className="space-y-4">
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
                    onClick={() => {
                      const baseline = ext ? {
                        title: ext.title || '',
                        meta_description: ext.meta_description || '',
                        word_count: ext.word_count || 0,
                        h1_count: ext.headings?.h1?.length || 0,
                        h2_count: ext.headings?.h2?.length || 0,
                        image_count: ext.images?.length || 0,
                        link_count: (ext.internal_links?.length || 0) + (ext.external_links?.length || 0),
                        score: null,
                      } : null
                      addToMonitor(selectedPage.url, baseline).then(m => {
                        if (m) setSidebarTab('monitors')
                      })
                    }}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-200 hover:bg-[rgba(52,211,153,0.12)]"
                    style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', color: '#34D399' }}
                    data-testid="monitor-page-btn"
                  >
                    <Eye className="w-3 h-3" />
                    Monitor
                  </button>
                </div>

                {/* Persona selector + Analyze */}
                <div className="flex items-center gap-3" data-testid="persona-switcher">
                  <div className="flex items-center gap-2 flex-1">
                    <Users className="w-3.5 h-3.5 text-[var(--em-violet)]" style={{ opacity: 0.6 }} />
                    <select
                      value={selectedPersonaId || ''}
                      onChange={(e) => setSelectedPersonaId(e.target.value || null)}
                      className="flex-1 bg-transparent text-xs text-[var(--em-text-primary)] outline-none px-3 py-2 rounded-lg appearance-none cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.15)', maxWidth: 260 }}
                      data-testid="persona-select"
                    >
                      <option value="" style={{ background: '#1a1a2e' }}>Auto (best persona)</option>
                      {personas.map(p => (
                        <option key={p.id} value={p.id} style={{ background: '#1a1a2e' }}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing || generatingDrafts}
                    className="shrink-0 em-btn-brand h-9 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-40 transition-all duration-300"
                    data-testid="growth-analyze-btn"
                  >
                    {analyzing ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing...</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" />Analyze SEO</>
                    )}
                  </button>
                  <button
                    onClick={handleGenerateDrafts}
                    disabled={generatingDrafts || analyzing}
                    className="shrink-0 h-9 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-40 transition-all duration-300"
                    style={{
                      background: generatingDrafts ? 'rgba(52,211,153,0.15)' : 'linear-gradient(135deg, rgba(52,211,153,0.12) 0%, rgba(0,229,255,0.1) 100%)',
                      border: '1px solid rgba(52,211,153,0.25)',
                      color: '#34D399',
                    }}
                    data-testid="growth-generate-drafts-btn"
                  >
                    {generatingDrafts ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Drafting...</>
                    ) : (
                      <><FileSearch className="w-3.5 h-3.5" />Generate Drafts</>
                    )}
                  </button>
                  {onBuildBetter && displayOpportunities && Object.keys(displayOpportunities).some(k => displayOpportunities[k]?.length > 0) && (
                    <button
                      onClick={() => {
                        const ext = selectedPage?.extracted_data || {}
                        const opps = displayOpportunities
                        const allIssues = Object.entries(opps)
                          .filter(([, items]) => items?.length > 0)
                          .map(([key, items]) => {
                            const section = ISSUE_SECTIONS.find(s => s.key === key)
                            return `${section?.label || key}: ${items.join('; ')}`
                          })
                          .join('\n')
                        onBuildBetter({
                          url: selectedPage?.url,
                          title: ext.title,
                          meta: ext.meta_description,
                          headings: ext.headings,
                          wordCount: ext.word_count,
                          issues: allIssues,
                        })
                      }}
                      className="shrink-0 h-9 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all duration-300 hover:scale-[1.02]"
                      style={{
                        background: 'linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(249,115,22,0.12) 100%)',
                        border: '1px solid rgba(251,191,36,0.30)',
                        color: '#FBBF24',
                      }}
                      data-testid="growth-build-better-btn"
                    >
                      <Zap className="w-3.5 h-3.5" />Build Better Version
                    </button>
                  )}
                </div>
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

              {/* Comparison Tabs */}
              {resultTabs.length > 1 && (
                <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.1)' }} data-testid="persona-comparison-tabs">
                  {resultTabs.map(([key, result]) => {
                    const isActive = activeResultTab === key
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveResultTab(key)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200"
                        style={{
                          background: isActive ? 'rgba(124,58,237,0.15)' : 'transparent',
                          color: isActive ? 'var(--em-violet)' : 'var(--em-text-muted)',
                          border: isActive ? '1px solid rgba(124,58,237,0.2)' : '1px solid transparent',
                        }}
                        data-testid={`persona-tab-${key}`}
                      >
                        {result.persona_name}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* SEO Opportunities */}
              {displayOpportunities ? (
                <div className="space-y-4" data-testid="growth-opportunities">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">SEO Opportunities</h3>
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: 'var(--em-cyan)', opacity: 0.6 }}>
                      {totalIssues} finding{totalIssues !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {ISSUE_SECTIONS.map(({ key, label, icon: Icon, gradient }) => {
                    const items = displayOpportunities[key]
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
                          {onFixIssue && items.length > 1 && (
                            <button
                              onClick={() => onFixIssue(items.join('; '), selectedPage?.url || '')}
                              className="text-[9px] font-semibold px-2 py-0.5 rounded-md transition-all duration-200 hover:bg-[rgba(0,229,255,0.12)]"
                              style={{ color: 'var(--em-cyan)', border: '1px solid rgba(0,229,255,0.12)' }}
                              data-testid={`growth-fix-all-${key}`}
                            >
                              Fix all
                            </button>
                          )}
                        </div>
                        <div className="px-5 py-3 space-y-2.5">
                          {items.map((item, i) => (
                            <div key={i} className="group/issue flex items-start gap-3">
                              <ChevronRight className="w-3 h-3 mt-1 shrink-0 text-[var(--em-text-muted)]" style={{ opacity: 0.4 }} />
                              <span className="flex-1 text-xs text-[var(--em-text-secondary)] leading-relaxed">{item}</span>
                              {onFixIssue && (
                                <button
                                  onClick={() => onFixIssue(item, selectedPage?.url || '')}
                                  className="shrink-0 opacity-0 group-hover/issue:opacity-100 px-2 py-0.5 rounded-md text-[9px] font-semibold transition-all duration-200 hover:bg-[rgba(0,229,255,0.12)]"
                                  style={{ color: 'var(--em-cyan)', border: '1px solid rgba(0,229,255,0.15)' }}
                                  data-testid={`growth-fix-btn-${key}-${i}`}
                                >
                                  Fix it
                                </button>
                              )}
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

              {/* Fixes */}
              {displayFixes && Object.keys(displayFixes).length > 0 && (
                <div className="space-y-3" data-testid="growth-fixes">
                  <h3 className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">Ready-to-Use Fixes</h3>
                  <div className="em-card overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00E5FF, #34D399)' }}>
                        <Sparkles className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-xs font-semibold text-[var(--em-text-primary)]">AI-Generated Improvements</span>
                      <ThumbsFeedback contentType="fixes" currentRating={feedbackMap.fixes} onFeedback={handleFeedback} />
                    </div>
                    <div className="px-5 py-4 space-y-4">
                      {displayFixes.improved_title && (
                        <FixRow label="Improved Title" value={displayFixes.improved_title} charCount hint="50-60 chars" />
                      )}
                      {displayFixes.improved_meta_description && (
                        <FixRow label="Improved Meta Description" value={displayFixes.improved_meta_description} charCount hint="140-160 chars" />
                      )}
                      {displayFixes.improved_h1 && (
                        <FixRow label="Improved H1" value={displayFixes.improved_h1} />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Marketing Drafts */}
              {selectedPage?.drafts && (
                <div className="space-y-3" data-testid="growth-drafts">
                  <h3 className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">Marketing Drafts</h3>

                  {/* Social Post */}
                  {selectedPage.drafts.social_post && (
                    <DraftCard
                      title="Social Post"
                      gradient="linear-gradient(135deg, #7C3AED, #A78BFA)"
                      fields={[
                        { label: 'Headline', value: selectedPage.drafts.social_post.headline },
                        { label: 'Body', value: selectedPage.drafts.social_post.body },
                        { label: 'CTA', value: selectedPage.drafts.social_post.cta },
                      ]}
                      feedbackProps={{ contentType: 'social_post', currentRating: feedbackMap.social_post, onFeedback: handleFeedback }}
                    />
                  )}

                  {/* Search Ad */}
                  {selectedPage.drafts.search_ad && (
                    <DraftCard
                      title="Search Ad"
                      gradient="linear-gradient(135deg, #0EA5E9, #00E5FF)"
                      fields={[
                        { label: 'Headline 1', value: selectedPage.drafts.search_ad.headline_1, hint: 'max 30 chars' },
                        { label: 'Headline 2', value: selectedPage.drafts.search_ad.headline_2, hint: 'max 30 chars' },
                        { label: 'Description', value: selectedPage.drafts.search_ad.description, hint: 'max 90 chars' },
                      ]}
                      feedbackProps={{ contentType: 'search_ad', currentRating: feedbackMap.search_ad, onFeedback: handleFeedback }}
                    />
                  )}

                  {/* Email */}
                  {selectedPage.drafts.email && (
                    <DraftCard
                      title="Email"
                      gradient="linear-gradient(135deg, #F59E0B, #FBBF24)"
                      fields={[
                        { label: 'Subject', value: selectedPage.drafts.email.subject },
                        { label: 'Preview Text', value: selectedPage.drafts.email.preview_text },
                        { label: 'Body Intro', value: selectedPage.drafts.email.body_intro },
                      ]}
                      feedbackProps={{ contentType: 'email', currentRating: feedbackMap.email, onFeedback: handleFeedback }}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DraftCard({ title, gradient, fields, feedbackProps }) {
  return (
    <div className="em-card overflow-hidden" data-testid={`growth-draft-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid rgba(52,211,153,0.08)' }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: gradient }}>
          <FileSearch className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-semibold text-[var(--em-text-primary)]">{title}</span>
        {feedbackProps && <ThumbsFeedback {...feedbackProps} />}
      </div>
      <div className="px-5 py-4 space-y-4">
        {fields.map(({ label, value, hint }) => (
          value ? <FixRow key={label} label={label} value={value} charCount={!!hint} hint={hint} /> : null
        ))}
      </div>
    </div>
  )
}

function ThumbsFeedback({ contentType, currentRating, onFeedback }) {
  return (
    <div className="ml-auto flex items-center gap-1" data-testid={`feedback-${contentType}`}>
      <button
        onClick={() => onFeedback(contentType, 1)}
        className="flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150"
        style={{
          background: currentRating === 1 ? 'rgba(52,211,153,0.15)' : 'transparent',
          border: currentRating === 1 ? '1px solid rgba(52,211,153,0.3)' : '1px solid transparent',
        }}
        data-testid={`feedback-up-${contentType}`}
      >
        <ThumbsUp className="w-3 h-3" style={{ color: currentRating === 1 ? '#34D399' : 'var(--em-text-muted)', opacity: currentRating === 1 ? 1 : 0.4 }} />
      </button>
      <button
        onClick={() => onFeedback(contentType, -1)}
        className="flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150"
        style={{
          background: currentRating === -1 ? 'rgba(248,113,113,0.15)' : 'transparent',
          border: currentRating === -1 ? '1px solid rgba(248,113,113,0.3)' : '1px solid transparent',
        }}
        data-testid={`feedback-down-${contentType}`}
      >
        <ThumbsDown className="w-3 h-3" style={{ color: currentRating === -1 ? '#F87171' : 'var(--em-text-muted)', opacity: currentRating === -1 ? 1 : 0.4 }} />
      </button>
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

function FixRow({ label, value, charCount, hint }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div data-testid={`growth-fix-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--em-text-muted)]">{label}</span>
          {charCount && (
            <span className="text-[10px] tabular-nums text-[var(--em-text-muted)]" style={{ opacity: 0.5 }}>
              {value.length} chars {hint && `(ideal: ${hint})`}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-200"
          style={{
            background: copied ? 'rgba(52,211,153,0.1)' : 'rgba(0,229,255,0.06)',
            border: `1px solid ${copied ? 'rgba(52,211,153,0.2)' : 'rgba(0,229,255,0.12)'}`,
            color: copied ? '#34D399' : 'var(--em-cyan)',
          }}
          data-testid={`growth-copy-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="p-3 rounded-lg" style={{ background: 'rgba(0,229,255,0.03)', border: '1px solid rgba(0,229,255,0.08)' }}>
        <p className="text-xs text-[var(--em-text-primary)] leading-relaxed">{value}</p>
      </div>
    </div>
  )
}



// ── Site Map Tree View ──
function SiteMapTree({ tree, selectedPage, onSelect, onDelete }) {
  if (!tree.length) return null

  const pathLabel = (url) => {
    try { return new URL(url).pathname || '/' } catch { return url }
  }

  return (
    <div className="px-2 py-1" data-testid="growth-sitemap-tree">
      {tree.map((root) => {
        const isRootActive = selectedPage?.id === root.id
        const hasChildren = root.children?.length > 0
        return (
          <div key={root.id} className="mb-3">
            {/* Root node */}
            <div
              onClick={() => onSelect(root)}
              className="group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all duration-200"
              style={{
                background: isRootActive ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.03)',
                border: isRootActive ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(255,255,255,0.06)',
                boxShadow: isRootActive ? '0 0 12px rgba(124,58,237,0.08)' : 'none',
              }}
              data-testid={`sitemap-root-${root.id}`}
            >
              <div className="flex items-center justify-center w-5 h-5 rounded-md shrink-0" style={{ background: 'rgba(124,58,237,0.15)' }}>
                <Globe className="w-3 h-3 text-[var(--em-violet)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[var(--em-text-primary)] truncate">
                  {root.extracted_data?.title || root.url}
                </p>
                <p className="text-[10px] text-[var(--em-text-muted)] truncate">{root.url}</p>
              </div>
              {root.opportunities && (
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(52,211,153,0.1)' }}>
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                </div>
              )}
              {hasChildren && (
                <span className="text-[9px] font-bold text-[var(--em-text-muted)] tabular-nums shrink-0" style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 6 }}>
                  {root.children.length}
                </span>
              )}
            </div>

            {/* Children */}
            {hasChildren && (
              <div className="ml-4 mt-0.5 relative" style={{ borderLeft: '1px solid rgba(124,58,237,0.12)' }}>
                {root.children.map((child, i) => {
                  const isChildActive = selectedPage?.id === child.id
                  const isLast = i === root.children.length - 1
                  return (
                    <div key={child.id} className="relative pl-4 py-0.5">
                      {/* Connector line */}
                      <div className="absolute left-0 top-1/2 w-3.5 h-px" style={{ background: 'rgba(124,58,237,0.12)' }} />
                      {isLast && <div className="absolute left-[-1px] top-1/2 bottom-0 w-px" style={{ background: 'var(--em-void)' }} />}
                      <div
                        onClick={() => onSelect(child)}
                        className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-200"
                        style={{
                          background: isChildActive ? 'rgba(0,229,255,0.06)' : 'transparent',
                          border: isChildActive ? '1px solid rgba(0,229,255,0.15)' : '1px solid transparent',
                        }}
                        data-testid={`sitemap-child-${child.id}`}
                      >
                        <ChevronRight className="w-2.5 h-2.5 shrink-0" style={{ color: isChildActive ? 'var(--em-cyan)' : 'var(--em-text-muted)', opacity: 0.5 }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium truncate" style={{ color: isChildActive ? 'var(--em-text-primary)' : 'var(--em-text-secondary)' }}>
                            {child.extracted_data?.title || pathLabel(child.url)}
                          </p>
                          <p className="text-[9px] text-[var(--em-text-muted)] truncate" style={{ opacity: 0.6 }}>{pathLabel(child.url)}</p>
                        </div>
                        {child.opportunities && (
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(child.id) }}
                          className="w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[rgba(248,113,113,0.12)]"
                          data-testid={`sitemap-delete-${child.id}`}
                        >
                          <Trash2 className="w-2.5 h-2.5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
