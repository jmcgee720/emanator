'use client'

import { Button } from '@/components/ui/button'
import { Play, RotateCcw, X, Loader2, CheckCircle2 } from 'lucide-react'

export default function PlanCard({ plan, status, onExecute, onRevise, onCancel, executing }) {
  if (!plan) return null

  const isProposed = status === 'proposed'
  const isExecuted = status === 'executed'
  const isCancelled = status === 'cancelled'

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all duration-200 ${
        isExecuted ? 'border-emerald-500/25 bg-emerald-950/8' :
        isCancelled ? 'border-[rgba(124,58,237,0.1)] bg-[rgba(20,20,56,0.3)] opacity-60' :
        'border-[rgba(0,229,255,0.2)] bg-[rgba(0,229,255,0.03)]'
      }`}
      data-testid="plan-card"
    >
      <div className="px-4 py-3 space-y-3">
        {/* Status indicator */}
        <div className="flex items-center gap-2.5">
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
          <span className="text-sm font-medium em-text-primary">
            {isExecuted ? 'Done' : isCancelled ? 'Cancelled' : executing ? 'Working on it...' : 'Ready to build'}
          </span>
        </div>

        {/* Summary — plain language only */}
        <p className="text-sm em-text-secondary leading-relaxed" data-testid="plan-summary">
          {plan.summary}
        </p>

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
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Building...</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> Build it</>
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
              <RotateCcw className="w-3.5 h-3.5" /> Change something
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
    </div>
  )
}
