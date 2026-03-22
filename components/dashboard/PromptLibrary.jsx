'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  BookOpen, Plus, Search, Star, Trash2, Copy, Tag, Send, X,
  ChevronDown, ChevronRight
} from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'
import { useToast } from '@/hooks/use-toast'

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'landing-page', label: 'Landing Page' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sprite-sheet', label: 'Sprite Sheet' },
  { key: 'bug-fix', label: 'Bug Fix' },
  { key: 'refactor', label: 'Refactor' },
  { key: 'export', label: 'Export' },
  { key: 'design', label: 'Design' },
  { key: 'api', label: 'API' },
  { key: 'component', label: 'Component' },
  { key: 'general', label: 'General' },
]

export default function PromptLibrary({ open, onClose, projectId, onUsePrompt }) {
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newPrompt, setNewPrompt] = useState({ text: '', title: '', category: 'general', is_master: false })
  const { toast } = useToast()

  useEffect(() => {
    if (open && projectId) loadPrompts()
  }, [open, projectId])

  const loadPrompts = async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/projects/${projectId}/prompt-library`)
      if (res.ok) {
        const data = await res.json()
        setPrompts(data.prompts || [])
      }
    } catch {}
    setLoading(false)
  }

  const handleSave = async () => {
    if (!newPrompt.text.trim()) return
    try {
      const res = await authFetch(`/api/projects/${projectId}/prompt-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPrompt),
      })
      if (res.ok) {
        const saved = await res.json()
        setPrompts(prev => [...prev, saved])
        setNewPrompt({ text: '', title: '', category: 'general', is_master: false })
        setShowAdd(false)
        toast({ title: 'Prompt saved to library' })
      }
    } catch {}
  }

  const handleDelete = async (promptId) => {
    await authFetch(`/api/projects/${projectId}/prompt-library/${promptId}`, { method: 'DELETE' })
    setPrompts(prev => prev.filter(p => p.id !== promptId))
    toast({ title: 'Prompt deleted' })
  }

  const handleUse = (prompt) => {
    onUsePrompt?.(prompt.text)
    onClose()
    toast({ title: 'Prompt loaded into composer' })
  }

  const filtered = prompts.filter(p => {
    if (filter !== 'all' && p.category !== filter) return false
    if (search && !p.text.toLowerCase().includes(search.toLowerCase()) && !p.title?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).sort((a, b) => {
    if (a.is_master && !b.is_master) return -1
    if (!a.is_master && b.is_master) return 1
    return new Date(b.created_at) - new Date(a.created_at)
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] p-0 gap-0 bg-zinc-900 border-zinc-700" data-testid="prompt-library">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-zinc-700/50">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-400" />
            Prompt Library
          </DialogTitle>
          <div className="flex items-center gap-2 mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search prompts..."
                className="h-7 pl-7 text-xs"
                data-testid="prompt-search"
              />
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowAdd(!showAdd)} data-testid="add-prompt-btn">
              <Plus className="w-3 h-3" /> Add
            </Button>
          </div>
        </DialogHeader>

        {/* Category filter */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border/30 overflow-x-auto" data-testid="prompt-categories">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setFilter(cat.key)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                filter === cat.key
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-muted-foreground hover:bg-muted/30 border border-transparent'
              }`}
              data-testid={`prompt-cat-${cat.key}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <ScrollArea className="max-h-[calc(85vh-200px)]">
          {/* Add new prompt form */}
          {showAdd && (
            <div className="p-4 border-b border-border/30 bg-zinc-800/30" data-testid="add-prompt-form">
              <Input
                value={newPrompt.title}
                onChange={e => setNewPrompt(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Prompt title (optional)"
                className="h-7 text-xs mb-2"
              />
              <textarea
                value={newPrompt.text}
                onChange={e => setNewPrompt(prev => ({ ...prev, text: e.target.value }))}
                placeholder="Prompt text..."
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none mb-2"
                data-testid="new-prompt-text"
              />
              <div className="flex items-center gap-2">
                <Select value={newPrompt.category} onValueChange={v => setNewPrompt(prev => ({ ...prev, category: v }))}>
                  <SelectTrigger className="h-6 text-[10px] w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter(c => c.key !== 'all').map(cat => (
                      <SelectItem key={cat.key} value={cat.key} className="text-xs">{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={newPrompt.is_master} onChange={e => setNewPrompt(prev => ({ ...prev, is_master: e.target.checked }))} className="w-3 h-3" />
                  Master
                </label>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button size="sm" className="h-6 text-xs bg-indigo-600" onClick={handleSave} data-testid="save-prompt-btn">Save</Button>
              </div>
            </div>
          )}

          {/* Prompts list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 px-8">
              <BookOpen className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No prompts found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Save prompts from successful chat messages or add them manually.</p>
            </div>
          ) : (
            <div className="p-3 space-y-1.5" data-testid="prompts-list">
              {filtered.map(prompt => (
                <div
                  key={prompt.id}
                  className="group p-2.5 rounded-lg border border-border/20 hover:border-indigo-500/20 bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors"
                  data-testid={`prompt-${prompt.id}`}
                >
                  <div className="flex items-start gap-2">
                    {prompt.is_master && <Star className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      {prompt.title && <p className="text-xs font-medium text-foreground/90 mb-0.5">{prompt.title}</p>}
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{prompt.text}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Badge variant="outline" className="text-[8px] h-3.5 px-1">{prompt.category}</Badge>
                        {prompt.intent && <Badge variant="outline" className="text-[8px] h-3.5 px-1">{prompt.intent}</Badge>}
                        {prompt.provider && <Badge variant="outline" className="text-[8px] h-3.5 px-1">{prompt.provider}</Badge>}
                        {prompt.success === false && <Badge className="text-[8px] h-3.5 px-1 bg-red-600/20 text-red-400 border-0">failed</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleUse(prompt)} title="Use this prompt" data-testid={`use-prompt-${prompt.id}`}>
                        <Send className="w-3 h-3 text-indigo-400" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => handleDelete(prompt.id)} title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Inline "Save to Library" dialog triggered from a chat message
 */
export function SavePromptDialog({ open, onClose, projectId, messageText, metadata }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('general')
  const [isMaster, setIsMaster] = useState(false)
  const { toast } = useToast()

  const handleSave = async () => {
    try {
      await authFetch(`/api/projects/${projectId}/prompt-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: messageText,
          title: title || messageText.slice(0, 60),
          category,
          is_master: isMaster,
          provider: metadata?.provider || null,
          model: metadata?.model || null,
          intent: metadata?.intent || null,
          success: true,
          source_message_id: metadata?.message_id || null,
        }),
      })
      toast({ title: 'Prompt saved to library' })
      onClose()
    } catch {
      toast({ title: 'Failed to save prompt', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm bg-zinc-900 border-zinc-700" data-testid="save-prompt-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-400" /> Save to Prompt Library
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground line-clamp-2 bg-muted/20 p-2 rounded">{messageText?.slice(0, 200)}</p>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)" className="h-7 text-xs" />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.filter(c => c.key !== 'all').map(cat => (
                <SelectItem key={cat.key} value={cat.key} className="text-xs">{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={isMaster} onChange={e => setIsMaster(e.target.checked)} className="w-3.5 h-3.5" />
            Mark as master prompt
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="text-xs h-7 bg-indigo-600" onClick={handleSave} data-testid="confirm-save-prompt">Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
