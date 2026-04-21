'use client'

import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, GitCompare, Play, RotateCcw, X, Zap, Brain, Sparkles, CheckCircle2, AlertTriangle, ArrowUpRight } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

const PROVIDER_ICONS = { openai: Zap, anthropic: Brain, gemini: Sparkles, google: Sparkles }

/**
 * Default lane configuration — compares the three top flagships out of
 * the box. User can edit each lane's provider/model via dropdown.
 */
const DEFAULT_LANES = [
  { provider: 'openai',    model: 'gpt-5.1' },
  { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  { provider: 'gemini',    model: 'gemini-2.5-pro' },
]

const ALL_MODELS = {
  openai: [
    { id: 'gpt-5.2',     label: 'GPT-5.2' },
    { id: 'gpt-5.1',     label: 'GPT-5.1' },
    { id: 'gpt-4o',      label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-5-20251101',   label: 'Claude Opus 4.5' },
    { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash' },
  ],
}

export default function CompareProvidersDialog({ open, onOpenChange, initialPrompt = '', onApplyLane = null }) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [lanes, setLanes] = useState(DEFAULT_LANES)
  const [laneState, setLaneState] = useState({}) // { [index]: { content, status, ms, error } }
  const [running, setRunning] = useState(false)
  const abortRef = useRef(null)

  useEffect(() => { if (open && initialPrompt) setPrompt(initialPrompt) }, [open, initialPrompt])

  const resetLanes = () => setLaneState(Object.fromEntries(lanes.map((_, i) => [i, { content: '', status: 'idle', ms: 0 }])))

  const handleLaneChange = (index, patch) => {
    setLanes((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }

  const handleRun = async () => {
    if (!prompt.trim() || running) return
    setRunning(true)
    resetLanes()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const resp = await authFetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/ab-compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), lanes }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        setLaneState((prev) => ({ ...prev, _error: err.error || `HTTP ${resp.status}` }))
        return
      }
      // Parse SSE stream
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const ev of events) {
          if (!ev.trim()) continue
          const eventMatch = ev.match(/^event:\s*(.+)$/m)
          const dataMatch = ev.match(/^data:\s*(.+)$/m)
          if (!eventMatch || !dataMatch) continue
          const eventType = eventMatch[1].trim()
          let data
          try { data = JSON.parse(dataMatch[1]) } catch { continue }
          switch (eventType) {
            case 'start':
              setLaneState(Object.fromEntries(data.lanes.map((l) => [l.index, { content: '', status: 'running', ms: 0, provider: l.provider, model: l.model }])))
              break
            case 'token':
              setLaneState((prev) => ({
                ...prev,
                [data.lane]: { ...(prev[data.lane] || { content: '', status: 'running', ms: 0 }), content: (prev[data.lane]?.content || '') + data.delta },
              }))
              break
            case 'lane_done':
              setLaneState((prev) => ({
                ...prev,
                [data.lane]: { ...(prev[data.lane] || {}), status: 'done', ms: data.ms, content: data.content || prev[data.lane]?.content || '' },
              }))
              break
            case 'lane_error':
              setLaneState((prev) => ({
                ...prev,
                [data.lane]: { ...(prev[data.lane] || {}), status: 'error', error: data.error, ms: data.ms },
              }))
              break
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLaneState((prev) => ({ ...prev, _error: err.message }))
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const handleCancel = () => { abortRef.current?.abort(); setRunning(false) }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1400px,96vw)] max-h-[90vh] flex flex-col" data-testid="ab-compare-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5" /> Compare providers
            <span className="text-xs text-muted-foreground font-normal ml-2">Same prompt · side-by-side · streamed in parallel</span>
          </DialogTitle>
        </DialogHeader>

        {/* Prompt input */}
        <div className="space-y-2" data-testid="ab-compare-prompt-row">
          <label className="text-xs text-muted-foreground">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
            placeholder="Write the same prompt you'd send in the composer…"
            rows={3}
            className="w-full rounded-md bg-background/40 border border-border/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
            data-testid="ab-compare-prompt"
          />
          <div className="flex items-center justify-end gap-2">
            {running ? (
              <Button variant="outline" onClick={handleCancel} data-testid="ab-compare-cancel">
                <X className="w-4 h-4 mr-1" /> Cancel
              </Button>
            ) : (
              <Button variant="outline" onClick={resetLanes} disabled={!Object.keys(laneState).length} data-testid="ab-compare-reset">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset
              </Button>
            )}
            <Button onClick={handleRun} disabled={!prompt.trim() || running} data-testid="ab-compare-run">
              {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
              {running ? 'Running…' : 'Compare'}
            </Button>
          </div>
        </div>

        {laneState._error && (
          <div className="flex items-center gap-2 text-sm text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20" data-testid="ab-compare-top-error">
            <AlertTriangle className="w-4 h-4" /> {laneState._error}
          </div>
        )}

        {/* Lane grid */}
        <div className={`grid gap-3 overflow-auto pr-1 ${lanes.length === 2 ? 'grid-cols-2' : 'grid-cols-1 lg:grid-cols-3'}`} data-testid="ab-compare-lanes">
          {lanes.map((lane, index) => {
            const state = laneState[index] || { content: '', status: 'idle', ms: 0 }
            const ProviderIcon = PROVIDER_ICONS[lane.provider] || Sparkles
            return (
              <div key={index} className="flex flex-col rounded-lg border border-border/60 bg-muted/10 min-h-[280px]" data-testid={`ab-compare-lane-${index}`}>
                {/* Lane header — provider + model selector */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
                  <ProviderIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <select
                    disabled={running}
                    value={lane.provider}
                    onChange={(e) => {
                      const newProv = e.target.value
                      const firstModel = ALL_MODELS[newProv]?.[0]?.id
                      handleLaneChange(index, { provider: newProv, model: firstModel })
                    }}
                    className="text-xs bg-transparent border-0 focus:outline-none cursor-pointer font-semibold"
                    data-testid={`ab-compare-lane-${index}-provider`}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Google</option>
                  </select>
                  <select
                    disabled={running}
                    value={lane.model}
                    onChange={(e) => handleLaneChange(index, { model: e.target.value })}
                    className="text-xs bg-transparent border-0 focus:outline-none cursor-pointer flex-1 truncate"
                    data-testid={`ab-compare-lane-${index}-model`}
                  >
                    {(ALL_MODELS[lane.provider] || []).map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <LaneStatusBadge state={state} />
                </div>

                {/* Lane body — streamed output */}
                <div className="flex-1 overflow-auto p-3 text-sm leading-relaxed whitespace-pre-wrap font-mono" data-testid={`ab-compare-lane-${index}-output`}>
                  {state.error ? (
                    <div className="text-rose-400 text-xs">
                      <div className="font-semibold mb-1">Error</div>
                      {state.error}
                    </div>
                  ) : state.content ? (
                    state.content
                  ) : state.status === 'running' ? (
                    <div className="text-muted-foreground italic"><Loader2 className="w-3 h-3 inline animate-spin mr-1" /> waiting for first token…</div>
                  ) : (
                    <div className="text-muted-foreground text-xs italic">Hit Compare to stream output here.</div>
                  )}
                </div>

                {/* Winner-apply footer — only renders when onApplyLane prop is set AND lane completed */}
                {state.status === 'done' && onApplyLane && (
                  <div className="border-t border-border/40 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground truncate">Pick this provider + model for your next message</span>
                    <button
                      onClick={() => { onApplyLane({ provider: lane.provider, model: lane.model }); onOpenChange(false) }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                      data-testid={`ab-compare-lane-${index}-apply`}
                    >
                      <ArrowUpRight className="w-3 h-3" /> Use this
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="text-[10px] text-muted-foreground text-center pt-1">
          Each lane charges {lanes.length} × 0.5 credits. Cancel anytime — no charge for unfinished lanes.
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LaneStatusBadge({ state }) {
  if (state.status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400" data-testid="ab-compare-lane-status-done">
        <CheckCircle2 className="w-3 h-3" /> {(state.ms / 1000).toFixed(1)}s
      </span>
    )
  }
  if (state.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-400" data-testid="ab-compare-lane-status-error">
        <AlertTriangle className="w-3 h-3" /> error
      </span>
    )
  }
  if (state.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400" data-testid="ab-compare-lane-status-running">
        <Loader2 className="w-3 h-3 animate-spin" />
      </span>
    )
  }
  return null
}
