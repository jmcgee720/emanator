'use client'

import { useMemo, useState, useEffect } from 'react'
import { Sparkles, ChevronDown, Zap } from 'lucide-react'
import { classifyArchetypeFast, ARCHETYPES } from '@/lib/ai/archetypes'

/**
 * Live archetype hint with editable picker + telemetry-informed plan preview.
 * - Archetype auto-detected as user types
 * - User can click the chip to override with any of the 17 archetypes
 * - Plan preview shows estimated file count + avg build time for confidence before commit
 */
export default function ArchetypeHint({ brief, onOverride }) {
  const [override, setOverride] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [stats, setStats] = useState(null)

  // Fetch telemetry once so we can enrich the picker + plan preview
  useEffect(() => {
    let cancelled = false
    fetch('/api/stats/build-times')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setStats(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const briefText = useMemo(() => {
    const parts = [
      brief.elevator_pitch,
      brief.primary_goal,
      brief.must_have_features,
      brief.custom_pages,
      (brief.pages || []).join(' '),
    ]
    return parts.filter(Boolean).join(' ').trim()
  }, [brief.elevator_pitch, brief.primary_goal, brief.must_have_features, brief.custom_pages, brief.pages])

  const { archetype: detected, confidence } = useMemo(() => {
    if (briefText.length < 40) return { archetype: null, confidence: 0 }
    return classifyArchetypeFast(briefText)
  }, [briefText])

  const archetype = override ? ARCHETYPES[override] : detected

  if (!archetype || (!override && confidence < 0.55)) return null

  const sampleFlows = (archetype.requiredFlows || []).slice(0, 3).map((f) => f.desc)
  const autoRoutes = (archetype.requiredRoutes || [])
    .filter((r) => !['landing', 'home', 'features', 'pricing', 'about', 'contact'].includes(r))
    .slice(0, 4)

  // Plan preview estimates — informed by telemetry when available
  const archStats = stats?.archetype_stats?.[archetype.id]
  const estimatedFiles = (archetype.requiredRoutes?.length || 0) + 5 // shared components
  const estimatedSeconds = archStats?.avg_seconds || stats?.p50_seconds || 100

  const handlePick = (id) => {
    setOverride(id)
    setPickerOpen(false)
    onOverride?.(id)
  }

  return (
    <div
      className="mt-3 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-indigo-500/[0.05] p-3 transition-opacity"
      data-testid="archetype-hint"
    >
      <div className="flex items-center gap-2 mb-2 relative">
        <Sparkles className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
        <span className="text-xs font-medium text-white/90 flex-1">
          Looks like a{' '}
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            data-testid="archetype-hint-chip"
            className="inline-flex items-center gap-1 text-violet-200 underline-offset-2 decoration-dotted hover:underline"
          >
            <span data-testid="archetype-hint-label">{archetype.label}</span>
            <ChevronDown className="w-3 h-3 opacity-70" />
          </button>
        </span>
        {override ? (
          <button
            type="button"
            onClick={() => { setOverride(null); onOverride?.(null) }}
            className="text-[10px] text-white/40 hover:text-white/80"
            data-testid="archetype-hint-reset"
          >
            Reset to auto
          </button>
        ) : null}
        {pickerOpen ? (
          <div
            className="absolute top-6 left-4 z-30 w-72 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-2xl p-1"
            data-testid="archetype-hint-picker"
          >
            {Object.values(ARCHETYPES).map((a) => {
              const s = stats?.archetype_stats?.[a.id]
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handlePick(a.id)}
                  className={'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-start justify-between gap-2 ' + (a.id === archetype.id ? 'bg-violet-500/20 text-violet-100' : 'text-white/70 hover:bg-white/5')}
                  data-testid={'archetype-picker-' + a.id}
                >
                  <span className="flex-1">{a.label}</span>
                  {s && s.total >= 3 ? (
                    <span
                      className={'text-[10px] font-medium px-1.5 py-0.5 rounded-md flex-shrink-0 ' + (s.success_rate >= 80 ? 'bg-emerald-500/15 text-emerald-300' : s.success_rate >= 50 ? 'bg-amber-500/15 text-amber-300' : 'bg-white/5 text-white/40')}
                      data-testid={'archetype-picker-badge-' + a.id}
                      title={`${s.total} builds · ${s.success_rate}% success · avg ${s.avg_seconds || '—'}s`}
                    >
                      {s.total} · {s.success_rate}%
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/30 flex-shrink-0" data-testid={'archetype-picker-new-' + a.id}>New</span>
                  )}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      {autoRoutes.length > 0 ? (
        <p className="text-[11px] text-white/55 leading-relaxed">
          Emanator will auto-build{' '}
          <span className="text-white/80" data-testid="archetype-hint-auto-routes">
            {autoRoutes.join(' · ')}
          </span>{' '}
          even if you don't list them.
        </p>
      ) : null}
      {sampleFlows.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-white/50">
          {sampleFlows.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-0.5 w-1 h-1 rounded-full bg-violet-400/60 flex-shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Telemetry-informed plan preview */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-3 text-[11px]" data-testid="archetype-plan-preview">
        <div className="flex items-center gap-1.5 text-white/60">
          <Zap className="w-3 h-3 text-violet-300" />
          <span>Plan preview:</span>
        </div>
        <span className="text-white/80" data-testid="plan-preview-files">~{estimatedFiles} files</span>
        <span className="text-white/30">·</span>
        <span className="text-white/80" data-testid="plan-preview-time">~{estimatedSeconds}s to build</span>
        {archStats && archStats.total >= 3 ? (
          <span className="text-white/30">·</span>
        ) : null}
        {archStats && archStats.total >= 3 ? (
          <span className={archStats.success_rate >= 80 ? 'text-emerald-400' : archStats.success_rate >= 50 ? 'text-amber-400' : 'text-white/50'} data-testid="plan-preview-success">
            {archStats.success_rate}% success across {archStats.total} builds
          </span>
        ) : null}
      </div>
    </div>
  )
}
