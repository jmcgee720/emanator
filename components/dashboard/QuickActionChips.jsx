'use client'

import { Palette, Plus, Smartphone, Type, Wand2, Trash2 } from 'lucide-react'

/**
 * Quick-action chips rendered just above the ChatComposer on existing projects.
 *
 * Clicking a chip pre-populates the composer with a helpful prompt so the user
 * can iterate quickly without typing boilerplate.
 *
 * Chips are context-aware — they differ slightly based on the project's
 * archetype (SaaS vs portfolio vs landing page, etc.).
 */

export const GENERIC_ACTIONS = [
  {
    id: 'change-color',
    icon: Palette,
    label: 'Change color',
    prompt: 'Change the primary accent color to ',
    hint: '(e.g. a deep violet #6d28d9)',
  },
  {
    id: 'add-page',
    icon: Plus,
    label: 'Add a page',
    prompt: 'Add a new page called ',
    hint: '(e.g. "Blog" with a list of posts and a detail view)',
  },
  {
    id: 'mobile-pass',
    icon: Smartphone,
    label: 'Mobile-friendlier',
    prompt: "Do a mobile responsive pass — make sure the navbar collapses, hero text scales down, and grids stack on small screens.",
  },
  {
    id: 'copy-rewrite',
    icon: Type,
    label: 'Rewrite copy',
    prompt: 'Rewrite the headline and subheader on the landing page to be more ',
    hint: '(e.g. punchy, playful, serious, technical)',
  },
  {
    id: 'tighten-ui',
    icon: Wand2,
    label: 'Polish UI',
    prompt: 'Tighten the visual design — review spacing, typography hierarchy, hover states, and button affordances across all pages. Make it feel more premium.',
  },
]

export const ARCHETYPE_ACTIONS = {
  saas_tool: [
    { id: 'add-feature', icon: Plus, label: 'Add a feature', prompt: 'Add a new feature to the dashboard: ', hint: '(describe the feature briefly)' },
  ],
  portfolio: [
    { id: 'add-project', icon: Plus, label: 'Add project', prompt: 'Add a new portfolio project called ', hint: '(e.g. "Acme redesign", brief description, 2-3 tags)' },
  ],
  ai_app: [
    { id: 'new-prompt', icon: Wand2, label: 'Tune prompt', prompt: 'Tune the AI prompt on the main screen so the output is more ', hint: '(e.g. concise, formal, actionable)' },
  ],
  ecommerce: [
    { id: 'add-product', icon: Plus, label: 'Add product', prompt: 'Add a new product: ', hint: '(name, price, one-line description)' },
  ],
  marketplace: [
    { id: 'add-listing', icon: Plus, label: 'Add listing type', prompt: 'Add a new listing category called ', hint: '(e.g. "Workshops" with bookable time slots)' },
  ],
  social_app: [
    { id: 'add-interaction', icon: Plus, label: 'Add interaction', prompt: 'Add a new interaction type: ', hint: '(e.g. reactions with emoji picker)' },
  ],
}

export default function QuickActionChips({ archetypeId, onChoose }) {
  if (typeof onChoose !== 'function') return null

  const archetypeExtras = ARCHETYPE_ACTIONS[archetypeId] || []
  const chips = [...archetypeExtras, ...GENERIC_ACTIONS].slice(0, 6)

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap px-4 pt-2 pb-1"
      role="group"
      aria-label="Quick edit actions"
      data-testid="quick-action-chips"
    >
      <span className="text-[10px] em-text-muted mr-1">Quick edits:</span>
      {chips.map((chip) => {
        const Icon = chip.icon
        return (
          <button
            key={chip.id}
            onClick={() => onChoose(chip.prompt, { hint: chip.hint, id: chip.id })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] em-text-secondary hover:bg-[rgba(0,229,255,0.08)] hover:text-[var(--em-cyan)] hover:border-[rgba(0,229,255,0.25)] transition-colors text-[10px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40"
            data-testid={`quick-action-${chip.id}`}
            type="button"
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
