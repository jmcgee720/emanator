'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Eye, Code, FolderOpen, Terminal, Download, Rocket } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
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
        <div className="px-5 pt-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
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
