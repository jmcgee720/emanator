'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Brain, Pin, PinOff, Trash2, Edit2, Check, X, RefreshCw, Copy,
  ChevronDown, ChevronRight, Sparkles, AlertTriangle, Shield,
  Search, Eye, EyeOff, ArrowUpDown, ThumbsUp, ThumbsDown, Settings2
} from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { useToast } from '@/hooks/use-toast'

function Section({ title, icon, count, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-muted/30 transition-colors"
        data-testid={`section-${title.replace(/\s/g, '-').toLowerCase()}`}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {icon}
        {title}
        {count > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-auto">{count}</Badge>}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

function MemoryRow({ entry, onDelete, onCopy, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const meta = useMemo(() => {
    try { return typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value || {} } catch { return {} }
  }, [entry.value])

  const startEdit = () => {
    setEditValue(meta.text || meta.value || (typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value || '', null, 2)))
    setEditing(true)
  }

  const saveEdit = () => {
    if (!editValue.trim()) return
    let newValue
    if (meta.text !== undefined) {
      newValue = JSON.stringify({ ...meta, text: editValue.trim() })
    } else {
      newValue = editValue.trim()
    }
    onEdit(entry, newValue)
    setEditing(false)
  }

  return (
    <div className="p-2 rounded-md bg-muted/20 border border-border/20 text-xs" data-testid={`memory-${entry.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-foreground/80 font-mono truncate">{entry.key}</p>
          {editing ? (
            <div className="flex items-center gap-1 mt-1">
              <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-6 text-xs flex-1" autoFocus />
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveEdit}><Check className="w-3 h-3 text-green-400" /></Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditing(false)}><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <>
              {meta.text && <p className="text-muted-foreground truncate mt-0.5">{meta.text}</p>}
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {meta.usage_count > 0 && <Badge variant="outline" className="text-[8px] h-3.5 px-1">{meta.usage_count}x used</Badge>}
                {meta.success_count > 0 && <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-green-500/30 text-green-400">{meta.success_count} ok</Badge>}
                {meta.reject_count > 0 && <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-red-500/30 text-red-400">{meta.reject_count} rejected</Badge>}
                {meta.count > 0 && <Badge variant="outline" className="text-[8px] h-3.5 px-1">{meta.count}x</Badge>}
                {meta.ts && <span className="text-[9px] text-muted-foreground">{new Date(meta.ts).toLocaleDateString()}</span>}
              </div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setExpanded(!expanded)} title="Inspect">
              {expanded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={startEdit} title="Edit" data-testid={`edit-${entry.id}`}>
              <Edit2 className="w-3 h-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onCopy(entry)} title="Copy" data-testid={`copy-${entry.id}`}>
              <Copy className="w-3 h-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400" onClick={() => onDelete(entry)} title="Delete" data-testid={`delete-${entry.id}`}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
      {expanded && !editing && (
        <pre className="mt-2 p-2 bg-muted/30 rounded-md text-[10px] text-muted-foreground overflow-x-auto max-h-32 scrollbar-thin">
          {JSON.stringify(meta, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function BuilderMemory({ open, onClose, projectId }) {
  const [rules, setRules] = useState([])
  const [events, setEvents] = useState([])
  const [memoryEntries, setMemoryEntries] = useState([])
  const [userPrefs, setUserPrefs] = useState(null)
  const [projectPrefs, setProjectPrefs] = useState(null)
  const [builderStatus, setBuilderStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingRule, setEditingRule] = useState(null)
  const [editText, setEditText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [sortMode, setSortMode] = useState('recent')
  const [newEntryKey, setNewEntryKey] = useState('')
  const [newEntryValue, setNewEntryValue] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newConstraint, setNewConstraint] = useState('')
  const { toast } = useToast()

  useEffect(() => {
    if (open && projectId) loadAll()
  }, [open, projectId])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [learnRes, prefsRes, projPrefsRes, memoryRes, statusRes] = await Promise.all([
        authFetch(`/api/projects/${projectId}/learning`),
        authFetch(`/api/projects/${projectId}/user-preferences`),
        authFetch(`/api/projects/${projectId}/project-preferences`),
        authFetch(`/api/projects/${projectId}/memory`),
        authFetch(`/api/projects/${projectId}/builder-status`),
      ])
      if (learnRes.ok) {
        const data = await learnRes.json()
        setRules(data.rules || [])
        setEvents(data.events || [])
      }
      if (prefsRes.ok) setUserPrefs(await prefsRes.json())
      if (projPrefsRes.ok) setProjectPrefs(await projPrefsRes.json())
      if (memoryRes.ok) setMemoryEntries(await memoryRes.json())
      if (statusRes.ok) setBuilderStatus(await statusRes.json())
    } catch {}
    setLoading(false)
  }

  // Categorize memory entries
  const categorized = useMemo(() => {
    const patterns = [], rejected = [], preferences = [], other = []
    for (const e of memoryEntries) {
      if (e.key?.startsWith('prompt_pattern:')) patterns.push(e)
      else if (e.key?.startsWith('rejected_prompt_pattern:')) rejected.push(e)
      else if (e.key?.startsWith('user_preference:')) preferences.push(e)
      else other.push(e)
    }
    return { patterns, rejected, preferences, other }
  }, [memoryEntries])

  // Filter + search + sort
  const filteredEntries = useMemo(() => {
    let entries = memoryEntries
    if (filterType === 'patterns') entries = categorized.patterns
    else if (filterType === 'rejected') entries = categorized.rejected
    else if (filterType === 'preferences') entries = categorized.preferences
    else if (filterType === 'other') entries = categorized.other

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      entries = entries.filter(e => {
        const valStr = typeof e.value === 'string' ? e.value : JSON.stringify(e.value || '')
        return (e.key || '').toLowerCase().includes(q) || valStr.toLowerCase().includes(q)
      })
    }

    return [...entries].sort((a, b) => {
      if (sortMode === 'oldest') return (a.created_at || '').localeCompare(b.created_at || '')
      if (sortMode === 'most_used') {
        const aUse = parseMeta(a).usage_count || parseMeta(a).count || 0
        const bUse = parseMeta(b).usage_count || parseMeta(b).count || 0
        return bUse - aUse
      }
      return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
    })
  }, [memoryEntries, filterType, searchQuery, sortMode, categorized])

  function parseMeta(entry) {
    try { return typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value || {} } catch { return {} }
  }

  const handleDeleteMemory = async (entry) => {
    try {
      await authFetch(`/api/projects/${projectId}/memory/${entry.id}`, { method: 'DELETE' })
      setMemoryEntries(prev => prev.filter(e => e.id !== entry.id))
      toast({ title: 'Entry deleted' })
    } catch { toast({ title: 'Delete failed', variant: 'destructive' }) }
  }

  const handleCopyMemory = (entry) => {
    const text = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2)
    navigator.clipboard.writeText(text).catch(() => {})
    toast({ title: 'Copied to clipboard' })
  }

  const handleEditMemory = async (entry, newValue) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}/memory/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: entry.key, value: newValue }),
      })
      if (res.ok) {
        const updated = await res.json()
        setMemoryEntries(prev => prev.map(e => e.id === entry.id ? updated : e))
        toast({ title: 'Entry updated' })
      }
    } catch { toast({ title: 'Update failed', variant: 'destructive' }) }
  }

  const handleCreateMemory = async () => {
    if (!newEntryKey.trim()) return
    try {
      const res = await authFetch(`/api/projects/${projectId}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newEntryKey.trim(), value: newEntryValue.trim() || '{}' }),
      })
      if (res.ok) {
        const entry = await res.json()
        setMemoryEntries(prev => [entry, ...prev])
        setNewEntryKey('')
        setNewEntryValue('')
        setShowCreateForm(false)
        toast({ title: 'Entry created' })
      }
    } catch { toast({ title: 'Create failed', variant: 'destructive' }) }
  }

  const handleUpdateProjectPref = async (key, value) => {
    const body = {}
    body[key] = value
    const res = await authFetch(`/api/projects/${projectId}/project-preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setProjectPrefs(await res.json())
    toast({ title: 'Project preference updated' })
  }

  const handleAddConstraint = async () => {
    if (!newConstraint.trim()) return
    const current = projectPrefs?.recurring_constraints || []
    await handleUpdateProjectPref('recurring_constraints', [...current, newConstraint.trim()])
    setNewConstraint('')
  }

  const handleRemoveConstraint = async (idx) => {
    const current = [...(projectPrefs?.recurring_constraints || [])]
    current.splice(idx, 1)
    await handleUpdateProjectPref('recurring_constraints', current)
  }

  const handlePinRule = async (ruleId, pinned) => {
    await authFetch(`/api/projects/${projectId}/learning/rules/${ruleId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    })
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, pinned } : r))
    toast({ title: pinned ? 'Rule pinned' : 'Rule unpinned' })
  }

  const handleDeleteRule = async (ruleId) => {
    await authFetch(`/api/projects/${projectId}/learning/rules/${ruleId}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== ruleId))
    toast({ title: 'Rule deleted' })
  }

  const handleEditRule = async (ruleId) => {
    if (!editText.trim()) return
    await authFetch(`/api/projects/${projectId}/learning/rules/${ruleId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editText.trim() }),
    })
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, text: editText.trim() } : r))
    setEditingRule(null)
    toast({ title: 'Rule updated' })
  }

  const handlePromoteRule = async (rule) => {
    await authFetch(`/api/projects/${projectId}/learning/rules/${rule.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'user' }),
    })
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, scope: 'user' } : r))
    toast({ title: 'Rule promoted to all projects' })
  }

  const handleResetProject = async () => {
    await authFetch(`/api/projects/${projectId}/learning/reset`, { method: 'POST' })
    setRules([])
    setEvents([])
    toast({ title: 'Project memory reset' })
  }

  const handleResetAll = async () => {
    await authFetch(`/api/projects/${projectId}/learning/reset-all`, { method: 'POST' })
    setRules([])
    setEvents([])
    setUserPrefs(null)
    setMemoryEntries([])
    toast({ title: 'All adaptive memory reset' })
  }

  const handleUpdatePref = async (key, value) => {
    const body = {}
    const keys = key.split('.')
    let obj = body
    for (let i = 0; i < keys.length - 1; i++) { obj[keys[i]] = {}; obj = obj[keys[i]] }
    obj[keys[keys.length - 1]] = value
    const res = await authFetch(`/api/projects/${projectId}/user-preferences`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setUserPrefs(await res.json())
    toast({ title: 'Preference updated' })
  }

  const sortedRules = [...rules].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.confidence - a.confidence)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] p-0 gap-0 bg-card border-border/50" data-testid="builder-memory">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/40">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Builder Memory
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Learned preferences & rules that adapt your AI</p>

          {/* Total Memory Entries summary — added by Proof Test #2 */}
          {!loading && (
            <div className="flex items-center gap-2 mt-2" data-testid="memory-total-summary">
              <span className="text-[11px] text-muted-foreground">Total Memory Entries:</span>
              <span className="text-[11px] font-mono font-medium text-[#00E5FF]" data-testid="memory-total-count">{memoryEntries.length}</span>
              {categorized.patterns.length > 0 && <span className="text-[10px] text-green-400/70">{categorized.patterns.length} patterns</span>}
              {categorized.rejected.length > 0 && <span className="text-[10px] text-red-400/70">{categorized.rejected.length} rejected</span>}
              {categorized.preferences.length > 0 && <span className="text-[10px] text-amber-400/70">{categorized.preferences.length} prefs</span>}
            </div>
          )}

          {/* Filter / Search / Sort toolbar */}
          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search memory..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-7 pl-7 text-xs bg-input/40 border-border/50"
                data-testid="memory-search"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-7 w-[110px] text-[11px] bg-input/40 border-border/50" data-testid="memory-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Types</SelectItem>
                <SelectItem value="patterns" className="text-xs">Patterns</SelectItem>
                <SelectItem value="rejected" className="text-xs">Rejected</SelectItem>
                <SelectItem value="preferences" className="text-xs">Preferences</SelectItem>
                <SelectItem value="other" className="text-xs">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger className="h-7 w-[100px] text-[11px] bg-input/40 border-border/50" data-testid="memory-sort">
                <ArrowUpDown className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent" className="text-xs">Recent</SelectItem>
                <SelectItem value="oldest" className="text-xs">Oldest</SelectItem>
                <SelectItem value="most_used" className="text-xs">Most Used</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-170px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-[hsl(190_100%_50%/0.3)] border-t-[#00E5FF] rounded-full animate-spin" />
            </div>
          ) : (
            <div className="p-4 space-y-3">

              {/* Saved Prompt Patterns */}
              <Section title="Saved Prompt Patterns" icon={<ThumbsUp className="w-3 h-3 text-green-400" />} count={categorized.patterns.length} defaultOpen={categorized.patterns.length > 0}>
                {categorized.patterns.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No patterns learned yet. Patterns are saved from successful plans.</p>
                ) : (
                  <div className="space-y-1.5">
                    {(filterType === 'all' || filterType === 'patterns' ? categorized.patterns : [])
                      .filter(e => !searchQuery || (e.key + JSON.stringify(e.value)).toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(e => <MemoryRow key={e.id} entry={e} onDelete={handleDeleteMemory} onCopy={handleCopyMemory} onEdit={handleEditMemory} />)}
                  </div>
                )}
              </Section>

              {/* Rejected Patterns */}
              {categorized.rejected.length > 0 && (
                <Section title="Rejected Patterns" icon={<ThumbsDown className="w-3 h-3 text-red-400" />} count={categorized.rejected.length} defaultOpen={false}>
                  <div className="space-y-1.5">
                    {categorized.rejected
                      .filter(e => !searchQuery || (e.key + JSON.stringify(e.value)).toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(e => <MemoryRow key={e.id} entry={e} onDelete={handleDeleteMemory} onCopy={handleCopyMemory} onEdit={handleEditMemory} />)}
                  </div>
                </Section>
              )}

              {/* User Preferences (self-builder inferred) */}
              {categorized.preferences.length > 0 && (
                <Section title="Inferred Preferences" icon={<Settings2 className="w-3 h-3 text-amber-400" />} count={categorized.preferences.length} defaultOpen={false}>
                  <div className="space-y-1.5">
                    {categorized.preferences
                      .filter(e => !searchQuery || (e.key + JSON.stringify(e.value)).toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(e => <MemoryRow key={e.id} entry={e} onDelete={handleDeleteMemory} onCopy={handleCopyMemory} onEdit={handleEditMemory} />)}
                  </div>
                </Section>
              )}

              {/* Custom Memory Entries + Create */}
              <Section title="Custom Memory" icon={<Brain className="w-3 h-3 text-indigo-400" />} count={categorized.other.length}>
                {showCreateForm ? (
                  <div className="space-y-1.5 mb-2">
                    <Input placeholder="Key (e.g. user_preference:theme)" value={newEntryKey} onChange={e => setNewEntryKey(e.target.value)} className="h-7 text-xs bg-input/40" data-testid="new-memory-key" />
                    <Input placeholder="Value (JSON or text)" value={newEntryValue} onChange={e => setNewEntryValue(e.target.value)} className="h-7 text-xs bg-input/40" data-testid="new-memory-value" />
                    <div className="flex gap-1">
                      <Button size="sm" className="h-6 text-xs gap-1 flex-1" onClick={handleCreateMemory} data-testid="save-new-memory"><Check className="w-3 h-3" />Save</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowCreateForm(false)}><X className="w-3 h-3" /></Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full h-6 text-xs gap-1 mb-2 border-dashed border-border/40" onClick={() => setShowCreateForm(true)} data-testid="add-memory-entry">
                    + Add Entry
                  </Button>
                )}
                {categorized.other.length === 0 && !showCreateForm && (
                  <p className="text-xs text-muted-foreground py-1">No custom entries yet.</p>
                )}
                <div className="space-y-1.5">
                  {categorized.other
                    .filter(e => !searchQuery || (e.key + JSON.stringify(e.value)).toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(e => <MemoryRow key={e.id} entry={e} onDelete={handleDeleteMemory} onCopy={handleCopyMemory} onEdit={handleEditMemory} />)}
                </div>
              </Section>

              {/* Learned Rules */}
              <Section title="Learned Rules" icon={<Shield className="w-3 h-3 text-blue-400" />} count={sortedRules.length}>
                {sortedRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No rules learned yet. The AI learns from your corrections automatically.</p>
                ) : (
                  <div className="space-y-1.5">
                    {sortedRules.map(rule => (
                      <div key={rule.id} className={`flex items-start gap-2 p-2 rounded-md text-xs ${rule.pinned ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-muted/20 border border-border/20'}`} data-testid={`rule-${rule.id}`}>
                        {editingRule === rule.id ? (
                          <div className="flex-1 flex items-center gap-1">
                            <Input value={editText} onChange={e => setEditText(e.target.value)} className="h-6 text-xs" autoFocus />
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleEditRule(rule.id)}><Check className="w-3 h-3 text-green-400" /></Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingRule(null)}><X className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground/80">{rule.text}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <Badge variant="outline" className="text-[8px] h-3.5 px-1">{rule.category}</Badge>
                                <Badge variant="outline" className="text-[8px] h-3.5 px-1">{Math.round(rule.confidence * 100)}%</Badge>
                                {rule.scope === 'user' && <Badge className="text-[8px] h-3.5 px-1 bg-[hsl(270_70%_55%/0.2)] text-[#7C3AED] border-0">global</Badge>}
                                {rule.count > 1 && <span className="text-[9px] text-muted-foreground">{rule.count}x</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => handlePinRule(rule.id, !rule.pinned)} title={rule.pinned ? 'Unpin' : 'Pin'}>
                                {rule.pinned ? <PinOff className="w-3 h-3 text-amber-400" /> : <Pin className="w-3 h-3" />}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditingRule(rule.id); setEditText(rule.text) }}><Edit2 className="w-3 h-3" /></Button>
                              {rule.scope !== 'user' && (
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => handlePromoteRule(rule)} title="Promote to all projects"><Copy className="w-3 h-3" /></Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400" onClick={() => handleDeleteRule(rule.id)}><Trash2 className="w-3 h-3" /></Button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Response Preferences */}
              <Section title="Response Preferences" icon={<Sparkles className="w-3 h-3 text-purple-400" />} count={0} defaultOpen={false}>
                {userPrefs && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Conciseness</span>
                      <Select value={userPrefs.response_style?.concise_level || 'balanced'} onValueChange={v => handleUpdatePref('response_style.concise_level', v)}>
                        <SelectTrigger className="h-6 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="concise" className="text-xs">Concise</SelectItem>
                          <SelectItem value="balanced" className="text-xs">Balanced</SelectItem>
                          <SelectItem value="verbose" className="text-xs">Detailed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Full files (not snippets)</span>
                      <Switch checked={userPrefs.response_style?.prefer_full_files || false} onCheckedChange={v => handleUpdatePref('response_style.prefer_full_files', v)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Plan-first mode</span>
                      <Switch checked={userPrefs.response_style?.prefer_plan_first ?? true} onCheckedChange={v => handleUpdatePref('response_style.prefer_plan_first', v)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Reuse components</span>
                      <Switch checked={userPrefs.coding_style?.prefer_component_reuse ?? true} onCheckedChange={v => handleUpdatePref('coding_style.prefer_component_reuse', v)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Edit existing files</span>
                      <Switch checked={userPrefs.coding_style?.prefer_existing_files ?? true} onCheckedChange={v => handleUpdatePref('coding_style.prefer_existing_files', v)} />
                    </div>
                  </div>
                )}
              </Section>

              {/* Self-Builder Status */}
              <Section title="Self-Builder Status" icon={<Brain className="w-3 h-3 text-cyan-400" />} count={0} defaultOpen={false}>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total builds (recent)</span>
                    <span className="font-mono">{builderStatus?.total ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Applied</span>
                    <span className="font-mono text-green-400">{builderStatus?.applied ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rolled back</span>
                    <span className="font-mono text-red-400">{builderStatus?.rolledBack ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discarded</span>
                    <span className="font-mono text-amber-400">{builderStatus?.discarded ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Self-edits</span>
                    <span className="font-mono text-cyan-400">{builderStatus?.selfEdits ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last build</span>
                    <span className="font-mono text-[10px]">{builderStatus?.lastBuild ? new Date(builderStatus.lastBuild).toLocaleString() : '—'}</span>
                  </div>
                  <div className="border-t border-border/20 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Prompt patterns</span>
                      <span className="font-mono">{categorized.patterns.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rejected patterns</span>
                      <span className="font-mono">{categorized.rejected.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inferred preferences</span>
                      <span className="font-mono">{categorized.preferences.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Learned rules</span>
                      <span className="font-mono">{rules.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Learning events</span>
                      <span className="font-mono">{events.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total memory entries</span>
                      <span className="font-mono">{memoryEntries.length}</span>
                    </div>
                  </div>
                </div>
              </Section>

              {/* Project Rules / Constraints */}
              <Section title="Project Rules" icon={<Shield className="w-3 h-3 text-teal-400" />} count={(projectPrefs?.recurring_constraints || []).length} defaultOpen={false}>
                <div className="space-y-2">
                  {(projectPrefs?.recurring_constraints || []).map((c, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-1.5 rounded-md bg-muted/20 border border-border/20 text-xs">
                      <span className="flex-1 text-foreground/80">{c}</span>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400" onClick={() => handleRemoveConstraint(idx)} data-testid={`remove-constraint-${idx}`}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      placeholder="Add project rule / constraint…"
                      value={newConstraint}
                      onChange={e => setNewConstraint(e.target.value)}
                      className="h-7 text-xs bg-input/40 flex-1"
                      onKeyDown={e => e.key === 'Enter' && handleAddConstraint()}
                      data-testid="new-constraint-input"
                    />
                    <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddConstraint} data-testid="add-constraint-btn">Add</Button>
                  </div>
                  {projectPrefs?.design_language && (
                    <div className="text-[10px] text-muted-foreground mt-1">Design: {projectPrefs.design_language}</div>
                  )}
                </div>
              </Section>

              {/* Recent Learning Events */}
              <Section title="Recent Learning" icon={<RefreshCw className="w-3 h-3 text-muted-foreground" />} count={events.length} defaultOpen={false}>
                {events.slice(-10).reverse().map(evt => (
                  <div key={evt.id} className="flex items-start gap-2 py-1.5 text-[11px] border-b border-border/10 last:border-0">
                    <Badge variant="outline" className="text-[8px] h-3.5 px-1 flex-shrink-0 mt-0.5">{evt.event_type}</Badge>
                    <span className="text-muted-foreground truncate">{evt.source_text?.slice(0, 80) || 'N/A'}</span>
                  </div>
                ))}
                {events.length === 0 && <p className="text-xs text-muted-foreground py-2">No learning events yet.</p>}
              </Section>

              {/* Reset */}
              <Section title="Reset Memory" icon={<AlertTriangle className="w-3 h-3 text-red-400" />} count={0} defaultOpen={false}>
                <div className="space-y-2">
                  <Button size="sm" variant="outline" className="w-full text-xs h-7 gap-1.5 border-amber-500/30 text-amber-400" onClick={handleResetProject} data-testid="reset-project-memory">
                    <RefreshCw className="w-3 h-3" /> Reset Project Memory
                  </Button>
                  <Button size="sm" variant="outline" className="w-full text-xs h-7 gap-1.5 border-red-500/30 text-red-400" onClick={handleResetAll} data-testid="reset-all-memory">
                    <AlertTriangle className="w-3 h-3" /> Reset All Adaptive Memory
                  </Button>
                </div>
              </Section>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
