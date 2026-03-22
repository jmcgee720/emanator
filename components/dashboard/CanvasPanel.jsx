'use client'

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  X, Target, Lightbulb, GitBranch, Wrench,
  CheckCircle2, BookOpen, AlertCircle, ListTodo, Sparkles, Loader2, RefreshCw, WifiOff
} from 'lucide-react'

const CONFIDENCE_COLORS = {
  confirmed: 'text-green-400 border-green-400/30',
  provisional: 'text-amber-400 border-amber-400/30',
  deprecated: 'text-red-400 border-red-400/30',
}

function CanvasSection({ title, icon: Icon, items, emptyText }) {
  if (!items?.length) {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">{title}</h3>
          <Badge variant="outline" className="text-[10px]">0</Badge>
        </div>
        <p className="text-xs text-muted-foreground/60 pl-6">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
      </div>
      <div className="space-y-1.5 pl-6">
        {items.map((item, idx) => {
          const text = typeof item === 'string' ? item : item.text || JSON.stringify(item)
          const confidence = item?.confidence || 'provisional'
          return (
            <div key={item?.id || idx} className="flex items-start gap-2 text-xs group">
              <div className="w-1 h-1 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
              <span className="flex-1 text-foreground/80">{text}</span>
              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${CONFIDENCE_COLORS[confidence] || ''}`}>
                {confidence}
              </Badge>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CanvasPanel({ projectId, canvas: parentCanvas, onUpdate, onClose }) {
  const [canvas, setCanvas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null) // 'auth' | 'network' | null
  const [editing, setEditing] = useState(false)
  const [overview, setOverview] = useState('')

  const fetchCanvas = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setFetchError(null)
    try {
      const res = await authFetch(`/api/projects/${projectId}/canvas`)
      if (res.ok) {
        const data = await res.json()
        const content = data.canvas_content || null
        setCanvas(content)
        if (content?.project_overview) setOverview(content.project_overview)
      } else if (res.status === 401) {
        setFetchError('auth')
      } else {
        setFetchError('network')
      }
    } catch {
      setFetchError('network')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // Fetch on mount and when projectId changes
  useEffect(() => {
    fetchCanvas()
  }, [fetchCanvas])

  // Sync from parent prop (Dashboard pushes updated canvas after generation)
  useEffect(() => {
    if (parentCanvas && Object.keys(parentCanvas).length > 0) {
      setCanvas(parentCanvas)
      setFetchError(null)
      if (parentCanvas.project_overview) setOverview(parentCanvas.project_overview)
    }
  }, [parentCanvas])

  const handleSaveOverview = () => {
    if (onUpdate && canvas) {
      const updated = { ...canvas, project_overview: overview }
      onUpdate(updated)
      setCanvas(updated)
    }
    setEditing(false)
  }

  const hasContent = canvas && Object.values(canvas).some(v =>
    (typeof v === 'string' && v.length > 0) || (Array.isArray(v) && v.length > 0)
  )

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center" data-testid="canvas-panel">
      <div className="w-full max-w-2xl h-[80vh] bg-card rounded-lg border border-border/50 shadow-xl shadow-black/20 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Project Knowledge Canvas</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={fetchCanvas} title="Refresh" disabled={loading} data-testid="canvas-refresh-btn">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="canvas-close-btn">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-4">
          {loading && !canvas ? (
            <div className="flex flex-col items-center justify-center h-full gap-2" data-testid="canvas-loading">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Loading canvas...</p>
            </div>
          ) : fetchError === 'auth' ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3" data-testid="canvas-auth-error">
              <WifiOff className="w-8 h-8 opacity-40 text-amber-400" />
              <p className="text-sm text-amber-300">Session expired</p>
              <p className="text-xs">Your session may have expired. Try refreshing.</p>
              <Button size="sm" variant="outline" onClick={fetchCanvas} className="gap-1.5">
                <RefreshCw className="w-3 h-3" /> Retry
              </Button>
            </div>
          ) : fetchError === 'network' ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3" data-testid="canvas-network-error">
              <AlertCircle className="w-8 h-8 opacity-40 text-red-400" />
              <p className="text-sm text-red-300">Failed to load canvas</p>
              <p className="text-xs">Could not reach the server. Please try again.</p>
              <Button size="sm" variant="outline" onClick={fetchCanvas} className="gap-1.5">
                <RefreshCw className="w-3 h-3" /> Retry
              </Button>
            </div>
          ) : !hasContent ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3" data-testid="canvas-empty">
              <Sparkles className="w-8 h-8 opacity-40" />
              <p className="text-sm">Canvas is empty</p>
              <p className="text-xs">Start a conversation to build the project knowledge base</p>
            </div>
          ) : (
            <div data-testid="canvas-content">
              {/* Overview */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Project Overview</h3>
                </div>
                {editing ? (
                  <div className="pl-6 space-y-2">
                    <textarea
                      value={overview}
                      onChange={(e) => setOverview(e.target.value)}
                      className="w-full h-24 text-xs bg-muted/50 border border-border rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveOverview}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="pl-6 text-xs text-foreground/80">
                    {canvas.project_overview ? (
                      <p className="cursor-pointer hover:text-foreground"
                        onClick={() => { setOverview(canvas.project_overview); setEditing(true) }}
                      >{canvas.project_overview}</p>
                    ) : (
                      <p className="text-muted-foreground/60 cursor-pointer hover:text-muted-foreground"
                        onClick={() => setEditing(true)}
                      >Click to add project overview...</p>
                    )}
                  </div>
                )}
              </div>

              <CanvasSection title="Project Goals" icon={Target}
                items={canvas.project_goals} emptyText="Goals will be extracted from your conversations" />
              <CanvasSection title="Key Decisions" icon={Lightbulb}
                items={canvas.key_decisions} emptyText="Decisions will be logged as you build" />
              <CanvasSection title="Architecture Notes" icon={GitBranch}
                items={canvas.architecture_notes} emptyText="Architecture insights will appear here" />
              <CanvasSection title="Technical Specs" icon={Wrench}
                items={canvas.technical_specs} emptyText="Tech stack and specs will be tracked" />
              <CanvasSection title="Successful Patterns" icon={Sparkles}
                items={canvas.successful_patterns} emptyText="Patterns that worked will be saved here" />
              <CanvasSection title="Open Tasks" icon={ListTodo}
                items={canvas.open_tasks} emptyText="No open tasks" />
              <CanvasSection title="Completed Tasks" icon={CheckCircle2}
                items={canvas.completed_tasks} emptyText="Completed tasks will appear after generation" />
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
