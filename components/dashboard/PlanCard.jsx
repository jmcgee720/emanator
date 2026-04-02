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
      className={`em-panel-enter rounded-xl border overflow-hidden transition-all duration-200 ${
        isExecuted ? 'border-emerald-500/25 bg-emerald-950/8' :
        isCancelled ? 'border-[rgba(124,58,237,0.1)] bg-[rgba(20,20,56,0.3)] opacity-60' :
        'border-[rgba(0,229,255,0.2)] bg-[rgba(0,229,255,0.03)]'
      }`}
      data-testid="plan-card"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[rgba(0,229,255,0.02)] transition-colors duration-150"
        onClick={() => setExpanded(e => !e)}
        data-testid="plan-card-header"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isExecuted ? 'bg-emerald-500/15' : isCancelled ? 'bg-[rgba(20,20,56,0.5)]' : 'bg-[rgba(0,229,255,0.12)]'
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
              <span className="text-sm font-medium em-text-primary truncate">
                {isExecuted ? 'Plan Executed' : isCancelled ? 'Plan Cancelled' : 'Implementation Plan'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {creates.length > 0 && <span className="text-[10px] text-emerald-400">{creates.length} create</span>}
              {updates.length > 0 && <span className="text-[10px] text-blue-400">{updates.length} update</span>}
              {deletes.length > 0 && <span className="text-[10px] text-red-400">{deletes.length} delete</span>}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 em-text-muted flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 em-text-muted flex-shrink-0" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[rgba(124,58,237,0.1)] px-4 py-3 space-y-3">
          {/* Summary */}
          <p className="text-sm em-text-secondary leading-relaxed">{plan.summary}</p>

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
                        <p className="text-[11px] em-text-muted mt-0.5 leading-snug">{action.reason}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Reasoning */}
          {Array.isArray(plan.reasoning) && plan.reasoning.length > 0 ? (
            <div className="text-xs em-text-muted bg-[rgba(20,20,56,0.5)] rounded-xl px-3 py-2 leading-relaxed space-y-1">
              {plan.reasoning.map((step, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="text-[var(--em-text-muted)] flex-shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          ) : plan.reasoning ? (
            <div className="text-xs em-text-muted bg-[rgba(20,20,56,0.5)] rounded-xl px-3 py-2 leading-relaxed">
              {plan.reasoning}
            </div>
          ) : null}

          {/* Design preset */}
          {plan.design_preset && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] em-text-muted">Design:</span>
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
                className="h-8 gap-1.5 em-text-muted hover:text-red-400 transition-colors duration-150"
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
