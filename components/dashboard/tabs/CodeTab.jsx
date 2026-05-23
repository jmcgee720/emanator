'use client'

import { useState, useEffect } from 'react'
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
  Undo2,
  Clock,
  RotateCcw,
  Download,
  FileSpreadsheet
} from 'lucide-react'

export default function CodeTab({ project, files, setFiles, addLog, livePromoteState, setLivePromoteState, onApplySuccess }) {
  const { toast } = useToast()
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [originalContent, setOriginalContent] = useState(null)
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [patchHistory, setPatchHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [restoringSnapshot, setRestoringSnapshot] = useState(null)

  const isCore = project?.settings?.is_core === true

  // Load patch history for Core System projects
  const loadPatchHistory = async () => {
    if (!project?.id || !isCore) return
    setLoadingHistory(true)
    try {
      const res = await authFetch(`/api/projects/${project.id}/patch-history`)
      if (res.ok) {
        const data = await res.json()
        setPatchHistory(data.history || [])
      }
    } catch { /* non-critical */ }
    finally { setLoadingHistory(false) }
  }

  useEffect(() => {
    if (showHistory && isCore) loadPatchHistory()
  }, [showHistory, project?.id])

  // Reload history after applying to live
  useEffect(() => {
    if (livePromoteState?.lastApply && isCore) loadPatchHistory()
  }, [livePromoteState?.lastApply])

  const handleRestoreSnapshot = async (snapshotId) => {
    if (restoringSnapshot) return
    setRestoringSnapshot(snapshotId)
    try {
      const res = await authFetch(`/api/projects/${project.id}/rollback-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: snapshotId })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast({ title: 'Restored', description: `Rolled back ${data.files_restored} file(s) to this snapshot.` })
        addLog('success', `Restored snapshot: ${data.files_restored} file(s)`)
      } else {
        toast({ title: 'Restore Failed', description: data.error || 'Something went wrong.', variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'Restore Failed', description: err.message, variant: 'destructive' })
    } finally { setRestoringSnapshot(null) }
  }

  const handlePromoteToLive = async () => {
    if (!project?.id || promoting) return
    console.log('[CodeTab] handlePromoteToLive called, projectId:', project.id)
    setPromoting(true)
    try {
      const response = await authFetch(`/api/projects/${project.id}/promote-to-live`, { method: 'POST' })
      const text = await response.text()
      const data = JSON.parse(text)
      if (response.ok && data.success) {
        setLivePromoteState({ snapshotId: data.snapshot_id, lastApply: { time: new Date().toISOString(), filesWritten: data.files_written } })
        addLog('success', `Applied ${data.files_written} file(s) to live system`)
        const warnMsg = data.warnings?.length > 0 ? ` Warning: ${data.warnings.length} file(s) significantly smaller than original — use Rollback if unintended.` : ''
        toast({ title: 'Applied to Live', description: `${data.files_written} file(s) written to disk. Hot-reload triggered.${warnMsg}` })
        // Brief delay then confirm reload and trigger next step
        setTimeout(() => {
          toast({ title: 'Reload Complete', description: 'Changes are now live.' })
        }, 2000)
      } else if (data.auto_reverted) {
        addLog('error', `Auto-reverted: ${data.error}`)
        toast({ title: 'Auto-Reverted', description: 'The edit caused a compilation error and was reverted. The AI is analyzing what went wrong...', variant: 'destructive' })
        // Dispatch event so Dashboard can trigger AI explanation
        window.dispatchEvent(new CustomEvent('core_apply_reverted', { detail: { files_attempted: data.files_attempted, detail: data.detail, error: data.error } }))
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

  const handleExportCSV = () => {
    if (!files || files.length === 0) {
      toast({ title: 'No Files', description: 'No files to export.', variant: 'destructive' })
      return
    }
    const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`
    const rows = [['Path', 'Type', 'Size (chars)', 'Lines', 'Last Updated']]
    files.forEach(f => {
      const lineCount = (f.content || '').split('\n').length
      const ext = (f.path || '').split('.').pop() || 'unknown'
      rows.push([
        esc(f.path),
        esc(ext),
        String((f.content || '').length),
        String(lineCount),
        esc(f.updated_at || f.created_at || ''),
      ])
    })
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project?.name || 'project'}-files.csv`
    link.click()
    URL.revokeObjectURL(url)
    addLog('success', `Exported ${files.length} files to CSV`)
    toast({ title: 'CSV Exported', description: `${files.length} files exported.` })
  }

  const handleExportZip = async () => {
    if (!project?.id) return
    try {
      const response = await authFetch(`/api/projects/${project.id}/export-zip`, { method: 'POST' })
      const data = await response.json()
      if (data.zip_base64) {
        const link = document.createElement('a')
        link.href = `data:application/zip;base64,${data.zip_base64}`
        link.download = data.filename || `${project.name}.zip`
        link.click()
        addLog('success', `Downloaded ${data.filename}`)
        toast({ title: 'ZIP Downloaded', description: data.filename })
      } else {
        toast({ title: 'Export Failed', description: data.error || 'No zip generated', variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'Export Failed', description: err.message, variant: 'destructive' })
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

  const handleFileSelect = async (file) => {
    setSelectedFile(file)
    setFileContent(file.content || '')
    setShowDiff(false)
    setOriginalContent(null)
    
    // Fetch original from disk for diff comparison (Core System only)
    if (isCore && file.path) {
      try {
        const response = await authFetch(`/api/projects/${project.id}/file-diff?path=${encodeURIComponent(file.path)}`)
        if (response.ok) {
          const data = await response.json()
          if (data.original) setOriginalContent(data.original)
        }
      } catch (e) { /* non-critical */ }
    }
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

  // Memoize file tree to prevent constant rebuilds that block clicks
  const fileTree = React.useMemo(() => buildFileTree(), [files])

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
              onClick={handleExportCSV}
              title="Export file list as CSV"
              data-testid="export-csv-btn"
            >
              <FileSpreadsheet className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExportZip}
              title="Download project as ZIP"
              data-testid="export-zip-btn"
            >
              <Download className="w-4 h-4" />
            </Button>
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
            <span className="text-[10px] text-emerald-400 font-medium mr-1">Changes apply instantly</span>
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
            <Button
              size="sm"
              variant={showHistory ? 'default' : 'outline'}
              onClick={() => setShowHistory(!showHistory)}
              className="h-7 text-[11px] px-2.5 ml-auto"
              data-testid="patch-history-btn"
            >
              <Clock className="w-3 h-3 mr-1" />
              History
            </Button>
          </div>
        )}

        {/* Patch History Panel */}
        {isCore && showHistory && (
          <div className="border-b border-border/40 max-h-48 overflow-y-auto" data-testid="patch-history-panel">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider sticky top-0" style={{ background: 'var(--em-bg-secondary, rgba(10,10,30,0.95))' }}>
              Patch History
            </div>
            {loadingHistory ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground flex items-center gap-2">
                <RefreshCw className="w-3 h-3 animate-spin" /> Loading...
              </div>
            ) : patchHistory.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">
                No patch history yet. Apply edits to live to create snapshots.
              </div>
            ) : (
              patchHistory.map((snap) => (
                <div key={snap.id} className="px-3 py-1.5 flex items-center gap-2 hover:bg-[rgba(255,255,255,0.03)] group" data-testid={`history-item-${snap.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-foreground/80 truncate">
                      {snap.files?.map(f => f.path.split('/').pop()).join(', ') || 'Snapshot'}
                    </div>
                    <div className="text-[10px] text-muted-foreground/50">
                      {new Date(snap.created_at).toLocaleString()} · {snap.file_count} file{snap.file_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRestoreSnapshot(snap.id)}
                    disabled={restoringSnapshot === snap.id}
                    data-testid={`restore-snapshot-${snap.id}`}
                  >
                    {restoringSnapshot === snap.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  </Button>
                </div>
              ))
            )}
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
              <div className="flex items-center gap-2">
                {isCore && originalContent && (
                  <Button
                    size="sm"
                    variant={showDiff ? 'default' : 'outline'}
                    onClick={() => setShowDiff(!showDiff)}
                    className="h-7 text-[11px]"
                    data-testid="toggle-diff-btn"
                  >
                    {showDiff ? 'Code' : 'Diff'}
                  </Button>
                )}
                <Button size="sm" onClick={handleSaveFile} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {showDiff && originalContent ? (
                <div className="w-full h-full overflow-auto font-mono text-sm" data-testid="diff-view">
                  {(() => {
                    const origLines = originalContent.split('\n')
                    const newLines = (fileContent || '').split('\n')
                    const maxLen = Math.max(origLines.length, newLines.length)
                    const diffLines = []
                    let addCount = 0
                    let removeCount = 0
                    for (let i = 0; i < maxLen; i++) {
                      const ol = origLines[i]
                      const nl = newLines[i]
                      if (ol === nl) {
                        diffLines.push({ type: 'same', line: nl, origNum: i + 1, newNum: i + 1 })
                      } else if (ol !== undefined && nl !== undefined) {
                        diffLines.push({ type: 'removed', line: ol, origNum: i + 1, newNum: null })
                        diffLines.push({ type: 'added', line: nl, origNum: null, newNum: i + 1 })
                        addCount++
                        removeCount++
                      } else if (ol === undefined) {
                        diffLines.push({ type: 'added', line: nl, origNum: null, newNum: i + 1 })
                        addCount++
                      } else {
                        diffLines.push({ type: 'removed', line: ol, origNum: i + 1, newNum: null })
                        removeCount++
                      }
                    }

                    // Collapse unchanged regions (show 3 context lines around changes)
                    const CONTEXT = 3
                    const changedIndices = new Set()
                    diffLines.forEach((d, i) => {
                      if (d.type !== 'same') {
                        for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diffLines.length - 1, i + CONTEXT); j++) {
                          changedIndices.add(j)
                        }
                      }
                    })

                    const collapsed = []
                    let skippedCount = 0
                    for (let i = 0; i < diffLines.length; i++) {
                      if (changedIndices.has(i)) {
                        if (skippedCount > 0) {
                          collapsed.push({ type: 'collapsed', count: skippedCount })
                          skippedCount = 0
                        }
                        collapsed.push(diffLines[i])
                      } else {
                        skippedCount++
                      }
                    }
                    if (skippedCount > 0) collapsed.push({ type: 'collapsed', count: skippedCount })

                    return (
                      <>
                        <div className="sticky top-0 z-10 h-8 flex items-center px-4 text-[11px] border-b border-border/40"
                          style={{ background: 'var(--em-bg-secondary, rgba(10,10,30,0.95))' }}
                          data-testid="diff-summary"
                        >
                          <span className="text-emerald-400 mr-3">+{addCount} addition{addCount !== 1 ? 's' : ''}</span>
                          <span className="text-red-400 mr-3">-{removeCount} removal{removeCount !== 1 ? 's' : ''}</span>
                          <span className="text-muted-foreground">{origLines.length} → {newLines.length} lines</span>
                        </div>
                        <div className="p-0">
                          {collapsed.map((d, i) =>
                            d.type === 'collapsed' ? (
                              <div key={`c-${i}`} className="px-4 py-0.5 text-[10px] text-muted-foreground/50 bg-[rgba(255,255,255,0.02)] border-y border-border/10 select-none">
                                ··· {d.count} unchanged line{d.count !== 1 ? 's' : ''} ···
                              </div>
                            ) : (
                              <div key={i} className={`flex whitespace-pre ${
                                d.type === 'added' ? 'bg-emerald-500/10 text-emerald-300' :
                                d.type === 'removed' ? 'bg-red-500/10 text-red-300' :
                                'text-muted-foreground/70'
                              }`}>
                                <span className="inline-block w-10 text-right pr-1 text-[10px] opacity-30 select-none border-r border-border/20 shrink-0">
                                  {d.origNum || ''}
                                </span>
                                <span className="inline-block w-10 text-right pr-1 text-[10px] opacity-30 select-none border-r border-border/20 shrink-0">
                                  {d.newNum || ''}
                                </span>
                                <span className="inline-block w-4 text-center shrink-0 opacity-60 select-none">
                                  {d.type === 'added' ? '+' : d.type === 'removed' ? '−' : ' '}
                                </span>
                                <span className="flex-1">{d.line}</span>
                              </div>
                            )
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              ) : (
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-full p-4 bg-background text-foreground font-mono text-sm resize-none focus:outline-none"
                  spellCheck={false}
                />
              )}
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
