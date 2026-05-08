/**
 * Phase 3: Design Tokens
 *
 * Input:   plan + brand mood + reference images (if any)
 * Output:  { palette, typography, spacing, imagery, components }
 *
 * The AI picks concrete design system values — palette swatches in
 * Tailwind classes, font pairings, border radii, shadow treatments —
 * that reflect the brand mood. This is the visual DNA of the site.
 */
const SYSTEM_PROMPT = `You are a senior product designer. Given a brand mood and archetype, produce a complete design token set as JSON.

## Output shape
{
  "palette": {
    "pageBg":       "tailwind bg class for the main page background, e.g. 'bg-amber-50'",
    "surface":      "bg class for cards/panels",
    "surfaceAlt":   "bg class for nav/footer/elevated",
    "ink":          "text class for headings",
    "inkMuted":     "text class for body + secondary text",
    "primary":      "bg class for primary CTA",
    "primaryInk":   "text class for text on primary",
    "accent":       "bg class for accent touches",
    "border":       "border class",
    "hex": { "pageBg": "#FFFBEB", "primary": "#9A3412", "ink": "#1C1917", ...  }
  },
  "typography": {
    "displayFamily": "font-family CSS value for h1/h2 — e.g. 'Fraunces, Georgia, serif'",
    "bodyFamily":    "font-family CSS value for body — e.g. 'Inter, system-ui, sans-serif'",
    "displayClass":  "Tailwind class variant if preferred — e.g. 'font-serif' or leave empty",
    "bodyClass":     "e.g. 'font-sans' or empty",
    "heroSize":      "e.g. 'text-6xl md:text-8xl'",
    "h2Size":        "e.g. 'text-4xl md:text-5xl'",
    "bodySize":      "e.g. 'text-base md:text-lg'"
  },
  "radius": {
    "button":        "tailwind rounded class — e.g. 'rounded-full' for warm/playful, 'rounded-md' for minimal, 'rounded-none' for editorial luxury",
    "card":          "e.g. 'rounded-2xl'",
    "image":         "e.g. 'rounded-xl'"
  },
  "shadow": {
    "card":          "tailwind shadow class — e.g. 'shadow-xl shadow-amber-900/10' for warm, 'shadow-md' for minimal",
    "button":        "e.g. 'shadow-lg shadow-orange-900/20'",
    "hoverLift":     "class applied on hover — e.g. 'hover:-translate-y-1 hover:shadow-2xl'"
  },
  "imageryTreatment": "one of: photographic_warm | photographic_editorial | illustrated_playful | minimal_product | technical_abstract",
  "decorations": "what decorative elements fit — one of: paper_grain | gold_rule | none | gradient_orbs | organic_shapes"
}

## Rules — mood-to-tokens mapping
- Warm/cozy/hospitality: bg-amber-50 or bg-stone-100; primary bg-amber-800/900 or bg-stone-900; ink text-stone-900; serif display (Fraunces / Playfair); rounded-2xl; photographic_warm; paper_grain.
- Luxurious/editorial: bg-neutral-950 or bg-black; primary bg-amber-100 or bg-neutral-100; ink text-amber-50; oversized serif display; rounded-none or rounded-sm; photographic_editorial; gold_rule.
- Minimal/productivity: bg-white; primary bg-neutral-900 or bg-emerald-600; ink text-neutral-900; clean sans (Inter); rounded-md; minimal_product; none.
- Vibrant/playful: bg-yellow-50 or bg-pink-50; primary bg-pink-500 or bg-orange-500; ink text-neutral-900; rounded display; rounded-full buttons; illustrated_playful; organic_shapes.
- Futuristic/SaaS/AI: bg-gray-950; primary bg-indigo-600 or gradient; ink text-white; modern sans; rounded-xl; technical_abstract; gradient_orbs.

Return ONLY the JSON. No prose.`

export async function* runPhaseDesignTokens(ctx) {
  const { provider, priorResults } = ctx
  const plan = priorResults.plan
  const phaseStart = Date.now()

  if (!plan) throw new Error('Phase 3 requires phase 1 (plan)')

  yield { event: 'status', data: { stage: 'design_tokens', detail: 'Choosing palette, typography, and visual rhythm...' } }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Brand mood: ${plan.brand.mood}\nArchetype: ${plan.archetype}\nBrand tone: ${plan.brand.tone}\nAudience: ${plan.brand.audience}` },
  ]

  const raw = await provider.chat(messages, {
    temperature: 0.4,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  })

  // Tolerant parser — see lib/ai/safe-json.js.
  const { safeParseJson } = await import('../safe-json.js')
  const parsed = safeParseJson(raw)
  if (!parsed.ok) {
    throw new Error(`Tokens JSON parse failed: ${parsed.error?.message}. Raw start: ${raw.slice(0, 200)}`)
  }
  const tokens = parsed.value

  if (!tokens.palette || !tokens.typography) {
    throw new Error('Design tokens missing palette or typography')
  }

  yield {
    event: 'design_tokens_ready',
    data: {
      paletteHex: tokens.palette.hex,
      display: tokens.typography.displayFamily,
      body: tokens.typography.bodyFamily,
      imagery: tokens.imageryTreatment,
    },
  }

  return { tokens, _ms: Date.now() - phaseStart }
}
