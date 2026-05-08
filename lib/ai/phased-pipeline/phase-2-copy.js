/**
 * Phase 2: Copy
 *
 * Input:   plan (from phase 1) + brand + brief
 * Output:  { copy: { nav, hero, features, testimonials, footer, ... } }
 *
 * The AI writes all written content for the site. Real, specific,
 * on-brand copy — never Lorem ipsum, never generic "streamline workflows".
 */
const SYSTEM_PROMPT = `You are a senior brand copywriter. Given a plan for a site, write ALL the written content — every headline, subhead, button label, feature description, testimonial, and footer text — in the EXACT voice of this brand.

## Output shape
Return a single JSON object where each key is a section.id from the plan, and the value contains that section's copy. Shape:

{
  "nav":        { "logoText": "...", "links": [{"label":"...","href":"/"}, ...], "cta": "..." },
  "hero":       { "badge": "optional small pill text", "headline": "...", "subheadline": "...", "primaryCta": "...", "secondaryCta": "..." },
  "features":   [ { "icon": "coffee|check|heart|etc", "title": "...", "description": "..." }, ... ],
  "testimonials":[ { "quote": "...", "author": "Sarah K.", "role": "Regular since 2019" }, ... ],
  "stats":      [ { "value": "40+", "label": "partner farms" }, ... ],
  "footer":     { "tagline": "...", "columns": [{"heading":"...","links":[...]}, ...], "legal": "© 2026 ..." }
  // include every section.id from the plan with appropriate shape
}

## Rules
- Every word must be in the brand voice (plan.brand.tone).
- Make up SPECIFIC realistic names (testimonial authors, farm names, product names, stats). "Sarah K., regular since 2019" not "Customer Name".
- Stats must be believable numbers for the brand size.
- NEVER use: "streamline your workflow", "boost productivity", "Lorem ipsum", "the modern workspace", "welcome to our platform", "revolutionize", or any other SaaS cliche unless the brand is literally a productivity SaaS tool.
- CTAs match brand action: for a coffee shop use "Shop our beans" / "Visit our cafe"; for a SaaS tool use "Start free trial" / "Book a demo".
- Return ONLY the JSON object. No prose, no markdown.`

export async function* runPhaseCopy(ctx) {
  const { provider, priorResults } = ctx
  const plan = priorResults.plan
  const phaseStart = Date.now()

  if (!plan) throw new Error('Phase 2 (copy) requires phase 1 (plan) output')

  yield { event: 'status', data: { stage: 'copy', detail: `Writing copy for ${plan.brand.name}...` } }

  const contextBlock = `
BRAND:
${JSON.stringify(plan.brand, null, 2)}

SECTIONS TO WRITE COPY FOR:
${plan.sections.map((s) => `- ${s.id}: ${s.purpose}${s.count ? ` (${s.count} items)` : ''}`).join('\n')}

ARCHETYPE: ${plan.archetype}
`

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contextBlock },
  ]

  const raw = await provider.chat(messages, {
    temperature: 0.8,
    max_tokens: 6000,
    response_format: { type: 'json_object' },
  })

  // Tolerant parser handles truncation, comments, trailing commas, smart
  // quotes, code-fence wrappers — see lib/ai/safe-json.js.
  const { safeParseJson } = await import('../safe-json.js')
  const parsed = safeParseJson(raw)
  if (!parsed.ok) {
    throw new Error(`Copy JSON parse failed: ${parsed.error?.message}. Raw start: ${raw.slice(0, 200)}`)
  }
  const copy = parsed.value

  yield { event: 'copy_ready', data: { sections: Object.keys(copy) } }

  return { copy, _ms: Date.now() - phaseStart }
}
