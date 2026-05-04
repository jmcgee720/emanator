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

## ARCHETYPE SELECTION — critical, read carefully
Pick based on the SUBJECT of the business, NOT on the type of document. A "landing page for a coffee shop" is hospitality, NOT landing_only. A "website for a law firm" is content_site, NOT generic saas_tool. Examples:

- "coffee shop", "bakery", "restaurant", "cafe", "B&B", "yoga studio", "spa", "wellness center" → **hospitality**
- "online store", "shop", "boutique", "products for sale", "e-commerce" → **ecommerce**
- "SaaS", "productivity tool", "B2B software", "project management app", "CRM" → **saas_tool**
- "portfolio", "personal site", "freelancer", "designer showcase", "photographer" → **portfolio**
- "blog", "news site", "magazine", "publication", "content hub" → **content_site**
- "marketplace", "two-sided platform", "connect buyers and sellers" → **marketplace**
- "social network", "community platform", "messaging app" → **social_app**
- "online course", "LMS", "training platform", "tutorials" → **lms**
- "task manager", "todo app", "notes app", "calendar tool" (end-consumer, not B2B) → **productivity**
- "video platform", "streaming", "podcast hub", "music" → **media**
- Only use **landing_only** when the user says "just a one-page landing, nothing more"

NEVER default to saas_tool when the subject matter is a physical business (coffee shop, restaurant, etc.). NEVER default to "streamline your workflow / modern workspace" copy unless the archetype is literally saas_tool.

## IMAGE MANIFEST — critical for visual quality
Every image subject MUST contain the actual subject matter of the brand. If the brand is a coffee shop, EVERY image subject must mention coffee, beans, cup, pour-over, latte, cafe interior, barista, etc. If it's a bakery, every image must mention specific baked goods, flour, dough, ovens, pastries. If a plant shop, actual plants by name (monstera, fiddle leaf fig, snake plant, pothos).

Examples of GOOD subjects for "Cozy Coffee":
- "Steaming cup of pour-over coffee on warm wooden table, morning light streaming through window"
- "Freshly roasted whole coffee beans spilling from a canvas bag, macro shot, earthy tones"
- "Neighborhood coffee shop interior with reclaimed wood counters, pendant lights, and chalk menu board"
- "Barista pulling an espresso shot, hands in focus, brass machine gleaming"
- "Glass carafe of cold brew with ice, garnish, deep brown gradient"

Examples of BAD subjects (NEVER use these vague templates):
- "Product shot of an item" (too vague — what item?)
- "Food plated on a dish" (too vague — could be anything)
- "Hero image for the landing page" (too vague)
- "Team member portrait" (acceptable ONLY if paired with a specific role/setting)

Every subject must be 15-30 words and reference the brand subject explicitly.

## Rules
- Return ONLY the JSON object. No prose, no markdown.
- Pick sections that fit THIS brand. A coffee shop doesn't need a pricing matrix; a SaaS tool does.
- At minimum ship: nav, hero, 3 features, footer. Add more as the brand calls for.
- Aim for 6-10 images total (not 12+ — too many to render).`

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
