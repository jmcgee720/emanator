'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  File,
  Folder,
  FolderOpen,
  Plus,
  Save,
  Trash2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Upload,
  Undo2
} from 'lucide-react'

export default function CodeTab({ project, files, setFiles, addLog, livePromoteState, setLivePromoteState }) {
  const { toast } = useToast()
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)

  const isCore = project?.settings?.is_core === true

  const handlePromoteToLive = async () => {
    if (!project?.id || promoting) return
    setPromoting(true)
    try {
      const response = await authFetch(`/api/projects/${project.id}/promote-to-live`, { method: 'POST' })
      const text = await response.text()
      const data = JSON.parse(text)
      if (response.ok && data.success) {
        setLivePromoteState({ snapshotId: data.snapshot_id, lastApply: { time: new Date().toISOString(), filesWritten: data.files_written } })
        addLog('success', `Applied ${data.files_written} file(s) to live system`)
        const warnMsg = data.warnings?.length > 0 ? ` Warning: ${data.warnings.length} file(s) significantly smaller than original — use Rollback if unintended.` : ''
        toast({ title: 'Applied to Live', description: `${data.files_written} file(s) applied.${warnMsg}` })
      } else {
        addLog('error', data.error || `Apply failed`)
        toast({ title: 'Apply Failed', description: data.error || 'Something went wrong.', variant: 'destructive' })
      }
    } catch (err) {
      addLog('error', 'Apply to live failed: ' + err.message)
      toast({ title: 'Apply Failed', description: err.message, variant: 'destructive' })
    } finally {
      setPromoting(false)
    }
  }

  const handleRollbackLive = async () => {
    if (!project?.id || rollingBack || !livePromoteState?.snapshotId) return
    setRollingBack(true)
    try {
      const response = await authFetch(`/api/projects/${project.id}/rollback-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: livePromoteState.snapshotId })
      })
      const text = await response.text()
      const data = JSON.parse(text)
      if (response.ok && data.success) {
        setLivePromoteState(prev => ({ ...prev, snapshotId: null, lastApply: null }))
        addLog('success', `Rolled back ${data.files_restored} file(s)`)
        toast({ title: 'Rolled Back', description: `${data.files_restored} file(s) restored.` })
      } else {
        addLog('error', data.error || 'Rollback failed')
        toast({ title: 'Rollback Failed', description: data.error || 'Something went wrong.', variant: 'destructive' })
      }
    } catch (err) {
      addLog('error', 'Rollback failed: ' + err.message)
    } finally {
      setRollingBack(false)
    }
  }

  const handleSyncRepo = async () => {
    if (!project?.id || syncing) return
    setSyncing(true)
    try {
      const response = await authFetch(`/api/projects/${project.id}/sync-repo`, { method: 'POST' })
      const data = await response.json()
      if (data.success) {
        addLog('success', `Synced ${data.synced} file(s) from repo`)
        const filesRes = await authFetch(`/api/projects/${project.id}/files`)
        if (filesRes.ok) setFiles(await filesRes.json())
      } else {
        addLog('error', data.error || 'Sync failed')
      }
    } catch (err) {
      addLog('error', 'Sync failed: ' + err.message)
    } finally {
      setSyncing(false)
    }
  }

  // Build file tree
  const buildFileTree = () => {
      const tree = {}
  files
    .filter(file => file && typeof file.path === 'string' && file.path.length > 0)
    .forEach(file => {
      const parts = file.path.split('/')

      let current = tree
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          current[part] = { ...file, isFile: true }
        } else {
          if (!current[part]) {
            current[part] = { isFolder: true, children: {} }
          }
          current = current[part].children
        }
      })
    })
    return tree
  }

  const handleFileSelect = (file) => {
    setSelectedFile(file)
    setFileContent(file.content || '')
  }

  const handleSaveFile = async () => {
    if (!selectedFile) return
    
    setSaving(true)
    try {
      const headers = { 'Content-Type': 'application/json' }
      await authFetch(`/api/projects/${project.id}/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: selectedFile.path,
          content: fileContent,
          file_type: selectedFile.file_type || 'text'
        })
      })
      
      // Update local state
      setFiles(files.map(f => 
        f.id === selectedFile.id ? { ...f, content: fileContent } : f
      ))
      
      addLog('success', `Saved ${selectedFile.path}`)
    } catch (error) {
      addLog('error', `Failed to save ${selectedFile.path}`)
    } finally {
      setSaving(false)
    }
  }

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return
    
    try {
      const headers = { 'Content-Type': 'application/json' }
      const response = await authFetch(`/api/projects/${project.id}/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: newFileName,
          content: '',
          file_type: 'text'
        })
      })
      
      const newFile = await response.json()
      setFiles([...files, newFile])
      setNewFileName('')
      setShowNewFile(false)
      addLog('success', `Created ${newFileName}`)
    } catch (error) {
      addLog('error', `Failed to create file`)
    }
  }

  const FileTreeItem = ({ name, item, depth = 0 }) => {
    const [expanded, setExpanded] = useState(true)
    
    if (item.isFile) {
      return (
        <div
          className={`flex items-center gap-2 py-1.5 px-2 cursor-pointer hover:bg-muted/35 rounded-md ${
            selectedFile?.id === item.id ? 'bg-muted/50' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleFileSelect(item)}
        >
          <File className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm truncate">{name}</span>
        </div>
      )
    }
    
    return (
      <div>
        <div
          className="flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-muted/35 rounded-md"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen className="w-4 h-4 text-amber-500" />
          ) : (
            <Folder className="w-4 h-4 text-amber-500" />
          )}
          <span className="text-sm">{name}</span>
        </div>
        {expanded && item.children && (
          <div>
            {Object.entries(item.children).map(([childName, childItem]) => (
              <FileTreeItem
                key={childName}
                name={childName}
                item={childItem}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const fileTree = buildFileTree()

  return (
    <div className="h-full flex">
      {/* File Tree */}
      <div className="w-64 border-r border-border/40 flex flex-col">
        <div className="h-10 border-b border-border/40 flex items-center justify-between px-3">
          <span className="text-sm font-medium">Files</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSyncRepo}
              disabled={syncing}
              title="Sync repo files from disk"
              data-testid="sync-repo-btn"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNewFile(true)}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {isCore && (
          <div className="px-3 py-2 border-b border-border/40 flex items-center gap-1.5" data-testid="core-live-controls">
            <Button
              size="sm"
              variant="default"
              onClick={handlePromoteToLive}
              disabled={promoting || !files?.length}
              className="h-7 text-[11px] px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="apply-to-live-btn"
            >
              {promoting ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
              {promoting ? 'Applying...' : 'Apply to Live'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRollbackLive}
              disabled={rollingBack || !livePromoteState?.snapshotId}
              className="h-7 text-[11px] px-2.5"
              data-testid="rollback-live-btn"
            >
              {rollingBack ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Undo2 className="w-3 h-3 mr-1" />}
              {rollingBack ? 'Rolling back...' : 'Rollback'}
            </Button>
          </div>
        )}
        
        {showNewFile && (
          <div className="p-2 border-b border-border/40">
            <Input
              placeholder="filename.js"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
              className="h-8 text-sm"
              autoFocus
            />
            <div className="flex gap-1 mt-2">
              <Button size="sm" className="flex-1 h-7" onClick={handleCreateFile}>
                Create
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowNewFile(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        
        <ScrollArea className="flex-1">
          <div className="p-2">
            {Object.keys(fileTree).length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">No files yet</p>
            ) : (
              Object.entries(fileTree).map(([name, item]) => (
                <FileTreeItem key={name} name={name} item={item} />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Code Editor */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            <div className="h-10 border-b border-border/40 flex items-center justify-between px-4">
              <span className="text-sm text-muted-foreground">{selectedFile.path}</span>
              <Button size="sm" onClick={handleSaveFile} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                className="w-full h-full p-4 bg-background text-foreground font-mono text-sm resize-none focus:outline-none"
                spellCheck={false}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <File className="w-10 h-10 mx-auto text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Select a file to edit</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
