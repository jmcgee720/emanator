// ══════════════════════════════════════════════════════════════════════
// ── CREATIVE BRIEF PLANNER ──
// Takes a parsed brief + detected archetype and produces a validated
// BuildPlan JSON blob that subsequent build waves consume.
//
// The plan is deterministic in structure (waves/routes) and AI-generated
// only in content (copy, component breakdowns, data shape details). This
// split is intentional — it guarantees archetype-required routes survive
// the LLM call even if the model "forgets" them.
// ══════════════════════════════════════════════════════════════════════

import { ARCHETYPES, mergeArchetypeWithBrief, routeToFile } from './archetypes.js'

/**
 * @typedef {Object} BuildPlan
 * @property {string} archetypeId
 * @property {{name:string,colors:string,tone:string,description:string,audience:string}} brand
 * @property {{id:string,file:string,description:string,heroCopy?:string}[]} routes
 * @property {{name:string,file:string,usedBy:string[],description:string}[]} components
 * @property {{id:string,desc:string}[]} flows
 * @property {{name:string,fields:string[]}[]} dataShapes
 * @property {{id:string,label:string,files:string[]}[]} waves
 */

// ── Deterministic wave ordering ──
// Files land in this order regardless of archetype. Each wave gets the full
// plan + files-built-so-far as context and emits only its subset.
const WAVE_TEMPLATE = [
  {
    id: 'scaffold',
    label: 'Scaffolding (router, auth, mock api, shared UI)',
    // Populated below based on archetype
    includes: ({ plan }) => {
      const base = [
        'app/page.jsx',
        'components/AuthContext.jsx',
        'components/MockAPIProvider.jsx',
        'components/Navbar.jsx',
        'components/Footer.jsx',
        'components/ui/Button.jsx',
        'components/ui/Card.jsx',
        'components/ui/Input.jsx',
      ]
      // landing_only archetype skips Footer? No — always include. Minimal overhead.
      return base.filter((f) => plan.archetypeId === 'landing_only'
        ? !['components/AuthContext.jsx', 'components/MockAPIProvider.jsx'].includes(f)
        : true)
    },
  },
  {
    id: 'public',
    label: 'Public pages (landing, features, pricing, about)',
    includes: ({ plan }) =>
      plan.routes
        .filter((r) => ['landing', 'home', 'features', 'pricing', 'about', 'contact', 'articles', 'article_detail', 'subscribe', 'projects', 'project_detail', 'browse', 'shop', 'product_detail', 'item_detail', 'courses', 'course_detail', 'services', 'search'].includes(r.id))
        .map((r) => r.file),
  },
  {
    id: 'auth',
    label: 'Auth pages (login, signup, forgot, onboarding)',
    includes: ({ plan }) =>
      plan.routes
        .filter((r) => ['login', 'signup', 'forgot_password', 'onboarding'].includes(r.id))
        .map((r) => r.file),
  },
  {
    id: 'app',
    label: 'App pages (dashboard, settings, product-specific)',
    includes: ({ plan }) => {
      const publicIds = new Set(['landing', 'home', 'features', 'pricing', 'about', 'contact', 'articles', 'article_detail', 'subscribe', 'projects', 'project_detail', 'browse', 'shop', 'product_detail', 'item_detail', 'courses', 'course_detail', 'services', 'search'])
      const authIds = new Set(['login', 'signup', 'forgot_password', 'onboarding'])
      return plan.routes
        .filter((r) => !publicIds.has(r.id) && !authIds.has(r.id))
        .map((r) => r.file)
    },
  },
]

/**
 * Build the deterministic wave ordering from a plan.
 * Empty waves are dropped so we don't waste LLM calls.
 */
export function planWaves(plan) {
  return WAVE_TEMPLATE
    .map((tpl) => ({
      id: tpl.id,
      label: tpl.label,
      files: Array.from(new Set(tpl.includes({ plan }))).filter(Boolean),
    }))
    .filter((w) => w.files.length > 0)
}

/**
 * Given a detected archetype + parsed brief fields, ask the LLM to flesh out
 * per-route descriptions, component breakdown, and data shapes. The route
 * LIST itself is NOT AI-generated — we computed it deterministically via
 * mergeArchetypeWithBrief() so archetype-required routes can't be dropped.
 *
 * @param {Object} params
 * @param {Object} params.brief - parsed brief fields (brand, colors, features, pages, etc.)
 * @param {import('./archetypes.js').Archetype} params.archetype
 * @param {{chat: Function}} params.provider - OpenAI-compatible provider
 * @returns {Promise<BuildPlan>}
 */
