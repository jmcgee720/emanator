'use client'

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { X, Plus, Store, Loader2, Download, Upload, Star } from 'lucide-react'

const BUILT_IN_TEMPLATES = [
  { id: 'saas-landing', name: 'SaaS Landing Page', desc: 'Hero, pricing, testimonials', color: '#00E5FF', cat: 'Marketing' },
  { id: 'product-launch', name: 'Product Launch', desc: 'Countdown, email capture', color: '#F59E0B', cat: 'Marketing' },
  { id: 'agency-site', name: 'Agency Website', desc: 'Services, case studies', color: '#A78BFA', cat: 'Marketing' },
  { id: 'newsletter-landing', name: 'Newsletter Landing', desc: 'Email capture, social proof', color: '#34D399', cat: 'Marketing' },
  { id: 'app-download', name: 'App Download', desc: 'Mobile mockup, badges', color: '#EC4899', cat: 'Marketing' },
  { id: 'admin-dashboard', name: 'Admin Dashboard', desc: 'KPIs, tables, sidebar', color: '#6366F1', cat: 'Business' },
  { id: 'crm-lite', name: 'CRM Lite', desc: 'Pipeline, contacts', color: '#00E5FF', cat: 'Business' },
  { id: 'invoice-generator', name: 'Invoice Generator', desc: 'Line items, totals', color: '#34D399', cat: 'Business' },
  { id: 'project-tracker', name: 'Project Tracker', desc: 'Kanban, assignments', color: '#F59E0B', cat: 'Business' },
  { id: 'analytics-dashboard', name: 'Analytics Dashboard', desc: 'Charts, filters, export', color: '#EC4899', cat: 'Business' },
  { id: 'dev-portfolio', name: 'Developer Portfolio', desc: 'Projects, skills, links', color: '#A78BFA', cat: 'Personal' },
  { id: 'creative-portfolio', name: 'Creative Portfolio', desc: 'Masonry gallery', color: '#EC4899', cat: 'Personal' },
  { id: 'resume-cv', name: 'Resume / CV', desc: 'Timeline, skills bars', color: '#00E5FF', cat: 'Personal' },
  { id: 'link-in-bio', name: 'Link-in-Bio', desc: 'Social links, profile', color: '#F59E0B', cat: 'Personal' },
  { id: 'personal-blog', name: 'Personal Blog', desc: 'Articles, categories', color: '#34D399', cat: 'Personal' },
  { id: 'blog-platform', name: 'Blog Platform', desc: 'Articles, newsletter', color: '#F59E0B', cat: 'Content' },
  { id: 'docs-site', name: 'Documentation Site', desc: 'Sidebar nav, code blocks', color: '#6366F1', cat: 'Content' },
  { id: 'recipe-collection', name: 'Recipe Collection', desc: 'Cards, filters, ingredients', color: '#F87171', cat: 'Content' },
  { id: 'podcast-landing', name: 'Podcast Landing', desc: 'Episodes, player', color: '#A78BFA', cat: 'Content' },
  { id: 'course-platform', name: 'Course Platform', desc: 'Lessons, progress', color: '#34D399', cat: 'Content' },
  { id: 'storefront', name: 'Storefront', desc: 'Product grid, cart', color: '#EC4899', cat: 'Commerce' },
  { id: 'digital-products', name: 'Digital Products', desc: 'Downloads, pricing', color: '#6366F1', cat: 'Commerce' },
  { id: 'restaurant-menu', name: 'Restaurant Menu', desc: 'Menu, order cart', color: '#F59E0B', cat: 'Commerce' },
  { id: 'booking-system', name: 'Booking System', desc: 'Calendar, confirmation', color: '#00E5FF', cat: 'Commerce' },
  { id: 'marketplace-listings', name: 'Marketplace', desc: 'Listings, filters, search', color: '#34D399', cat: 'Commerce' },
]

const CAT_COLORS = {
  General: '#6366F1', Marketing: '#00E5FF', Personal: '#A78BFA',
  Business: '#34D399', Content: '#F59E0B', Commerce: '#EC4899',
  Tools: '#F87171', Social: '#8B5CF6',
}

