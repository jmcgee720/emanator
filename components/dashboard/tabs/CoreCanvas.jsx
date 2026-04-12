'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { FileText, Save, RefreshCw, CheckSquare, Square } from 'lucide-react'

/**
 * CoreCanvas — A collaborative markdown editor for Core System projects.
 * Acts as the AI's project management portal. Both user and AI can edit.
 * Replaces the iframe Preview tab for Core System projects only.
 */
export default function CoreCanvas({ project, onLog = () => {} }) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lastSaved, setLastSaved] = useState(null)
  const [dirty, setDirty] = useState(false)
  const textareaRef = useRef(null)
  const saveTimeoutRef = useRef(null)

  // Load canvas content
  const loadCanvas = useCallback(async () => {
    if (!project?.id) return
    setLoading(true)
    try {
      const res = await authFetch(`/api/projects/${project.id}/canvas`)
      if (res.ok) {
        const data = await res.json()
        let loaded = data.canvas_content
        if (typeof loaded === 'string' && loaded.startsWith('#')) {
          setContent(loaded)
        } else {
          setContent(getDefaultCanvas())
        }
        setDirty(false)
      } else {
        // API error — use default canvas
        setContent(getDefaultCanvas())
        setDirty(false)
      }
    } catch {
      setContent(getDefaultCanvas())
      setDirty(false)
    }
    finally { setLoading(false) }
  }, [project?.id])

  useEffect(() => { loadCanvas() }, [loadCanvas])

  // Auto-save with debounce
  const saveCanvas = useCallback(async (text) => {
    if (!project?.id) return
    setSaving(true)
    try {
      await authFetch(`/api/projects/${project.id}/canvas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvas_content: text })
      })
      setLastSaved(new Date())
      setDirty(false)
    } catch (err) {
      onLog('error', 'Canvas save failed: ' + err.message)
    } finally { setSaving(false) }
  }, [project?.id, onLog])

  const handleChange = (e) => {
    const newContent = e.target.value
    setContent(newContent)
    setDirty(true)
    // Debounced auto-save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveCanvas(newContent), 1500)
  }

  // Toggle checkbox on click
  const handleCheckboxToggle = (lineIndex) => {
    const lines = content.split('\n')
    const line = lines[lineIndex]
    if (line.match(/^- \[x\]/i)) {
      lines[lineIndex] = line.replace(/^- \[x\]/i, '- [ ]')
    } else if (line.match(/^- \[ \]/)) {
      lines[lineIndex] = line.replace(/^- \[ \]/, '- [x]')
    }
    const newContent = lines.join('\n')
    setContent(newContent)
    setDirty(true)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveCanvas(newContent), 800)
  }

  // Listen for AI canvas updates via custom events
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.projectId === project?.id && e.detail?.content) {
        const newContent = typeof e.detail.content === 'object' ? null : e.detail.content
        if (newContent) {
          setContent(newContent)
          setDirty(false)
          setLastSaved(new Date())
        }
      }
    }
    window.addEventListener('canvas_update', handler)
    return () => window.removeEventListener('canvas_update', handler)
  }, [project?.id])

  // Also reload canvas when component becomes visible (tab switch)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadCanvas()
    }, { threshold: 0.1 })
    const el = document.querySelector('[data-testid="core-canvas"]')
    if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [loadCanvas])

  // Render markdown-like content with interactive checkboxes
  const renderContent = () => {
    const lines = content.split('\n')
    return lines.map((line, i) => {
      // Headers
      if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold text-white mt-4 mb-2">{line.slice(2)}</h1>
      if (line.startsWith('## ')) return <h2 key={i} className="text-base font-semibold text-cyan-300 mt-3 mb-1.5">{line.slice(3)}</h2>
      if (line.startsWith('### ')) return <h3 key={i} className="text-sm font-semibold text-purple-300 mt-2 mb-1">{line.slice(4)}</h3>

      // Checkboxes
      if (line.match(/^- \[x\]/i)) {
        return (
          <div key={i} className="flex items-start gap-2 py-0.5 group cursor-pointer" onClick={() => handleCheckboxToggle(i)}>
            <CheckSquare className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <span className="text-sm text-muted-foreground/60 line-through">{line.replace(/^- \[x\]\s*/i, '')}</span>
          </div>
        )
      }
      if (line.match(/^- \[ \]/)) {
        return (
          <div key={i} className="flex items-start gap-2 py-0.5 group cursor-pointer" onClick={() => handleCheckboxToggle(i)}>
            <Square className="w-4 h-4 text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-cyan-400 transition-colors" />
            <span className="text-sm text-foreground/80">{line.replace(/^- \[ \]\s*/, '')}</span>
          </div>
        )
      }

      // Bullet points
      if (line.match(/^- /)) {
        return <div key={i} className="flex items-start gap-2 py-0.5"><span className="text-cyan-400 mt-0.5 shrink-0">-</span><span className="text-sm text-foreground/70">{line.slice(2)}</span></div>
      }

      // Bold
      if (line.includes('**')) {
        const parts = line.split(/\*\*(.*?)\*\*/)
        return (
          <p key={i} className="text-sm text-foreground/70 py-0.5">
            {parts.map((part, j) => j % 2 === 1 ? <strong key={j} className="text-foreground/90 font-semibold">{part}</strong> : part)}
          </p>
        )
      }

      // Horizontal rule
      if (line.match(/^---+$/)) return <hr key={i} className="border-border/30 my-3" />

      // Empty line
      if (!line.trim()) return <div key={i} className="h-2" />

      // Regular text
      return <p key={i} className="text-sm text-foreground/70 py-0.5">{line}</p>
    })
  }

  const [editMode, setEditMode] = useState(false)

  return (
    <div className="h-full flex flex-col" data-testid="core-canvas">
      {/* Toolbar */}
      <div className="h-10 border-b border-border/40 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-foreground/80">Project Canvas</span>
          {dirty && <span className="text-[10px] text-amber-400">unsaved</span>}
          {saving && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="text-[10px] text-muted-foreground/40">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <Button
            size="sm"
            variant={editMode ? 'default' : 'outline'}
            onClick={() => setEditMode(!editMode)}
            className="h-7 text-[11px]"
            data-testid="canvas-edit-toggle"
          >
            {editMode ? 'Preview' : 'Edit'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveCanvas(content)}
            disabled={saving || !dirty}
            className="h-7 text-[11px]"
            data-testid="canvas-save-btn"
          >
            <Save className="w-3 h-3 mr-1" />
            Save
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/30" />
          </div>
        ) : editMode ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            className="w-full h-full p-5 bg-transparent text-foreground/80 font-mono text-sm resize-none focus:outline-none leading-relaxed"
            spellCheck={false}
            placeholder="# Project Canvas&#10;&#10;Write your checklist, roadmap, or notes here...&#10;&#10;- [ ] First task&#10;- [ ] Second task"
            data-testid="canvas-editor"
          />
        ) : (
          <ScrollArea className="h-full">
            <div className="p-5 max-w-3xl" data-testid="canvas-rendered">
              {content.trim() ? renderContent() : (
                <div className="text-center py-12">
                  <FileText className="w-10 h-10 mx-auto text-muted-foreground/15 mb-3" />
                  <p className="text-sm text-muted-foreground/40 mb-2">Canvas is empty</p>
                  <p className="text-xs text-muted-foreground/25">Click Edit to add content, or ask the AI to create a project plan</p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

function getDefaultCanvas() {
  return `# Core System — Project Canvas

## Status
- **Current Phase**: Self-Edit Pipeline (Complete)
- **Last Updated**: ${new Date().toLocaleDateString()}

## Completed
- [x] patch_files tool for safe self-editing
- [x] Silent validation retries
- [x] Auto-reload after Apply to Live
- [x] Enhanced diff view
- [x] Patch history timeline
- [x] Post-edit enhancement suggestions
- [x] Conversational intent detection
- [x] Response quality improvements

## Next Steps
- [ ] CSV export option
- [ ] Conversational AI phases 2-5
- [ ] Deploy integration (Vercel/Netlify)
- [ ] Refactor message-stream.js and service.js

## Notes
Use this canvas to track progress, write notes, and plan improvements. The AI will update this automatically after each self-edit.

---
*This canvas is shared between you and Emanator. Both can read and write.*`
}

function convertJsonCanvasToMarkdown(json) {
  const lines = ['# Core System — Project Canvas\n']
  const str = (v) => typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v || '')
  if (json.project_overview) lines.push(`## Overview\n${str(json.project_overview)}\n`)
  if (json.project_goals?.length) {
    lines.push('## Goals')
    json.project_goals.forEach(g => lines.push(`- ${str(g)}`))
    lines.push('')
  }
  if (json.open_tasks?.length) {
    lines.push('## Open Tasks')
    json.open_tasks.forEach(t => lines.push(`- [ ] ${str(t)}`))
    lines.push('')
  }
  if (json.completed_tasks?.length) {
    lines.push('## Completed')
    json.completed_tasks.forEach(t => lines.push(`- [x] ${str(t)}`))
    lines.push('')
  }
  if (json.key_decisions?.length) {
    lines.push('## Key Decisions')
    json.key_decisions.forEach(d => lines.push(`- ${str(d)}`))
    lines.push('')
  }
  // If it looks empty (only default empty arrays), return the default canvas instead
  const hasContent = json.project_overview || json.project_goals?.length || json.open_tasks?.length || json.completed_tasks?.length || json.key_decisions?.length
  if (!hasContent) return null // signal to use default canvas
  return lines.join('\n')
}
