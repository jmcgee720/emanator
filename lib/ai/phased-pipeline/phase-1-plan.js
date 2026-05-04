/**
 * Phase 1: Plan
 *
 * Input:   brief text + optional reference images
 * Output:  { archetype, brand, sections[], imageManifest[], files[] }
 *
 * The AI reads the brief and decides:
 *  - What kind of site/app this is (archetype)
 *  - The brand essence (name, voice, mood, audience)
 *  - Which sections the landing/app needs (nav, hero, features, etc.)
 *  - What images it wants generated (role, subject, composition hint)
 *  - Which JSX files to produce (routes + components)
 */
const SYSTEM_PROMPT = `You are a senior product designer + technical architect planning a custom website or app for a real brand. The user submitted a brief — your job is to return a complete, structured plan.

## Your job
Read the brief. Think about what this brand ACTUALLY needs, not what a template provides. Then return a single JSON object in EXACTLY this shape:

{
  "archetype": "one of: landing_only | ecommerce | saas_tool | portfolio | content_site | marketplace | social_app | lms | productivity | media | hospitality",
  "brand": {
    "name": "the brand name (pull from brief or infer)",
    "tagline": "one sentence on what this is",
    "mood": "2-4 adjectives — warm/cozy/earthy | luxurious/editorial | minimal/clean | vibrant/playful | futuristic/tech | organic/natural",
    "audience": "who this is for",
    "tone": "voice to use in copy — e.g. 'warm and direct', 'editorial and elevated', 'technical and precise'"
  },
  "sections": [
    { "id": "nav",        "purpose": "..." },
    { "id": "hero",       "purpose": "..." },
    { "id": "features",   "purpose": "...", "count": 3 },
    { "id": "testimonials","purpose": "...", "count": 3 },
    { "id": "footer",     "purpose": "..." }
    // include 6-10 sections total, customized to THIS brand's needs
  ],
  "imageManifest": [
    { "role": "hero",        "subject": "specific description of what to generate (e.g. 'steaming cup of pour-over coffee on wooden table, morning light'), should visually fit the brand mood" },
    { "role": "feature_1",   "subject": "..." },
    { "role": "feature_2",   "subject": "..." },
    { "role": "testimonial_1","subject": "portrait suitable for customer testimonial" },
    { "role": "about",       "subject": "..." }
    // aim for 6-12 images total
  ],
  "files": [
    "app/page.jsx",
    "components/Nav.jsx",
    "components/Hero.jsx",
    "components/Features.jsx",
    "components/Testimonials.jsx",
    "components/Footer.jsx"
    // include every file that will need to exist
  ]
}

## Rules
- Return ONLY the JSON object. No prose, no markdown.
- Pick sections that fit THIS brand. A coffee shop doesn't need a pricing matrix; a SaaS tool does.
- imageManifest subjects must be concrete and visual — not "a nice image" but "three coffee beans falling in front of a textured beige background, macro shot, morning light".
- At minimum ship: nav, hero, 3 features, footer. Add more as the brand calls for.`

export async function* runPhasePlan(ctx) {
  const { provider, brief, attachments } = ctx
  const phaseStart = Date.now()

  const briefText = formatBriefAsText(brief)
  const refBlock = attachments?.filter((a) => a?.type === 'image' && a?.data)?.length > 0
    ? `\n\nThe user attached ${attachments.filter((a) => a?.type === 'image' && a?.data).length} reference image(s). Use their aesthetic as inspiration for both the imageManifest subjects and the brand mood.`
    : ''

  yield { event: 'status', data: { stage: 'plan', detail: 'Reading brief and planning structure...' } }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: briefText + refBlock },
  ]

  const raw = await provider.chat(messages, {
    temperature: 0.5,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  })

  let plan
  try {
    plan = JSON.parse(raw)
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`Plan JSON parse failed. Raw: ${raw.slice(0, 200)}`)
    plan = JSON.parse(jsonMatch[0])
  }

  if (!plan.archetype || !plan.brand?.name || !Array.isArray(plan.sections) || !Array.isArray(plan.imageManifest) || !Array.isArray(plan.files)) {
    throw new Error(`Plan missing required fields. Got keys: ${Object.keys(plan).join(', ')}`)
  }

  yield {
    event: 'plan_ready',
    data: {
      archetype: plan.archetype,
      brand: plan.brand,
      sectionCount: plan.sections.length,
      imageCount: plan.imageManifest.length,
      fileCount: plan.files.length,
    },
  }

  return { ...plan, _ms: Date.now() - phaseStart }
}

function formatBriefAsText(brief) {
  if (typeof brief === 'string') return `BRIEF:\n${brief}`
  const parts = []
  if (brief.rawMessage) parts.push(`USER MESSAGE:\n${brief.rawMessage}`)
  if (brief.brandName) parts.push(`Brand name: ${brief.brandName}`)
  if (brief.projectDesc) parts.push(`Project description: ${brief.projectDesc}`)
  if (brief.targetAudience) parts.push(`Target audience: ${brief.targetAudience}`)
  if (brief.mustHaveFeatures) parts.push(`Must-have features: ${brief.mustHaveFeatures}`)
  if (brief.pagesNeeded) parts.push(`Pages needed: ${brief.pagesNeeded}`)
  if (brief.colorDirection) parts.push(`Color direction: ${brief.colorDirection}`)
  if (brief.toneOfVoice) parts.push(`Tone: ${brief.toneOfVoice}`)
  if (brief.referencesSites) parts.push(`Reference sites/brands to match in quality: ${brief.referencesSites}`)
  if (brief.thingsToAvoid) parts.push(`Things to avoid: ${brief.thingsToAvoid}`)
  return parts.join('\n\n')
}