export default function NewProjectModal({
  setShowNewProjectModal,
  newProjectName, setNewProjectName,
  newProjectType, setNewProjectType,
  selectedTemplate, setSelectedTemplate,
  createProject,
  selectedProject,
  addLog,
  toast,
}) {
  const [modalTab, setModalTab] = useState('templates') // 'templates' | 'marketplace' | 'publish'
  const [templateCategory, setTemplateCategory] = useState('all')
  const [marketplaceTemplates, setMarketplaceTemplates] = useState([])
  const [loadingMarketplace, setLoadingMarketplace] = useState(false)
  const [selectedMarketplaceId, setSelectedMarketplaceId] = useState(null)
  const [cloningId, setCloningId] = useState(null)

  // Publish form
  const [publishName, setPublishName] = useState('')
  const [publishDesc, setPublishDesc] = useState('')
  const [publishCat, setPublishCat] = useState('General')
  const [publishing, setPublishing] = useState(false)

  const fetchMarketplace = useCallback(async () => {
    setLoadingMarketplace(true)
    try {
      const res = await authFetch('/api/marketplace')
      const data = await res.json()
      setMarketplaceTemplates(data.templates || [])
    } catch {
      setMarketplaceTemplates([])
    } finally {
      setLoadingMarketplace(false)
    }
  }, [])

  useEffect(() => {
    if (modalTab === 'marketplace') fetchMarketplace()
  }, [modalTab, fetchMarketplace])

  const handleCloneMarketplace = async (templateId) => {
    setCloningId(templateId)
    try {
      const res = await authFetch(`/api/marketplace/${templateId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok && data.project) {
        addLog?.('success', `Cloned template into "${data.project.name}"`)
        toast?.({ title: 'Template Cloned', description: `Project "${data.project.name}" created.` })
        setShowNewProjectModal(false)
        // Reload window to refresh projects list
        window.location.reload()
      } else {
        addLog?.('error', data.error || 'Clone failed')
      }
    } catch (err) {
      addLog?.('error', `Clone failed: ${err.message}`)
    } finally {
      setCloningId(null)
    }
  }

  const handlePublish = async () => {
    if (!selectedProject?.id || !publishName.trim()) return
    setPublishing(true)
    try {
      const res = await authFetch('/api/marketplace/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: selectedProject.id,
          name: publishName.trim(),
          description: publishDesc.trim(),
          category: publishCat,
        }),
      })
      const data = await res.json()
      if (res.ok && data.template) {
        addLog?.('success', `Published "${publishName}" to Marketplace`)
        toast?.({ title: 'Published!', description: 'Your template is now available in the Marketplace.' })
        setPublishName('')
        setPublishDesc('')
        setModalTab('marketplace')
        fetchMarketplace()
      } else {
        addLog?.('error', data.error || 'Publish failed')
      }
    } catch (err) {
      addLog?.('error', `Publish failed: ${err.message}`)
    } finally {
      setPublishing(false)
    }
  }

  const closeModal = () => {
    setShowNewProjectModal(false)
    setNewProjectName('')
    setNewProjectType('app')
    setSelectedTemplate(null)
    setSelectedMarketplaceId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="em-glass rounded-2xl w-[740px] max-h-[82vh] border border-[rgba(255,255,255,0.15)] overflow-hidden flex flex-col" data-testid="new-project-modal">
        {/* Header with tabs */}
        <div className="flex items-center justify-between px-6 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-1">
            {[
              { id: 'templates', label: 'Templates', icon: Plus },
              { id: 'marketplace', label: 'Marketplace', icon: Store },
              ...(selectedProject ? [{ id: 'publish', label: 'Publish', icon: Upload }] : []),
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setModalTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200"
                style={{
                  background: modalTab === tab.id ? 'rgba(0,229,255,0.08)' : 'transparent',
                  border: modalTab === tab.id ? '1px solid rgba(0,229,255,0.15)' : '1px solid transparent',
                  color: modalTab === tab.id ? 'var(--em-cyan)' : 'var(--em-text-muted)',
                }}
                data-testid={`modal-tab-${tab.id}`}
              >
                <tab.icon className="w-3 h-3" />
                {tab.label}
              </button>
            ))}
          </div>
          <button onClick={closeModal} className="text-[var(--em-text-muted)] hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── Templates Tab ── */}
          {modalTab === 'templates' && (
            <>
              <div className="flex gap-3">
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className="flex-1 px-3 py-2 text-sm em-input rounded-xl"
                  data-testid="new-project-name-input"
                />
                <select
                  value={newProjectType}
                  onChange={(e) => setNewProjectType(e.target.value)}
                  className="px-3 py-2 text-sm em-input rounded-xl"
                  data-testid="new-project-type-select"
                >
                  <option value="app">App</option>
                  <option value="website">Website</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)]">Start from a Template</p>
                  <div className="flex gap-1" data-testid="template-category-filter">
                    {['all', 'Marketing', 'Business', 'Personal', 'Content', 'Commerce'].map(cat => (
                      <button
                        key={cat}
                        onClick={() => setTemplateCategory(cat)}
                        className="px-2 py-0.5 rounded-md text-[9px] font-medium transition-all duration-150"
                        style={{
                          background: templateCategory === cat ? 'rgba(0,229,255,0.08)' : 'transparent',
                          border: templateCategory === cat ? '1px solid rgba(0,229,255,0.15)' : '1px solid transparent',
                          color: templateCategory === cat ? 'var(--em-cyan)' : 'var(--em-text-muted)',
                          textTransform: 'capitalize',
                        }}
                        data-testid={`template-cat-${cat}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2.5" style={{ maxHeight: '380px', overflowY: 'auto', paddingRight: 4 }} data-testid="template-gallery">
                  <div
                    onClick={() => setSelectedTemplate(null)}
                    className="group relative rounded-xl p-3 cursor-pointer transition-all duration-200"
                    style={{
                      background: !selectedTemplate ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.02)',
                      border: !selectedTemplate ? '1px solid rgba(0,229,255,0.2)' : '1px solid rgba(255,255,255,0.06)',
                    }}
                    data-testid="template-blank"
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <Plus className="w-3.5 h-3.5 text-[var(--em-text-muted)]" />
                    </div>
                    <p className="text-[11px] font-bold em-text-primary">Blank</p>
                    <p className="text-[9px] text-[var(--em-text-muted)] mt-0.5">From scratch</p>
                  </div>

                  {BUILT_IN_TEMPLATES
                    .filter(tmpl => templateCategory === 'all' || tmpl.cat === templateCategory)
                    .map((tmpl) => (
                    <div
                      key={tmpl.id}
                      onClick={() => setSelectedTemplate(tmpl.id)}
                      className="group relative rounded-xl p-3 cursor-pointer transition-all duration-200"
                      style={{
                        background: selectedTemplate === tmpl.id ? `${tmpl.color}10` : 'rgba(255,255,255,0.02)',
                        border: selectedTemplate === tmpl.id ? `1px solid ${tmpl.color}33` : '1px solid rgba(255,255,255,0.06)',
                      }}
                      data-testid={`template-${tmpl.id}`}
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2" style={{ background: `${tmpl.color}12`, border: `1px solid ${tmpl.color}20` }}>
                        <span className="text-[9px] font-bold" style={{ color: tmpl.color }}>{tmpl.cat.charAt(0)}</span>
                      </div>
                      <p className="text-[11px] font-bold em-text-primary leading-tight">{tmpl.name}</p>
                      <p className="text-[9px] text-[var(--em-text-muted)] mt-0.5">{tmpl.desc}</p>
                      <span className="text-[8px] mt-1.5 inline-block px-1 py-0.5 rounded bg-white/[0.04] text-[var(--em-text-muted)]">{tmpl.cat}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Marketplace Tab ── */}
          {modalTab === 'marketplace' && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--em-text-muted)] mb-3">Community Templates</p>
              {loadingMarketplace ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--em-text-muted)]" />
                </div>
              ) : marketplaceTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12" data-testid="marketplace-empty">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <Store className="w-6 h-6" style={{ color: 'var(--em-text-muted)', opacity: 0.3 }} />
                  </div>
                  <p className="text-xs font-medium" style={{ color: 'var(--em-text-muted)' }}>No community templates yet</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--em-text-muted)', opacity: 0.5 }}>Be the first to publish one!</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3" data-testid="marketplace-gallery">
                  {marketplaceTemplates.map((tmpl) => {
                    const catColor = CAT_COLORS[tmpl.category] || '#6366F1'
                    const isSelected = selectedMarketplaceId === tmpl.id
                    return (
                      <div
                        key={tmpl.id}
                        onClick={() => setSelectedMarketplaceId(isSelected ? null : tmpl.id)}
                        className="group relative rounded-xl p-4 cursor-pointer transition-all duration-200"
                        style={{
                          background: isSelected ? `${catColor}10` : 'rgba(255,255,255,0.02)',
                          border: isSelected ? `1px solid ${catColor}33` : '1px solid rgba(255,255,255,0.06)',
                        }}
                        data-testid={`marketplace-template-${tmpl.id}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="text-xs font-bold em-text-primary">{tmpl.name}</p>
                            <p className="text-[10px] text-[var(--em-text-muted)] mt-0.5 line-clamp-2">{tmpl.description || 'No description'}</p>
                          </div>
                          <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0 ml-2" style={{ background: `${catColor}15`, color: catColor, border: `1px solid ${catColor}25` }}>{tmpl.category}</span>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center gap-3 text-[10px] text-[var(--em-text-muted)]">
                            <span>{tmpl.file_count} files</span>
                            <span>{tmpl.clones || 0} clones</span>
                            {tmpl.avg_rating > 0 && (
                              <span className="flex items-center gap-0.5" style={{ color: '#FBBF24' }}>
                                <Star className="w-2.5 h-2.5 fill-current" />
                                {tmpl.avg_rating} ({tmpl.review_count})
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCloneMarketplace(tmpl.id) }}
                            disabled={cloningId === tmpl.id}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200 disabled:opacity-40"
                            style={{ background: `${catColor}12`, border: `1px solid ${catColor}25`, color: catColor }}
                            data-testid={`marketplace-clone-${tmpl.id}`}
                          >
                            {cloningId === tmpl.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                            {cloningId === tmpl.id ? 'Cloning...' : 'Clone'}
                          </button>
                        </div>
                        <p className="text-[9px] text-[var(--em-text-muted)] mt-2 opacity-60">by {tmpl.author_email?.split('@')[0] || 'anonymous'}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Publish Tab ── */}
          {modalTab === 'publish' && selectedProject && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.1)' }}>
                <p className="text-[11px] text-[var(--em-cyan)] font-semibold mb-1">Publish to Marketplace</p>
                <p className="text-[10px] text-[var(--em-text-muted)]">
                  Share "{selectedProject.name}" as a template for others to clone and build upon.
                </p>
              </div>

              <div className="space-y-3">
                <input
                  value={publishName}
                  onChange={(e) => setPublishName(e.target.value)}
                  placeholder="Template name"
                  className="w-full px-3 py-2 text-sm em-input rounded-xl"
                  data-testid="publish-name-input"
                />
                <textarea
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="Short description of what this template does..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm em-input rounded-xl resize-none"
                  data-testid="publish-desc-input"
                />
                <select
                  value={publishCat}
                  onChange={(e) => setPublishCat(e.target.value)}
                  className="w-full px-3 py-2 text-sm em-input rounded-xl"
                  data-testid="publish-cat-select"
                >
                  {Object.keys(CAT_COLORS).map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={closeModal} className="px-4 py-2 text-xs em-btn-ghost rounded-xl" data-testid="cancel-new-project">Cancel</button>

          {modalTab === 'templates' && (
            <button
              onClick={async () => {
                const name = newProjectName.trim() || (selectedTemplate ? selectedTemplate.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'New Project')
                await createProject(name, newProjectType, selectedTemplate)
                closeModal()
              }}
              className="px-4 py-2 text-xs em-btn-brand rounded-xl"
              data-testid="create-project-submit"
            >
              {selectedTemplate ? 'Create from Template' : 'Create Project'}
            </button>
          )}

          {modalTab === 'publish' && (
            <button
              onClick={handlePublish}
              disabled={publishing || !publishName.trim()}
              className="px-4 py-2 text-xs em-btn-brand rounded-xl flex items-center gap-1.5 disabled:opacity-40"
              data-testid="publish-submit-btn"
            >
              {publishing ? <><Loader2 className="w-3 h-3 animate-spin" /> Publishing...</> : <><Upload className="w-3 h-3" /> Publish Template</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
