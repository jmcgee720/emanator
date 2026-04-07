'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Eye, Code, FolderOpen, Terminal, Download, Rocket, Share2, Check, Copy, Loader2, Link } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { useState } from 'react'
import PreviewTab from './tabs/PreviewTab'
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

  const handleShare = async () => {
    if (!selectedProject?.id) return
    setSharing(true)
    setShareUrl(null)
    try {
      const res = await authFetch(`/api/projects/${selectedProject.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.share_url) {
        setShareUrl(data.share_url)
        addLog('success', `Share link created: ${data.share_url}`)
      } else {
        addLog('error', data.error || 'Failed to create share link')
      }
    } catch {
      addLog('error', 'Failed to create share link')
    } finally {
      setSharing(false)
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

          {/* Share Button */}
          <div className="flex items-center gap-2 shrink-0 pb-1">
            {shareUrl ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <Link className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-[10px] text-emerald-300 font-medium truncate max-w-[180px]">{shareUrl.replace(/^https?:\/\//, '')}</span>
                <button
                  onClick={copyShareUrl}
                  className="ml-1 w-5 h-5 flex items-center justify-center rounded transition-all duration-150 hover:bg-[rgba(52,211,153,0.15)]"
                  data-testid="share-copy-btn"
                >
                  {shareCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-emerald-400" />}
                </button>
              </div>
            ) : (
              <button
                onClick={handleShare}
                disabled={sharing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 disabled:opacity-40"
                style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)', color: 'var(--em-cyan)' }}
                data-testid="share-project-btn"
              >
                {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
                {sharing ? 'Creating...' : 'Share'}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0 relative">
          <TabsContent value="preview" className="absolute inset-0 m-0 p-0" style={{height: '100%'}}>
            <PreviewTab project={selectedProject} files={files} onLog={addLog} livePreviewData={livePreviewData} isBuilding={isBuilding} onRefreshFiles={handleRefreshFiles} />
          </TabsContent>
          
          <TabsContent value="code" className="absolute inset-0 m-0 p-0 overflow-auto">
            <CodeTab
              project={selectedProject}
              files={files}
              setFiles={setFiles}
              addLog={addLog}
              livePromoteState={livePromoteState}
              setLivePromoteState={setLivePromoteState}
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
