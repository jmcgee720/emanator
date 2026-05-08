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
  "archetype": "one of: landing_only | ecommerce | saas_tool | portfolio | content_site | marketplace | social_app | lms | productivity | media | hospitality | fullstack_app",
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
  ],
  "dataModel": {
    // ONLY include this block when archetype === "fullstack_app".
    // Omit (or set to null) for landing/marketing/portfolio archetypes.
    "entities": [
      {
        "name": "Task",
        "fields": ["id:uuid", "title:string", "completed:bool", "dueAt:date", "userId:uuid"],
        "endpoints": ["GET /api/tasks", "POST /api/tasks", "PATCH /api/tasks/[id]", "DELETE /api/tasks/[id]"]
      }
    ],
    "auth": "none | jwt | supabase | clerk",
    "storage": "mongodb | supabase | none"
  }
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
- **fullstack_app** — pick this when the brief describes something with REAL DATA persistence, USER ACCOUNTS, or CRUD across resources. Signals: "users sign up", "save/store/track", "dashboard", "account", "login", "members", "API", "database", "backend", "Postgres/Mongo/Supabase", "auth". Examples that ARE fullstack_app:
  - "a habit tracker app where users log daily streaks"
  - "a Reddit-style community where people post links and comment"
  - "an AI prompt library users can save and share"
  - "a CRM for solo realtors"
  - "a meal planner that saves my grocery lists"
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
- Aim for 6-10 images total (not 12+ — too many to render).

## Fullstack-app rules (ONLY when archetype === "fullstack_app")
- The "files" array MUST include API routes for every entity:
    "app/api/<entity>/route.js"  (collection: GET list + POST create)
    "app/api/<entity>/[id]/route.js" (single: GET/PATCH/DELETE one)
- Plus: "lib/db.js" (Supabase client), "lib/auth.js" if auth is needed,
  and a "app/dashboard/page.jsx" route the logged-in user lands on.
- Set dataModel.storage = "supabase" by default (we provide the keys).
  Set dataModel.auth = "supabase" if the brief mentions sign-in / accounts,
  otherwise "none".
- Keep entity count tight: 1-3 entities. Anything more is a sign you're
  over-engineering — let the user iterate via chat once the bones work.`

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

  // Token budget needs to accommodate fullstack_app plans which include
  // a dataModel block with entities + endpoints. We saw real Claude
  // outputs hit ~10k chars (~2.7k tokens) and get truncated mid-array
  // at 3000 max_tokens. 8000 gives ~3× headroom.
  const { safeParseJson } = await import('../safe-json.js')
  let raw = await provider.chat(messages, {
    temperature: 0.5,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  })

  let parsed = safeParseJson(raw)

  // If even the tolerant parser failed, hit the LLM ONCE more with a
  // surgical "fix this JSON" prompt. Cheap insurance vs the wizard
  // showing the user a parse error and forcing a full Retry.
  if (!parsed.ok) {
    console.warn('[Phase1Plan] initial JSON parse failed; retrying with fixer prompt:', parsed.attempts)
    yield { event: 'status', data: { stage: 'plan', detail: 'Cleaning up the plan JSON...' } }
    const fixerMessages = [
      {
        role: 'system',
        content: 'You return ONLY valid JSON, no prose, no markdown. The user will paste a near-valid JSON document — fix any syntax errors (truncation, comments, trailing commas) and return the COMPLETE, valid JSON object.',
      },
      {
        role: 'user',
        content: `Fix this JSON and return the complete, valid object. Match the original structure exactly:\n\n${raw.slice(0, 12000)}`,
      },
    ]
    try {
      raw = await provider.chat(fixerMessages, {
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      })
      parsed = safeParseJson(raw)
    } catch (err) {
      console.warn('[Phase1Plan] fixer request failed:', err.message)
    }
  }

  if (!parsed.ok) {
    throw new Error(`Plan JSON parse failed after fixer retry: ${parsed.error?.message || 'unknown'}. Raw start: ${raw.slice(0, 200)}`)
  }
  const plan = parsed.value

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
