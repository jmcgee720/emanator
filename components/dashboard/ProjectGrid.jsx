'use client'

import { useState, useEffect } from 'react'
import { classifyProject, buildReactPreview, buildHtmlPreview } from './tabs/PreviewTab'
import { Trash2, LayoutGrid, CreditCard, X, Archive, ArchiveRestore } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import InlineBrief from './InlineBrief'
import MyBuildsWidget from './MyBuildsWidget'
import NewProjectModal from './NewProjectModal'

const THUMBNAIL_COLORS = [
  ['#1a1a2e', '#16213e'], ['#0f3460', '#1a1a2e'], ['#162447', '#1f4068'],
  ['#1b262c', '#0f4c75'], ['#222831', '#393e46'], ['#2d3436', '#636e72'],
  ['#1e272e', '#485460'], ['#0a3d62', '#3c6382'], ['#0c2461', '#1e3799'],
]

function ProjectThumbnail({ projectId, projectName }) {
  const colorIndex = (projectId?.charCodeAt?.(0) || 0) % THUMBNAIL_COLORS.length
  const [bg1, bg2] = THUMBNAIL_COLORS[colorIndex]
  const initials = (projectName || 'P')
    .split(/[\s-_]+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')

  // Fetch the latest preview snapshot HTML for this project. The snapshot
  // is written by PreviewTab whenever the user actually views the live
  // preview. If no snapshot exists, we lazily build one client-side from
  // the project's files using the same buildReactPreview pipeline that
  // PreviewTab uses — so users always get a real visual thumbnail
  // instead of a generic placeholder, even on the very first load.
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const [buildingFromFiles, setBuildingFromFiles] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const lazyBuildFromFiles = async () => {
      // No snapshot yet — fetch the project files, build a real preview
      // HTML in-browser, and persist it as a snapshot so subsequent loads
      // are instant.
      setBuildingFromFiles(true)
      try {
        const filesRes = await authFetch(`/api/projects/${projectId}/files`)
        if (!filesRes.ok) {
          console.warn(`[ProjectThumbnail:${projectId}] files fetch failed:`, filesRes.status)
          return
        }
        const files = await filesRes.json()
        if (!Array.isArray(files) || files.length === 0) {
          console.log(`[ProjectThumbnail:${projectId}] no files — placeholder will show 'No files yet'`)
          return
        }
        // Size cap: heavy imported projects (Mangia-Mama: 130 files +
        // Phaser game; Dopples: 197 files) generate 50MB+ inline-HTML
        // thumbnails, which choke the browser and bloat backend storage
        // by ~50MB per dashboard view. Skip the lazy build for anything
        // above the threshold and fall through to the gradient + initials
        // placeholder. The full WebContainer preview is still available
        // when the user clicks into the project.
        const THUMBNAIL_FILE_LIMIT = 30
        const THUMBNAIL_BYTE_LIMIT = 2_000_000  // 2 MB of input source
        const totalBytes = files.reduce((acc, f) => acc + (f.content?.length || 0), 0)
        if (files.length > THUMBNAIL_FILE_LIMIT || totalBytes > THUMBNAIL_BYTE_LIMIT) {
          console.log(`[ProjectThumbnail:${projectId}] skipping lazy thumbnail (files=${files.length}, bytes=${totalBytes}) — too large, using placeholder`)
          return
        }
        const info = classifyProject(files)
        console.log(`[ProjectThumbnail:${projectId}] classified as ${info.type}, building...`)
        let html = null
        if (info.type === 'react') html = buildReactPreview({ ...info, imageAssets: [] })
        else if (info.type === 'html') html = buildHtmlPreview(info)
        else {
          console.warn(`[ProjectThumbnail:${projectId}] unsupported project type for lazy build:`, info.type)
          return
        }
        if (cancelled || !html) return
        // Defensive output cap — even small inputs occasionally fan out
        // (e.g. base64-inlined images). If the OUTPUT exceeds 3 MB, drop
        // the snapshot rather than uploading + iframe-rendering it.
        if (html.length > 3_000_000) {
          console.log(`[ProjectThumbnail:${projectId}] generated HTML too large (${html.length} bytes) — discarding`)
          return
        }
        console.log(`[ProjectThumbnail:${projectId}] built ${html.length} bytes of HTML`)
        setSnapshot(html)
        // Save snapshot to server so next visit is instant. Best-effort —
        // don't fail the thumbnail render if the save errors.
        const filesHash = files.map(f => `${f.path}:${f.content?.length || 0}`).join('|')
        authFetch(`/api/projects/${projectId}/preview-snapshot`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, files_hash: filesHash }),
        }).catch((err) => console.warn(`[ProjectThumbnail:${projectId}] snapshot save failed:`, err.message))
      } catch (err) {
        console.warn(`[ProjectThumbnail:${projectId}] lazy build failed:`, err.message)
      } finally {
        if (!cancelled) setBuildingFromFiles(false)
      }
    }

    authFetch(`/api/projects/${projectId}/preview-snapshot`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return
        const html = data?.snapshot?.html
        if (typeof html === 'string' && html.length > 100) {
          setSnapshot(html)
          setSnapshotLoaded(true)
        } else {
          // No saved snapshot — try building one from files
          setSnapshotLoaded(true)
          lazyBuildFromFiles()
        }
      })
      .catch(() => { if (!cancelled) setSnapshotLoaded(true) })
    return () => { cancelled = true }
  }, [projectId])

  if (snapshot) {
    return (
      <div
        className="aspect-[4/3] border-b border-[rgba(255,255,255,0.06)] relative overflow-hidden bg-white"
        data-testid={`project-thumbnail-${projectId}`}
      >
        <iframe
          srcDoc={snapshot}
          title={`${projectName} preview`}
          loading="lazy"
          aria-hidden="true"
          tabIndex={-1}
          className="absolute top-0 left-0 origin-top-left"
          // Render the iframe at 1280×960 then scale down. pointer-events:none
          // means clicks pass through to the parent project card.
          style={{
            width: '1280px',
            height: '960px',
            transform: 'scale(0.234)',
            pointerEvents: 'none',
            border: 'none',
          }}
          // The buildReactPreview output uses Babel standalone to compile
          // JSX in-browser, so the sandbox MUST allow scripts. allow-same-
          // origin is also required for the inline <script>s to work.
          // pointer-events:none on the <iframe> itself blocks clicks from
          // reaching the iframe even though scripts run inside it.
          sandbox="allow-scripts allow-same-origin"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
      </div>
    )
  }

  // Loading or no snapshot — show building state OR gradient+initials.
  // While we're lazy-building from files, show a "Building preview…"
  // hint so the user knows something is happening.
  return (
    <div
      className="aspect-[4/3] border-b border-[rgba(255,255,255,0.06)] flex flex-col items-center justify-center relative"
      style={{ background: `linear-gradient(135deg, ${bg1}, ${bg2})` }}
      data-testid={`project-thumbnail-${projectId}-placeholder`}
    >
      {buildingFromFiles ? (
        <>
          <div className="relative">
            <div className="w-8 h-8 rounded-full border-2 border-white/15" />
            <div className="absolute inset-0 w-8 h-8 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
          </div>
          <span className="text-[9px] text-white/45 mt-2 px-3 text-center">
            Building preview…
          </span>
        </>
      ) : snapshotLoaded ? (
        <>
          <span className="text-2xl font-semibold text-white/35 select-none">{initials || 'P'}</span>
          <span className="text-[9px] text-white/30 mt-1.5 px-3 text-center">
            No files yet
          </span>
        </>
      ) : (
        <div className="flex items-center gap-1.5 text-white/40 text-[10px]">
          <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
          <span>Loading…</span>
        </div>
      )}
    </div>
  )
}