export async function generatePlan({ brief, archetype, provider }) {
  const { routes: routeIds, flows, dataShapes } = mergeArchetypeWithBrief(
    archetype,
    brief.pagesList || []
  )

  // Build the skeleton routes list the LLM will enrich (never shrink)
  const routeSkeleton = routeIds.map((id) => ({
    id,
    file: routeToFile(id) || `pages/${toPascal(id)}.jsx`,
  }))

  // Ask LLM to enrich each route with description + heroCopy + component list
  const systemPrompt = `You are an app architect. Given a brief + a fixed list of routes that MUST exist, produce a JSON plan describing each route's purpose and the shared components needed.

CRITICAL: Do NOT drop or rename any route in the provided list. Only enrich.
Respond with strict JSON matching this schema:
{
  "routes": [{"id":"<id>","description":"<1 sentence>","heroCopy":"<optional hero headline for landing-type routes>","components":["Navbar","Footer","..."]}],
  "components": [{"name":"<PascalCase>","file":"components/<Name>.jsx","usedBy":["<routeId>"],"description":"<1 sentence>"}],
  "dataShapes": [{"name":"<PascalCase>","fields":["id","name","..."]}]
}

Keep it tight. 6–14 components total. Do not invent routes. Do not invent an API layer (a MockAPIProvider already exists — just list data shapes).`

  const userPrompt = JSON.stringify({
    brand: {
      name: brief.brandName || 'App',
      description: brief.projectDesc || '',
      audience: brief.targetAudience || '',
      tone: brief.toneOfVoice || 'Professional',
      colors: brief.colorDirection || 'Dark mode with accent',
    },
    archetype: archetype.id,
    archetypeNotes: archetype.notes || '',
    routesRequired: routeIds,
    flowsRequired: flows,
    dataShapesRequired: dataShapes,
    userFeatures: brief.featuresList || [],
    userPages: brief.pagesList || [],
  })

  let raw
  try {
    raw = await provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.3, max_tokens: 1800, response_format: { type: 'json_object' } }
    )
  } catch (err) {
    // Fallback: build a minimal plan without enrichment rather than failing the whole build
    raw = '{}'
  }

  let enriched = {}
  try { enriched = JSON.parse(raw) } catch { enriched = {} }

  // Validate & merge: archetype requirements win on conflict
  const enrichedRoutes = Array.isArray(enriched.routes) ? enriched.routes : []
  const routeDescById = Object.fromEntries(enrichedRoutes.map((r) => [r.id, r]))

  const routes = routeSkeleton.map((r) => {
    const e = routeDescById[r.id] || {}
    return {
      id: r.id,
      file: r.file,
      description: typeof e.description === 'string' ? e.description : '',
      heroCopy: typeof e.heroCopy === 'string' ? e.heroCopy : '',
      components: Array.isArray(e.components) ? e.components : [],
    }
  })

  const components = Array.isArray(enriched.components)
    ? enriched.components.filter((c) => c && c.name && c.file)
    : []

  // Guarantee core components always exist in the plan (builder needs them)
  const coreComponents = [
    { name: 'Navbar', file: 'components/Navbar.jsx', usedBy: routes.map((r) => r.id), description: 'Sticky glass navbar with brand logo and primary nav' },
    { name: 'Footer', file: 'components/Footer.jsx', usedBy: routes.map((r) => r.id), description: '4-column footer with brand, product, resources, legal' },
  ]
  if (archetype.id !== 'landing_only') {
    coreComponents.push(
      { name: 'AuthContext', file: 'components/AuthContext.jsx', usedBy: routes.map((r) => r.id), description: 'Mock auth context with localStorage persistence' },
      { name: 'MockAPIProvider', file: 'components/MockAPIProvider.jsx', usedBy: routes.map((r) => r.id), description: 'In-memory CRUD store backed by localStorage, seeded with demo data' }
    )
  }
  for (const core of coreComponents) {
    if (!components.find((c) => c.name === core.name)) components.push(core)
  }

  const finalDataShapes = Array.isArray(enriched.dataShapes) && enriched.dataShapes.length > 0
    ? enriched.dataShapes
    : dataShapes.map((s) => ({ name: s, fields: ['id', 'name', 'createdAt'] }))

  /** @type {BuildPlan} */
  const plan = {
    archetypeId: archetype.id,
    brand: {
      name: brief.brandName || 'App',
      colors: brief.colorDirection || 'Dark mode with accent',
      tone: brief.toneOfVoice || 'Professional',
      description: brief.projectDesc || '',
      audience: brief.targetAudience || '',
    },
    routes,
    components,
    flows,
    dataShapes: finalDataShapes,
    waves: [],
  }
  plan.waves = planWaves(plan)
  return plan
}

/**
 * Validate a plan satisfies archetype requirements.
 * Returns {valid, errors[]}. Caller decides whether to patch or abort.
 */
export function validatePlan(plan) {
  const errors = []
  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['plan is null'] }
  }
  const archetype = ARCHETYPES[plan.archetypeId]
  if (!archetype) return { valid: false, errors: [`unknown archetypeId: ${plan.archetypeId}`] }

  const routeIds = new Set((plan.routes || []).map((r) => r.id))
  for (const required of archetype.requiredRoutes) {
    if (!routeIds.has(required)) errors.push(`missing required route: ${required}`)
  }
  if (!Array.isArray(plan.waves) || plan.waves.length === 0) {
    errors.push('no waves produced — every plan must have at least one build wave')
  }
  if (!plan.brand || !plan.brand.name) {
    errors.push('missing brand.name')
  }
  return { valid: errors.length === 0, errors }
}

function toPascal(s) {
  return String(s || '')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}
