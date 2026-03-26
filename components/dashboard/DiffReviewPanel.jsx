'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  FilePlus, FileEdit, FileX, ChevronDown, ChevronUp,
  Check, X, Loader2, Shield, CheckCircle2, ArrowRight
} from 'lucide-react'

const ACTION_CONFIG = {
  create: { icon: FilePlus, label: 'Create', color: 'text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', lineColor: 'text-emerald-300' },
  update: { icon: FileEdit, label: 'Update', color: 'text-blue-400', bg: 'bg-blue-500/8', border: 'border-blue-500/20', lineColor: 'text-blue-300' },
  delete: { icon: FileX, label: 'Delete', color: 'text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/20', lineColor: 'text-red-300' },
}

function computeLineDiff(oldText, newText) {
  if (!oldText) return newText?.split('\n').map(l => ({ type: 'add', content: l })) || []
  if (!newText) return oldText.split('\n').map(l => ({ type: 'remove', content: l }))

  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result = []
  const maxLen = Math.max(oldLines.length, newLines.length)

  // Simple line-by-line diff
  let oi = 0, ni = 0
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ type: 'add', content: newLines[ni], lineNew: ni + 1 })
      ni++
    } else if (ni >= newLines.length) {
      result.push({ type: 'remove', content: oldLines[oi], lineOld: oi + 1 })
      oi++
    } else if (oldLines[oi] === newLines[ni]) {
      result.push({ type: 'same', content: oldLines[oi], lineOld: oi + 1, lineNew: ni + 1 })
      oi++; ni++
    } else {
      // Check if old line was removed or new line was added
      const nextOldInNew = newLines.indexOf(oldLines[oi], ni)
      const nextNewInOld = oldLines.indexOf(newLines[ni], oi)

      if (nextNewInOld !== -1 && (nextOldInNew === -1 || nextNewInOld - oi < nextOldInNew - ni)) {
        while (oi < nextNewInOld) {
          result.push({ type: 'remove', content: oldLines[oi], lineOld: oi + 1 })
          oi++
        }
      } else if (nextOldInNew !== -1) {
        while (ni < nextOldInNew) {
          result.push({ type: 'add', content: newLines[ni], lineNew: ni + 1 })
          ni++
        }
      } else {
        result.push({ type: 'remove', content: oldLines[oi], lineOld: oi + 1 })
        result.push({ type: 'add', content: newLines[ni], lineNew: ni + 1 })
        oi++; ni++
      }
    }
    if (result.length > maxLen + 200) break // safety
  }
  return result
}

