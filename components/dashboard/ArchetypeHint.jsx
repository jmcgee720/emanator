'use client'

import { useMemo, useState } from 'react'
import { Sparkles, ChevronDown } from 'lucide-react'
import { classifyArchetypeFast, ARCHETYPES } from '@/lib/ai/archetypes'

/**
 * Live archetype hint shown under the brief's elevator-pitch field.
 * - Fires only when the user has typed enough to classify confidently
 * - Shows which archetype was detected and which flows Emanator will auto-build
 * - User can click the chip to override with a different archetype from the picker
 */
export default function ArchetypeHint({ brief, onOverride }) {
  const [override, setOverride] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

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
            className="absolute top-6 left-4 z-30 w-64 max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-black/90 backdrop-blur-xl shadow-2xl p-1"
            data-testid="archetype-hint-picker"
          >
            {Object.values(ARCHETYPES).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => handlePick(a.id)}
                className={'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ' + (a.id === archetype.id ? 'bg-violet-500/20 text-violet-100' : 'text-white/70 hover:bg-white/5')}
                data-testid={'archetype-picker-' + a.id}
              >
                {a.label}
              </button>
            ))}
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
    </div>
  )
}
