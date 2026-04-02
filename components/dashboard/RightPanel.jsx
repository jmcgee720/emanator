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
}) {

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center em-aurora em-aurora--focused">
        <div className="em-aurora-veil-1" style={{ opacity: 0.4 }} />
        <div className="em-aurora-veil-2" style={{ opacity: 0.3 }} />
        <div className="em-aurora-veil-3" style={{ opacity: 0.3 }} />
        <div className="em-aurora-veil-4" style={{ opacity: 0.25 }} />
        <div className="em-aurora-noise" />
        <div className="text-center relative z-10">
          <FolderOpen className="w-12 h-12 mx-auto em-text-muted mb-4" style={{ opacity: 0.3 }} />
          <h3 className="text-sm font-medium em-text-secondary mb-1">No Project Selected</h3>
          <p className="text-xs em-text-muted">Select or create a project to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col em-aurora em-aurora--focused" data-testid="right-panel">
      <div className="em-aurora-veil-1" style={{ opacity: 0.3 }} />
      <div className="em-aurora-veil-2" style={{ opacity: 0.2 }} />
      <div className="em-aurora-veil-3" style={{ opacity: 0.2 }} />
      <div className="em-aurora-veil-4" style={{ opacity: 0.15 }} />
      <div className="em-aurora-noise" />
      <Tabs value={activeTab} onValueChange={onTabChange} className="flex-1 flex flex-col relative z-5">
        <div className="px-4" style={{ borderBottom: '1px solid rgba(0, 229, 255, 0.06)' }}>
          <TabsList className="h-11 bg-transparent justify-start gap-0.5">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="data-[state=active]:bg-[rgba(0,229,255,0.06)] data-[state=active]:text-[var(--em-text-primary)] data-[state=active]:shadow-none rounded-lg px-3.5 text-xs font-medium em-text-muted transition-colors duration-200"
              >
                <tab.icon className="w-3.5 h-3.5 mr-1.5" />
                {tab.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          <TabsContent value="preview" className="h-full m-0 p-0">
            <PreviewTab project={selectedProject} files={files} onLog={addLog} />
          </TabsContent>
          
          <TabsContent value="code" className="h-full m-0 p-0">
            <CodeTab
              project={selectedProject}
              files={files}
              setFiles={setFiles}
              addLog={addLog}
              livePromoteState={livePromoteState}
              setLivePromoteState={setLivePromoteState}
            />
          </TabsContent>
          
          <TabsContent value="assets" className="h-full m-0 p-0">
            <AssetsTab projectId={selectedProject.id} onOpenVariationStudio={onOpenVariationStudio} refreshKey={assetsRefreshKey} />
          </TabsContent>
          
          <TabsContent value="logs" className="h-full m-0 p-0">
            <LogsTab logs={logs} />
          </TabsContent>
          
          <TabsContent value="export" className="h-full m-0 p-0">
            <ExportTab
              project={selectedProject}
              addLog={addLog}
            />
          </TabsContent>
          
          <TabsContent value="deploy" className="h-full m-0 p-0">
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