function DiffFileCard({ diff, selected, onToggle, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const config = ACTION_CONFIG[diff.action] || ACTION_CONFIG.create
  const Icon = config.icon

  const diffLines = useMemo(() => {
    if (diff.action === 'create') return diff.newContent?.split('\n').map(l => ({ type: 'add', content: l })) || []
    if (diff.action === 'delete') return diff.oldContent?.split('\n').map(l => ({ type: 'remove', content: l })) || []
    return computeLineDiff(diff.oldContent, diff.newContent)
  }, [diff])

  const stats = useMemo(() => {
    const adds = diffLines.filter(l => l.type === 'add').length
    const removes = diffLines.filter(l => l.type === 'remove').length
    return { adds, removes }
  }, [diffLines])

  // Show only changed lines in context (collapse large unchanged blocks)
  const visibleLines = useMemo(() => {
    const CONTEXT = 3
    const changed = new Set()
    diffLines.forEach((l, i) => {
      if (l.type !== 'same') {
        for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diffLines.length - 1, i + CONTEXT); j++) {
          changed.add(j)
        }
      }
    })
    const result = []
    let lastShown = -1
    diffLines.forEach((l, i) => {
      if (changed.has(i)) {
        if (lastShown !== -1 && i - lastShown > 1) {
          result.push({ type: 'separator', count: i - lastShown - 1 })
        }
        result.push({ ...l, index: i })
        lastShown = i
      }
    })
    // If all lines are changed (create/delete), show all
    if (result.length === 0) return diffLines.map((l, i) => ({ ...l, index: i }))
    return result
  }, [diffLines])

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-all ${
        selected ? config.border : 'border-border/30 opacity-50'
      }`}
      data-testid={`diff-card-${diff.path.replace(/[/.]/g, '-')}`}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${selected ? config.bg : 'bg-muted/15'} hover:bg-white/[0.015]`}
        onClick={() => setExpanded(e => !e)}
        data-testid={`diff-card-header-${diff.path.replace(/[/.]/g, '-')}`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
            selected
              ? 'bg-[hsl(190_100%_50%)] border-[hsl(190_100%_50%)] text-[hsl(252_40%_5%)]'
              : 'border-border/50 bg-muted/30 text-muted-foreground/40'
          }`}
          data-testid={`diff-toggle-${diff.path.replace(/[/.]/g, '-')}`}
        >
          {selected && <Check className="w-3 h-3" />}
        </button>

        <Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />

        <code className="text-xs font-mono text-foreground/90 truncate flex-1">{diff.path}</code>

        <Badge variant="outline" className={`text-[9px] ${config.color} border-current/20`}>
          {config.label}
        </Badge>

        {stats.adds > 0 && <span className="text-[10px] text-emerald-400 font-mono">+{stats.adds}</span>}
        {stats.removes > 0 && <span className="text-[10px] text-red-400 font-mono">-{stats.removes}</span>}

        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>

      {/* Diff content */}
      {expanded && (
        <div className="border-t border-border/20 max-h-[300px] overflow-auto">
          {diff.description && (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/15">
              {diff.description}
            </div>
          )}
          <div className="font-mono text-[11px] leading-[18px]">
            {visibleLines.map((line, i) => {
              if (line.type === 'separator') {
                return (
                  <div key={`sep-${i}`} className="px-3 py-0.5 text-muted-foreground/40 bg-muted/15 text-center text-[10px]">
                    ··· {line.count} unchanged lines ···
                  </div>
                )
              }
              return (
                <div
                  key={i}
                  className={`px-2 flex gap-0 ${
                    line.type === 'add' ? 'bg-emerald-500/[0.08] text-emerald-300' :
                    line.type === 'remove' ? 'bg-red-500/[0.08] text-red-300' :
                    'text-muted-foreground/60'
                  }`}
                  data-testid={`diff-line-${i}`}
                >
                  <span className="w-8 flex-shrink-0 text-muted-foreground/30 text-right select-none pr-1 border-r border-border/20" data-testid={`diff-line-old-${i}`}>
                    {line.lineOld || ''}
                  </span>
                  <span className="w-8 flex-shrink-0 text-muted-foreground/30 text-right select-none pr-1 border-r border-border/20" data-testid={`diff-line-new-${i}`}>
                    {line.lineNew || ''}
                  </span>
                  <span className="w-4 flex-shrink-0 text-center select-none ml-1">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre overflow-x-auto pl-1">{line.content}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function DiffReviewPanel({ diffs, status, onApply, onCancel, applying }) {
  const [selectedPaths, setSelectedPaths] = useState(() =>
    new Set(diffs.map(d => d.path))
  )

  if (!diffs || diffs.length === 0) return null

  const creates = diffs.filter(d => d.action === 'create')
  const updates = diffs.filter(d => d.action === 'update')
  const deletes = diffs.filter(d => d.action === 'delete')

  const toggleFile = (path) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectAll = () => setSelectedPaths(new Set(diffs.map(d => d.path)))
  const selectNone = () => setSelectedPaths(new Set())
  const selectedCount = selectedPaths.size

  const handleApply = () => {
    const approved = diffs.filter(d => selectedPaths.has(d.path))
    onApply(approved)
  }

  const isApplied = status === 'applied'
  const isCancelled = status === 'cancelled'
  const isPending = status === 'pending'

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isApplied ? 'border-emerald-500/20 bg-emerald-950/5' :
        isCancelled ? 'border-border/30 bg-muted/10 opacity-60' :
        'border-[hsl(270_70%_55%/0.2)] bg-[hsl(270_70%_55%/0.03)]'
      }`}
      data-testid="diff-review-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center ${
            isApplied ? 'bg-emerald-500/15' : isCancelled ? 'bg-muted/30' : 'bg-[hsl(270_70%_55%/0.15)]'
          }`}>
            {isApplied ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : applying ? (
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
            ) : (
              <Shield className="w-4 h-4 text-amber-400" />
            )}
          </div>
          <div>
            <span className="text-sm font-medium text-foreground">
              {isApplied ? 'Changes Applied' : isCancelled ? 'Changes Discarded' : 'Review Changes'}
            </span>
            <div className="flex items-center gap-3 mt-0.5">
              {creates.length > 0 && <span className="text-[10px] text-emerald-400">+{creates.length} new</span>}
              {updates.length > 0 && <span className="text-[10px] text-blue-400">~{updates.length} modified</span>}
              {deletes.length > 0 && <span className="text-[10px] text-red-400">-{deletes.length} deleted</span>}
            </div>
          </div>
        </div>

        {isPending && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <button onClick={selectAll} className="hover:text-foreground transition-colors">All</button>
            <span>/</span>
            <button onClick={selectNone} className="hover:text-foreground transition-colors">None</button>
            <span className="ml-1">({selectedCount}/{diffs.length})</span>
          </div>
        )}
      </div>

      {/* File diffs */}
      <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto" data-testid="diff-file-list">
        {diffs.map((diff, i) => (
          <DiffFileCard
            key={diff.path}
            diff={diff}
            selected={selectedPaths.has(diff.path)}
            onToggle={() => toggleFile(diff.path)}
            defaultExpanded={diffs.length <= 3}
          />
        ))}
      </div>

      {/* Action buttons */}
      {isPending && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border/20" data-testid="diff-actions">
          <Button
            size="sm"
            onClick={handleApply}
            disabled={applying || selectedCount === 0}
            className="h-8 gap-1.5 em-btn-brand shadow-sm"
            data-testid="diff-apply-btn"
          >
            {applying ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying...</>
            ) : selectedCount === diffs.length ? (
              <><Check className="w-3.5 h-3.5" /> Apply All</>
            ) : (
              <><ArrowRight className="w-3.5 h-3.5" /> Apply {selectedCount} Selected</>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={applying}
            className="h-8 gap-1.5 text-muted-foreground hover:text-red-400"
            data-testid="diff-cancel-btn"
          >
            <X className="w-3.5 h-3.5" /> Discard All
          </Button>
        </div>
      )}

      {/* Snapshot notice */}
      {isApplied && (
        <div className="px-4 py-2 border-t border-emerald-500/8 flex items-center gap-1.5 text-[10px] text-emerald-400/70">
          <Shield className="w-3 h-3" />
          Snapshot created before applying. You can rollback if needed.
        </div>
      )}
    </div>
  )
}
