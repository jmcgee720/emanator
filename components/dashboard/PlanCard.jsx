'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FilePlus, FileEdit, FileX, Play, RotateCcw, X,
  ChevronDown, ChevronUp, Loader2, CheckCircle2
} from 'lucide-react'

const ACTION_CONFIG = {
  create: { icon: FilePlus, label: 'Create', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  update: { icon: FileEdit, label: 'Update', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  delete: { icon: FileX, label: 'Delete', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
}

export default function PlanCard({ plan, status, onExecute, onRevise, onCancel, executing }) {
  const [expanded, setExpanded] = useState(true)

  if (!plan) return null

  const fileActions = plan.file_actions || []
  const creates = fileActions.filter(a => a.action === 'create')
  const updates = fileActions.filter(a => a.action === 'update')
  const deletes = fileActions.filter(a => a.action === 'delete')

  const isProposed = status === 'proposed'
  const isExecuted = status === 'executed'
  const isCancelled = status === 'cancelled'

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-all ${
        isExecuted ? 'border-emerald-500/25 bg-emerald-950/8' :
        isCancelled ? 'border-border/30 bg-muted/15 opacity-60' :
        'border-[hsl(190_100%_50%/0.2)] bg-[hsl(190_100%_50%/0.03)]'
      }`}
      data-testid="plan-card"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.015] transition-colors"
        onClick={() => setExpanded(e => !e)}
        data-testid="plan-card-header"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isExecuted ? 'bg-emerald-500/15' : isCancelled ? 'bg-muted/30' : 'bg-[hsl(190_100%_50%/0.12)]'
          }`}>
            {isExecuted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : executing ? (
              <Loader2 className="w-4 h-4 text-[#00E5FF] animate-spin" />
            ) : (
              <Play className="w-4 h-4 text-[#00E5FF]" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {isExecuted ? 'Plan Executed' : isCancelled ? 'Plan Cancelled' : 'Implementation Plan'}
              </span>
              <Badge variant="outline" className={`text-[10px] ${
                isExecuted ? 'text-emerald-400 border-emerald-500/25' :
                isCancelled ? 'text-muted-foreground border-border/30' :
                'text-[#00E5FF] border-[hsl(190_100%_50%/0.2)]'
              }`}>
                {plan.intent || 'build'}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {creates.length > 0 && <span className="text-[10px] text-emerald-400">{creates.length} create</span>}
              {updates.length > 0 && <span className="text-[10px] text-blue-400">{updates.length} update</span>}
              {deletes.length > 0 && <span className="text-[10px] text-red-400">{deletes.length} delete</span>}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 space-y-3">
          {/* Summary */}
          <p className="text-sm text-foreground/80 leading-relaxed">{plan.summary}</p>

          {/* File actions list */}
          {fileActions.length > 0 && (
            <div className="space-y-1.5" data-testid="plan-file-actions">
              {fileActions.map((action, i) => {
                const config = ACTION_CONFIG[action.action] || ACTION_CONFIG.create
                const Icon = config.icon
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg ${config.bg} border ${config.border}`}
                    data-testid={`plan-file-action-${i}`}
                  >
                    <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-foreground/90 truncate">{action.path}</code>
                        <Badge variant="outline" className={`text-[9px] ${config.color} border-current/20`}>
                          {config.label}
                        </Badge>
                      </div>
                      {action.reason && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{action.reason}</p>
                      )}
                      {action.grounded_on?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1" data-testid={`plan-grounded-on-${i}`}>
                          {action.grounded_on.slice(0, 3).map((anchor, j) => (
                            <span key={j} className="text-[9px] text-amber-400/70 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[260px]" title={anchor}>
                              {anchor}
                            </span>
                          ))}
                          {action.grounded_on.length > 3 && (
                            <span className="text-[9px] text-muted-foreground">+{action.grounded_on.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Reasoning */}
          {Array.isArray(plan.reasoning) && plan.reasoning.length > 0 ? (
            <div className="text-xs text-muted-foreground/70 bg-muted/20 rounded-lg px-3 py-2 leading-relaxed space-y-1">
              {plan.reasoning.map((step, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="text-muted-foreground/50 flex-shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          ) : plan.reasoning ? (
            <div className="text-xs text-muted-foreground/70 bg-muted/20 rounded-lg px-3 py-2 leading-relaxed">
              {plan.reasoning}
            </div>
          ) : null}

          {/* Grounding checks */}
          {plan.constraints_checked && (
            <div className="flex flex-wrap items-center gap-2 text-[10px]" data-testid="plan-grounding-checks">
              {plan.constraints_checked.grounded_in_file_context && (
                <span className="text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded-full">grounded</span>
              )}
              {plan.constraints_checked.minimal_patch && (
                <span className="text-blue-400/80 bg-blue-500/10 px-2 py-0.5 rounded-full">minimal patch</span>
              )}
              {plan.constraints_checked.no_illegal_create && (
                <span className="text-violet-400/80 bg-violet-500/10 px-2 py-0.5 rounded-full">actions verified</span>
              )}
            </div>
          )}

          {/* Design preset */}
          {plan.design_preset && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Design:</span>
              <Badge variant="outline" className="text-[10px]">{plan.design_preset.replace(/_/g, ' ')}</Badge>
            </div>
          )}

          {/* Action buttons */}
          {isProposed && (
            <div className="flex items-center gap-2 pt-1" data-testid="plan-actions">
              <Button
                size="sm"
                onClick={onExecute}
                disabled={executing}
                className="h-8 gap-1.5 em-btn-brand"
                data-testid="plan-execute-btn"
              >
                {executing ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executing...</>
                ) : (
                  <><Play className="w-3.5 h-3.5" /> Execute</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onRevise}
                disabled={executing}
                className="h-8 gap-1.5"
                data-testid="plan-revise-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Revise
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                disabled={executing}
                className="h-8 gap-1.5 text-muted-foreground hover:text-red-400"
                data-testid="plan-cancel-btn"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
