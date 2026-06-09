'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Eye, Code, FolderOpen, Terminal, Download, Rocket, Share2, Check, Copy, Loader2, Link, Clock } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { useState } from 'react'
import PreviewTab from './tabs/PreviewTab'
import CoreCanvas from './tabs/CoreCanvas'
import CodeTab from './tabs/CodeTab'
import AssetsTab from './tabs/AssetsTab'
import LogsTab from './tabs/LogsTab'
import ExportTab from './tabs/ExportTab'
import DeployTab from './tabs/DeployTab'

const tabs = [
  { id: 'preview', name: 'Preview', icon: Eye },
  { id: 'code', name: 'Code', icon: Code },
  { id: 'assets', name: 'Assets', icon: FolderOpen },
  { id: 'logs', name: 'Logs', icon: Terminal },
  { id: 'export', name: 'Export', icon: Download },
  { id: 'deploy', name: 'Deploy', icon: Rocket },
]

export default function RightPanel({
  selectedProject,
  files,
  setFiles,
  activeTab,
  onTabChange,
  logs = [],
  addLog = () => {},
  onOpenVariationStudio,
  assetsRefreshKey,
  livePromoteState,
  setLivePromoteState,
  livePreviewData,
  isBuilding,
  runtimeTestScript,
  generatedImageMap,
  serverPreviewRefreshRef,
  onApplySuccess,
  projectLoading,
}) {

  const handleRefreshFiles = async () => {
    if (!selectedProject?.id) return
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/files`)
      const data = await res.json()
      setFiles(Array.isArray(data) ? data : [])
    } catch (e) {
      console.warn('[RightPanel] File refresh failed:', e.message)
    }
  }

  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareExpiry, setShareExpiry] = useState('never')
  const [showExpiryPicker, setShowExpiryPicker] = useState(false)
  const [shareExpiresAt, setShareExpiresAt] = useState(null)

  const handleShare = async () => {
    if (!selectedProject?.id) return
    setSharing(true)
    setShareUrl(null)
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_in: shareExpiry }),
      })
      const data = await res.json()
      if (data.share_url) {
        setShareUrl(data.share_url)
        setShareExpiresAt(data.expires_at)
        addLog('success', `Share link created: ${data.share_url}`)
      } else {
        addLog('error', data.error || 'Failed to create share link')
      }
    } catch {
      addLog('error', 'Failed to create share link')
    } finally {
      setSharing(false)
      setShowExpiryPicker(false)
    }
  }

  const copyShareUrl = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center relative z-10">
          <FolderOpen className="w-12 h-12 mx-auto text-white/20 mb-4" />
          <h3 className="text-sm font-medium text-white/50 mb-1">No Project Selected</h3>
          <p className="text-xs text-white/30">Select or create a project to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col" data-testid="right-panel">
      <Tabs value={activeTab} onValueChange={onTabChange} className="flex-1 flex flex-col relative z-5">
        <div className="px-5 pt-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <TabsList className="h-10 bg-transparent justify-start gap-0.5">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="data-[state=active]:bg-white/8 data-[state=active]:text-white data-[state=active]:shadow-none rounded-lg px-3.5 text-xs font-medium text-white/40 hover:text-white/70 transition-colors duration-200"
              >
                <tab.icon className="w-3.5 h-3.5 mr-1.5" />
                {tab.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Consolidated Toolbar: Refresh, Deploy, Share */}
          <div className="flex items-center gap-1.5 shrink-0 pb-1 relative">
            {/* Refresh */}
            <button
              onClick={() => onTabChange('preview')}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              data-testid="preview-refresh"
              title="Refresh preview"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>

            {/* Deploy */}
            <button
              onClick={() => onTabChange('deploy')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white text-black hover:bg-gray-200 transition-all duration-200"
              data-testid="preview-deploy-btn"
            >
              Deploy
            </button>

            {/* Share */}
            {shareUrl ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <Link className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-[10px] text-emerald-300 font-medium truncate max-w-[140px]">{shareUrl.replace(/^https?:\/\//, '')}</span>
                {shareExpiresAt && (
                  <span className="text-[9px] text-amber-400 shrink-0 flex items-center gap-0.5" title={`Expires: ${new Date(shareExpiresAt).toLocaleString()}`}>
                    <Clock className="w-2.5 h-2.5" />
                  </span>
                )}
                <button
                  onClick={copyShareUrl}
                  className="ml-1 w-5 h-5 flex items-center justify-center rounded transition-all duration-150 hover:bg-[rgba(52,211,153,0.15)]"
                  data-testid="share-copy-btn"
                >
                  {shareCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-emerald-400" />}
                </button>
                <button
                  onClick={() => { setShareUrl(null); setShareExpiresAt(null) }}
                  className="w-5 h-5 flex items-center justify-center rounded transition-all duration-150 hover:bg-[rgba(255,255,255,0.08)]"
                  data-testid="share-new-btn"
                >
                  <Share2 className="w-3 h-3 text-emerald-400" />
                </button>
              </div>
            ) : showExpiryPicker ? (
              <div className="flex items-center gap-1.5" data-testid="share-expiry-picker">
                <select
                  value={shareExpiry}
                  onChange={(e) => setShareExpiry(e.target.value)}
                  className="px-2 py-1 rounded-lg text-[10px] font-medium outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--em-text-secondary)' }}
                  data-testid="share-expiry-select"
                >
                  <option value="never">Never expires</option>
                  <option value="1h">1 hour</option>
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                </select>
                <button
                  onClick={handleShare}
                  disabled={sharing}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200 disabled:opacity-40"
                  style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: 'var(--em-cyan)' }}
                  data-testid="share-confirm-btn"
                >
                  {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
                  {sharing ? '...' : 'Share'}
                </button>
                <button
                  onClick={() => setShowExpiryPicker(false)}
                  className="px-1.5 py-1 text-[10px] text-[var(--em-text-muted)] hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowExpiryPicker(true)}
                disabled={sharing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)', color: 'var(--em-cyan)' }}
                data-testid="share-project-btn"
              >
                <Share2 className="w-3 h-3" />
                Share
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0 relative">
          <TabsContent value="preview" className="absolute inset-0 m-0 p-0" style={{height: '100%'}}>
            {selectedProject?.settings?.is_core ? (
              <CoreCanvas project={selectedProject} onLog={addLog} />
            ) : (
              <>
                <PreviewTab project={selectedProject} files={files} onLog={addLog} livePreviewData={livePreviewData} isBuilding={isBuilding} onRefreshFiles={handleRefreshFiles} runtimeTestScript={runtimeTestScript} generatedImageMap={generatedImageMap} serverPreviewRefreshRef={serverPreviewRefreshRef} />
                {/* Loading overlay shown while project files are still
                    fetching from the server. PreviewTab itself handles
                    the in-browser compile, but the brief gap before
                    files arrive used to look like a blank/broken page —
                    this overlay reassures the user something is loading. */}
                {projectLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm pointer-events-none" data-testid="preview-loading-overlay">
                    <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-zinc-900/80 border border-white/8 shadow-xl">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full border-2 border-cyan-400/20" />
                        <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                      </div>
                      <div className="text-[12px] text-white/85 font-medium">Loading preview…</div>
                      <div className="text-[10px] text-white/45">{selectedProject?.name || 'Project'}</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
          
          <TabsContent value="code" className="absolute inset-0 m-0 p-0 overflow-auto">
            <CodeTab
              project={selectedProject}
              files={files}
              setFiles={setFiles}
              addLog={addLog}
              livePromoteState={livePromoteState}
              setLivePromoteState={setLivePromoteState}
              onApplySuccess={onApplySuccess}
            />
          </TabsContent>
          
          <TabsContent value="assets" className="absolute inset-0 m-0 p-0 overflow-auto">
            <AssetsTab projectId={selectedProject.id} onOpenVariationStudio={onOpenVariationStudio} refreshKey={assetsRefreshKey} />
          </TabsContent>
          
          <TabsContent value="logs" className="absolute inset-0 m-0 p-0 overflow-auto">
            <LogsTab logs={logs} />
          </TabsContent>
          
          <TabsContent value="export" className="absolute inset-0 m-0 p-0 overflow-auto">
            <ExportTab
              project={selectedProject}
              addLog={addLog}
            />
          </TabsContent>
          
          <TabsContent value="deploy" className="absolute inset-0 m-0 p-0 overflow-auto">
            <DeployTab
              project={selectedProject}
              addLog={addLog}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
