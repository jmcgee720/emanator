'use client'

import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { classifyArchetypeFast, ARCHETYPES } from '@/lib/ai/archetypes'

/**
 * Live archetype hint shown under the brief's elevator-pitch field.
 * - Fires only when the user has typed enough to classify confidently
 * - Shows which archetype was detected and which flows Emanator will auto-build
 * - Becomes a trust/transparency moment before the 90-second build commitment
 */
export default function ArchetypeHint({ brief }) {
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

  const { archetype, confidence } = useMemo(() => {
    if (briefText.length < 40) return { archetype: null, confidence: 0 }
    return classifyArchetypeFast(briefText)
  }, [briefText])

  if (!archetype || confidence < 0.55) return null

  // Grab 3 flow descriptions to show as examples of what'll be auto-built
  const sampleFlows = (archetype.requiredFlows || []).slice(0, 3).map((f) => f.desc)
  const autoRoutes = (archetype.requiredRoutes || [])
    .filter((r) => !['landing', 'home', 'features', 'pricing', 'about', 'contact'].includes(r))
    .slice(0, 4)

  return (
    <div
      className="mt-3 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-indigo-500/[0.05] p-3 transition-opacity"
      data-testid="archetype-hint"
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-xs font-medium text-white/90">
          Looks like a <span className="text-violet-200" data-testid="archetype-hint-label">{archetype.label}</span>
        </span>
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