export default function ProjectGrid({
  projects, isOwner, headline, aurora,
  onOpenProject, onCreateProject, onDeleteProject, onEnterCoreSystem, onBuyCredits,
  showNewProjectModal, setShowNewProjectModal,
  newProjectName, setNewProjectName, newProjectType, setNewProjectType,
  selectedTemplate, setSelectedTemplate, selectedProject, addLog, toast,
  projectMode, heroSubmitting, setHeroSubmitting, pendingHeroPromptRef, importChatTitleRef, setActivityLevel,
  showCreditsModal, setShowCreditsModal, creditsBalance, creditsLoading, creditsCosts,
  selectedProjects, setSelectedProjects, deleteConfirmProject, setDeleteConfirmProject,
}) {
  const [selectMode, setSelectMode] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [isBriefExpanded, setIsBriefExpanded] = useState(false)
  const allCards = projects.filter(p => !p.settings?.is_core)
  const cards = showArchived ? allCards.filter(p => p.settings?.archived) : allCards.filter(p => !p.settings?.archived)
  const archivedCount = allCards.filter(p => p.settings?.archived).length

  const handleToggleSelect = (projectId) => {
    setSelectedProjects(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId]
    )
  }

  const handleSelectAll = () => {
    if (selectedProjects.length === cards.length) {
      setSelectedProjects([])
    } else {
      setSelectedProjects(cards.map(c => c.id))
    }
  }

  const handleBulkArchive = async () => {
    if (selectedProjects.length === 0) return
    const action = showArchived ? 'unarchive' : 'archive'
    for (const pid of selectedProjects) {
      try {
        const project = projects.find(p => p.id === pid)
        const currentSettings = project?.settings || {}
        await authFetch(`/api/projects/${pid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { ...currentSettings, archived: !showArchived } })
        })
      } catch (err) {
        console.error(`Failed to ${action} project ${pid}:`, err)
      }
    }
    toast({ title: showArchived ? 'Restored' : 'Archived', description: `${selectedProjects.length} project(s) ${action}d.` })
    setSelectedProjects([])
    setSelectMode(false)
    // Refresh the project list
    if (typeof onDeleteProject === 'function') {
      onDeleteProject(null) // triggers parent's loadProjects via the callback chain
    }
  }

  const handleBulkDelete = async () => {
    if (selectedProjects.length === 0) return
    if (!confirm(`Delete ${selectedProjects.length} project(s)? This cannot be undone.`)) return
    for (const pid of selectedProjects) {
      await onDeleteProject(pid)
    }
    setSelectedProjects([])
    setSelectMode(false)
    toast({ title: 'Deleted', description: `${selectedProjects.length} project(s) deleted.` })
  }

  return (
    <div className="flex-1 overflow-auto relative z-5">
      <div className="pt-16 pb-8 px-8">
        <div className="max-w-3xl mx-auto text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-semibold em-gradient-text tracking-tight leading-tight" data-testid="dynamic-headline">
            {headline}
          </h1>
        </div>

        {/* Creative Brief — show directly, no extra wrapper box */}
        <div className="max-w-3xl mx-auto mb-8">
          {isBriefExpanded ? (
            <div className="relative" data-testid="creative-brief-expanded">
              <button
                onClick={() => setIsBriefExpanded(false)}
                className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-all"
                data-testid="collapse-brief-btn"
              >
                <X className="w-4 h-4" />
              </button>
              <InlineBrief
                isOwner={isOwner}
                onStartBuilding={async (displayMessage, fullInstruction, briefData, attachments, modelChoice) => {
                  setHeroSubmitting(true)
                  try {
                    pendingHeroPromptRef.current = { displayMessage, fullInstruction, attachments, modelChoice }
                    const projectName = briefData?.project_name || briefData?.elevator_pitch?.slice(0, 40) || 'New Project'
                    const chatTitle = briefData?.elevator_pitch?.slice(0, 50) || displayMessage?.slice(0, 50) || 'Initial Build'
                    importChatTitleRef.current = chatTitle
                    await onCreateProject(projectName, projectMode === 'sandbox' ? 'sandbox' : 'app')
                    aurora.triggerEnergyFlow?.()
                    setActivityLevel(1)
                  } catch (error) {
                    pendingHeroPromptRef.current = null
                  } finally {
                    setHeroSubmitting(false)
                  }
                }}
              />
            </div>
          ) : (
            <button
              onClick={() => setIsBriefExpanded(true)}
              className="w-full em-glass rounded-2xl p-5 text-center hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.04)] transition-all duration-200 group cursor-pointer"
              data-testid="expand-brief-btn"
            >
              <div className="text-sm font-semibold em-text-primary mb-1">Start Building</div>
              <div className="text-xs text-[var(--em-text-secondary)] group-hover:text-[var(--em-cyan)] transition-colors">
                Click to expand and start a new project
              </div>
            </button>
          )}
        </div>
      </div>

      <div className="px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <MyBuildsWidget />
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-1.5 p-0.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] backdrop-blur-sm" data-testid="projects-nav-tabs">
              <button
                onClick={() => setShowArchived(false)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${!showArchived ? 'bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)] shadow-[0_0_8px_rgba(0,229,255,0.10)]' : 'text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] border border-transparent hover:border-[rgba(255,255,255,0.15)]'}`}
                data-testid="projects-tab-btn"
              >
                <LayoutGrid className="w-3 h-3" />
                Projects
              </button>
              {archivedCount > 0 ? (
                <button
                  onClick={() => { setShowArchived(true); setSelectMode(false); setSelectedProjects([]) }}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${showArchived ? 'bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)] shadow-[0_0_8px_rgba(0,229,255,0.10)]' : 'text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] border border-transparent hover:border-[rgba(255,255,255,0.15)]'}`}
                  data-testid="archived-projects-tab-btn"
                >
                  <Archive className="w-3 h-3" />
                  Archived ({archivedCount})
                </button>
              ) : (
                <button
                  onClick={() => { setShowArchived(true); setSelectMode(false); setSelectedProjects([]) }}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${showArchived ? 'bg-[rgba(0,229,255,0.12)] text-[var(--em-cyan)] border border-[rgba(0,229,255,0.25)] shadow-[0_0_8px_rgba(0,229,255,0.10)]' : 'text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] border border-transparent hover:border-[rgba(255,255,255,0.15)]'}`}
                  data-testid="archived-projects-tab-btn"
                >
                  <Archive className="w-3 h-3" />
                  Archived
                </button>
              )}
              {isOwner && (
                <button onClick={onEnterCoreSystem} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] border border-transparent hover:border-[rgba(255,255,255,0.15)] transition-all duration-200" data-testid="core-system-btn">
                  Core System
                </button>
              )}
            </div>

            <div className="flex items-center gap-2" data-testid="bulk-controls">
              {selectMode ? (
                <>
<button onClick={handleSelectAll} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] text-[var(--em-cyan)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-all" data-testid="select-all-btn" title="Select all visible projects">
                    {selectedProjects.length === cards.length ? 'Deselect All' : 'Select All'}
                  </button>
                  {selectedProjects.length > 0 && (
                    <>
                      <button onClick={handleBulkArchive} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[rgba(0,229,255,0.12)] border border-[rgba(0,229,255,0.25)] text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.2)] transition-all flex items-center gap-1.5" data-testid="archive-selected-btn">
                          {showArchived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                        {showArchived ? 'Restore' : 'Archive'} {selectedProjects.length}
                      </button>
                      {!showArchived && (
                        <button onClick={handleBulkDelete} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[rgba(255,60,60,0.15)] border border-[rgba(255,60,60,0.3)] text-red-400 hover:bg-[rgba(255,60,60,0.25)] transition-all flex items-center gap-1.5" data-testid="delete-selected-btn">
                          <Trash2 className="w-3 h-3" />
                          Delete {selectedProjects.length}
                        </button>
                      )}
                    </>
                  )}
                  <button onClick={() => { setSelectMode(false); setSelectedProjects([]) }} className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-[var(--em-text-secondary)] hover:text-white transition-all" data-testid="cancel-select-btn">
                    Cancel
                  </button>
                </>
              ) : (
                cards.length > 0 && (
                  <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] transition-all" data-testid="enter-select-mode-btn">
                    Select
                  </button>
                )
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="project-grid">
            {cards.length === 0 && showArchived && (
              <div className="col-span-full text-center py-16 text-[var(--em-text-secondary)]">
                <Archive className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No archived projects</p>
                <button onClick={() => setShowArchived(false)} className="mt-2 text-xs text-[var(--em-cyan)] hover:underline">Back to Projects</button>
              </div>
            )}
            {/* "New Project" tile pinned to first grid slot (top-left) so
                creating a new project is always one click away regardless
                of how many existing projects the user has scrolled past. */}
            {!selectMode && !showArchived && (
              <button onClick={() => setShowNewProjectModal(true)} className="rounded-xl border border-dashed border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.06)] backdrop-blur-sm transition-all duration-200 flex flex-col items-center justify-center min-h-[180px] group" data-testid="add-project-card">
                <div className="w-10 h-10 rounded-lg border border-[rgba(255,255,255,0.10)] group-hover:border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.04)] flex items-center justify-center mb-2 transition-all">
                  <span className="text-xl text-[var(--em-text-secondary)] group-hover:text-white transition-colors">+</span>
                </div>
                <span className="text-xs text-[var(--em-text-secondary)] group-hover:text-white transition-colors">New Project</span>
              </button>
            )}
            {cards.map((item) => (
              <div
                key={item.id}
                className={`group relative rounded-xl em-glass hover:border-[rgba(255,255,255,0.24)] hover:shadow-[0_20px_70px_rgba(0,0,0,0.35),0_0_20px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.30)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden cursor-pointer ${selectMode && selectedProjects.includes(item.id) ? 'ring-2 ring-[var(--em-cyan)] border-[rgba(0,229,255,0.4)]' : ''}`}
                onClick={() => selectMode ? handleToggleSelect(item.id) : onOpenProject(item)}
                onMouseEnter={aurora.onTyping}
                data-testid={`project-card-${item.id}`}
              >
                {selectMode && (
                  <div className="absolute top-2 left-2 z-10 w-5 h-5 rounded-md border-2 border-[rgba(255,255,255,0.3)] flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm" data-testid={`select-checkbox-${item.id}`}>
                    {selectedProjects.includes(item.id) && <div className="w-3 h-3 rounded-sm bg-[var(--em-cyan)]" />}
                  </div>
                )}
                {!selectMode && (
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmProject(item) }} className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-lg bg-[rgba(0,0,0,0.5)] border border-[rgba(255,255,255,0.08)] text-[var(--em-text-secondary)] opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,60,60,0.3)] hover:border-[rgba(255,60,60,0.4)] hover:text-red-400 transition-all duration-200 backdrop-blur-sm" data-testid={`delete-project-btn-${item.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <ProjectThumbnail projectId={item.id} projectName={item.name} />
                <div className="px-3.5 py-3 relative z-[2]">
                  <div className="text-sm font-medium em-text-primary truncate">{item.name}</div>
                  <div className="text-[11px] em-text-secondary mt-0.5">{item.type || 'project'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showNewProjectModal && (
        <NewProjectModal showNewProjectModal={showNewProjectModal} setShowNewProjectModal={setShowNewProjectModal} newProjectName={newProjectName} setNewProjectName={setNewProjectName} newProjectType={newProjectType} setNewProjectType={setNewProjectType} selectedTemplate={selectedTemplate} setSelectedTemplate={setSelectedTemplate} createProject={onCreateProject} selectedProject={selectedProject} addLog={addLog} toast={toast} />
      )}

      {showCreditsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="em-glass rounded-2xl p-6 w-[420px] border border-[rgba(255,255,255,0.15)]" data-testid="credits-modal">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold em-text-primary flex items-center gap-2"><CreditCard className="w-4 h-4 text-[var(--em-cyan)]" />Credits</h2>
              <button onClick={() => setShowCreditsModal(false)} className="em-text-muted hover:text-[var(--em-text-primary)] transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="em-glass rounded-xl p-4 mb-5" data-testid="credits-balance">
              <div className="text-2xl font-bold em-gradient-text mb-1">{creditsBalance !== null ? creditsBalance.toFixed(2) : '—'}</div>
              <div className="text-xs em-text-secondary">Available credits</div>
            </div>
            <div className="space-y-2 mb-5">
              <p className="text-[10px] em-text-muted font-medium uppercase tracking-wider mb-2">Cost per action</p>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(creditsCosts).map(([action, cost]) => (
                  <div key={action} className="flex items-center justify-between text-[11px] px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.03)]">
                    <span className="em-text-secondary capitalize">{action.replace(/_/g, ' ')}</span>
                    <span className="em-text-primary font-medium">{cost}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2" data-testid="credits-purchase-options">
              {[{ packageId: 'starter', amount: 100, price: '$10' }, { packageId: 'pro', amount: 500, price: '$45' }, { packageId: 'ultra', amount: 1000, price: '$80' }].map(({ packageId, amount, price }) => (
                <button key={packageId} onClick={() => onBuyCredits(packageId)} disabled={creditsLoading} className="py-3 rounded-xl border border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 text-center disabled:opacity-50" data-testid={`buy-credits-${packageId}`}>
                  <div className="text-sm font-semibold em-text-primary">{amount}</div>
                  <div className="text-[11px] em-text-secondary">{price}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
