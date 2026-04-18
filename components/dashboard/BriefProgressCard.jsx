'use client'

/**
 * BriefProgressCard — live-updating progress display for the new brief pipeline.
 * Shows archetype detection, plan summary, per-wave status, and review/repair outcome.
 *
 * Rendered in LeftPanel.jsx when message.metadata.briefProgress is present.
 */
import { Sparkles, Loader2, CheckCircle2, AlertCircle, Wrench } from 'lucide-react'

const WAVE_STATUS_ICON = {
  pending: <span className="w-3.5 h-3.5 rounded-full border border-white/20 bg-white/5" />,
  running: <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />,
  complete: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  error: <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
}

export default function BriefProgressCard({ progress }) {
  if (!progress) return null
  const { archetype, plan, waves, review, repair, status } = progress

  const waveList = waves || []
  const totalFilesBuilt = waveList.reduce((n, w) => n + (w.filesBuilt?.length || 0), 0)
  const plannedFileCount = plan?.waves?.reduce((n, w) => n + (w.files?.length || 0), 0) || 0

  // Rough estimate: scaffold ~12s, each other wave ~15–25s, review+repair ~10s
  const remainingWaves = waveList.filter((w) => w.status !== 'complete' && w.status !== 'error').length
  const estimatedSecondsRemaining = remainingWaves * 18 + (status === 'reviewing' || status === 'repairing' ? 10 : 0)

  return (
    <div
      className="mt-2 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 backdrop-blur-sm p-4"
      data-testid="brief-progress-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-medium text-white/90">
          {status === 'classifying' && 'Identifying archetype…'}
          {status === 'planning' && 'Planning app structure…'}
          {status === 'building' && `Building ${plan?.brand?.name || 'app'}`}
          {status === 'reviewing' && 'Reviewing for missing flows…'}
          {status === 'repairing' && 'Auto-repairing gaps…'}
          {status === 'complete' && `Built ${plan?.brand?.name || 'app'} — ${totalFilesBuilt} files`}
        </span>
        {status !== 'complete' && status !== 'error' && estimatedSecondsRemaining > 0 ? (
          <span className="ml-auto text-[10px] text-white/40">~{estimatedSecondsRemaining}s remaining</span>
        ) : null}
      </div>

      {/* Archetype badge */}
      {archetype ? (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200" data-testid="archetype-badge">
            {archetype.label || archetype.id}
          </span>
          <span className="text-white/40">•</span>
          <span className="text-white/50">{plan?.routes?.length || 0} routes</span>
          <span className="text-white/40">•</span>
          <span className="text-white/50">{plannedFileCount || '…'} files</span>
        </div>
      ) : null}

      {/* Wave list */}
      {waveList.length > 0 ? (
        <div className="space-y-1.5" data-testid="wave-list">
          {waveList.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-xs" data-testid={`wave-row-${w.id}`}>
              {WAVE_STATUS_ICON[w.status] || WAVE_STATUS_ICON.pending}
              <span className={w.status === 'complete' ? 'text-white/80' : w.status === 'running' ? 'text-white' : 'text-white/50'}>
                {w.label || w.id}
              </span>
              {w.status === 'complete' && w.filesBuilt?.length > 0 ? (
                <span className="ml-auto text-[10px] text-white/40">{w.filesBuilt.length} file{w.filesBuilt.length === 1 ? '' : 's'}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Review/repair status */}
      {review ? (
        <div className="mt-3 pt-3 border-t border-white/5">
          {review.ok ? (
            <div className="flex items-center gap-2 text-xs text-emerald-400" data-testid="review-ok">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Review passed — all flows wired</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-amber-300" data-testid="review-gaps">
              <Wrench className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <div>Found {review.missing.length + review.broken.length} gap(s)</div>
                {repair ? (
                  <div className="text-emerald-400 mt-1">Repaired {repair.filesRepaired?.length || 0} file(s)</div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
