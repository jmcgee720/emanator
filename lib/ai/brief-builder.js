// ══════════════════════════════════════════════════════════════════════
// ── CREATIVE BRIEF BUILDER ──
// Executes a single build wave from a validated BuildPlan.
// Each wave is one LLM call that emits ONLY its subset of files via a
// forced `create_files` tool call. Recipes relevant to the wave are
// injected as reference code the model adapts to the brand.
// ══════════════════════════════════════════════════════════════════════

import { AI_TOOLS } from './tools.js'
import { recipesForWave, formatRecipesForPrompt } from './recipes.js'
import { normalizeFiles } from './brief-utils.js'
import { formatTokensForPrompt } from './design-tokens.js'

const CREATE_TOOLS = AI_TOOLS.filter((t) => ['create_files', 'update_files'].includes(t.function?.name))

/**
 * Build the system prompt for a single wave.
 * Shared constraints + wave-specific recipes + plan summary.
 * Exported for test coverage of the hard-rule enforcement.
 */
export function buildWaveSystemPrompt({ plan, wave, filesBuiltSoFar }) {
  const useSupabase = !!plan.useSupabase
  const useStripe = !!plan.useStripe
  const recipeIds = recipesForWave(wave.id, plan.archetypeId, { useSupabase, useStripe })
  const recipeBlock = formatRecipesForPrompt(recipeIds)

  const builtSummary = filesBuiltSoFar.length > 0
    ? filesBuiltSoFar.map((f) => `- ${f.path} (${f.size || 0}b)`).join('\n')
    : '(none — this is the first wave)'

  const routeSummary = plan.routes
    .map((r) => `- ${r.id} → ${r.file}${r.description ? ': ' + r.description : ''}`)
    .join('\n')

  const flowSummary = plan.flows.map((f) => `- ${f.id}: ${f.desc}`).join('\n')

  return `You are building ONE wave of a multi-wave app generation for "${plan.brand.name}".

═══ BRAND ═══
Name: ${plan.brand.name}
Description: ${plan.brand.description || '(none)'}
Audience: ${plan.brand.audience || '(none)'}
Tone: ${plan.brand.tone}
Colors: ${plan.brand.colors}
${plan.artDirection ? '\n═══ ART DIRECTION (derived from user reference images — FOLLOW THIS AESTHETIC) ═══\n' + plan.artDirection + '\n' : ''}${plan.designTokens ? '\n═══ DESIGN TOKENS (extracted from references — ALREADY WRITTEN TO components/theme.js) ═══\n' + formatTokensForPrompt(plan.designTokens) + '\n\nEVERY recipe has ALREADY been updated to consume these tokens via CSS variables — do NOT hardcode hex colors or Tailwind color classes. Use ONLY:\n  - bg-[var(--bg)]       — page background\n  - bg-[var(--surface)]  — cards, panels, input fields\n  - bg-[var(--surface-2)]— navbar, footer, elevated surfaces\n  - bg-[var(--primary)]  — primary CTAs (NEVER bg-white or bg-violet-500)\n  - bg-[var(--accent)]   — decorative accents\n  - text-[var(--ink)]    — headlines, body text\n  - text-[var(--ink-muted)] — secondary text, placeholders\n  - text-[var(--primary-ink)] — text sitting on bg-[var(--primary)]\n  - border-[var(--border)]    — all borders\n  - rounded-[var(--radius)]   — buttons, inputs, small cards\n  - rounded-[var(--radius-lg)] — hero, feature cards\n  - style={{ fontFamily: \'var(--font-display)\' }} on h1/h2 headings\n  - style={{ fontFamily: \'var(--font-body)\' }}    on body text (inherited from ThemeProvider)\n\nThe ThemeProvider is already applied in app/page.jsx — you don\'t need to import it in individual pages. Just reference the CSS variables directly in your className.\n' : ''}${(plan.imageAssets && plan.imageAssets.length > 0) ? '\n═══ USER-PROVIDED IMAGE ASSETS (USE THESE — DO NOT REPLACE WITH PLACEHOLDERS) ═══\nA file `components/assets.js` HAS BEEN CREATED FOR YOU with the user\'s uploaded images as data URLs. Reference them via:\n  import { LOGO_URL, HERO_URL, REFERENCE_0 } from \'../components/assets\'\n\nAvailable exports from assets.js:\n' + plan.imageAssets.map((a) => {
  const exportName = a.role === 'logo' ? 'LOGO_URL' : a.role === 'hero' ? 'HERO_URL' : `REFERENCE_${a.index}`
  return `  - ${exportName}  (role: ${a.role}, original name: "${a.name}")`
}).join('\n') + '\n\nCRITICAL RULES FOR USING THESE ASSETS:\n1. If a LOGO_URL export exists, the Navbar MUST render <img src={LOGO_URL} alt="..." className="h-8 w-auto" /> INSTEAD of the default gradient square placeholder.\n2. If a HERO_URL export exists, the landing hero section MUST render <img src={HERO_URL} alt="..." /> INSTEAD of the default gradient rectangle.\n3. NEVER leave the gradient-square placeholders from the recipes in place when a matching asset is available.\n4. Always import from `../components/assets` — the file is pre-generated for you.\n' : ''}${useSupabase ? '\n═══ BACKEND ═══\nThis project is wired to a real Supabase backend. The scaffold recipes use `./supabaseClient` for real auth and CRUD calls; they fall back to localStorage when the client is unavailable (preview). Do NOT invent your own auth or storage — always route through `useAuth()` and `useMockAPI()` exactly as the Supabase-wired recipes define.\n' : ''}${useStripe ? '\n═══ PAYMENTS ═══\nThis project is wired to Stripe Checkout. The pricing page uses `stripe_pricing_3tier` — each tier has a `priceId` and the Subscribe button POSTs to `/api/stripe/checkout`. The user must supply a server-side endpoint (Supabase Edge Function, Vercel Function, etc.) that creates a Checkout session and returns { id } or { url }. Preview falls back to the signup route. Do NOT invent checkout logic — adapt the recipe\'s price tiers to the brand but keep the priceId + fetch contract intact.\n' : ''}

═══ FULL APP PLAN (context — do not duplicate files from other waves) ═══
Archetype: ${plan.archetypeId}
Routes:
${routeSummary}

Required flows (MUST be wired by end of build):
${flowSummary}

Data shapes (for MockAPIProvider seeding):
${plan.dataShapes.map((s) => `- ${s.name}: {${(s.fields || []).join(', ')}}`).join('\n')}

═══ FILES ALREADY BUILT IN PREVIOUS WAVES ═══
${builtSummary}

═══ THIS WAVE: ${wave.label} ═══
Produce EXACTLY these files, no more, no less:
${wave.files.map((f) => `- ${f}`).join('\n')}

═══ HARD RULES ═══
1. Multi-file output. Each file above is a SEPARATE file in the create_files array.
2. No \`import React\`. React is global. All hooks (useState, useContext, useEffect, useMemo, useRef, createContext) are global.
3. Local imports use relative paths: \`import Navbar from '../components/Navbar'\`. No react-router.
4. Tailwind classes only. Inline SVGs only. No external icon packages, no image URLs.
5. Every interactive element has a \`data-testid\`.
6. Auth goes through \`useAuth()\` from \`../components/AuthContext\`. Persistence goes through \`useMockAPI()\` from \`../components/MockAPIProvider\`. Never invent your own auth/storage.
7. Every button/link that represents navigation MUST have \`onClick={() => onNavigate('<routeId>')}\`. Routes MUST match the plan's route ids above.
8. Forms actually submit — they update state via useAuth/useMockAPI and navigate on success.
9. NEVER use "Feature 1", "Item 1", "Lorem ipsum", "Welcome to our platform", "The best solution for X", "Get started today", or any other generic SaaS placeholder. EVERY headline, subhead, feature card, CTA label, and empty-state message MUST be specific to this brand's description + audience. If the brief says "Sustainable shoe marketplace for Gen-Z", the hero MUST name shoes, sustainability, and Gen-Z shoppers explicitly — not "Discover amazing products". Treat the brand description as the source of truth and speak in the brand's declared tone.
10. Call create_files immediately. No explanatory prose.
11. ★ EXACT SYMBOL NAMES — copy these from the recipes verbatim. Do NOT rename:
    - \`useAuth\` returns { user, signup, login, logout, isAuthenticated } — lowercase \`signup\` and \`login\`, NOT \`signUp\` or \`signIn\`.
    - \`useMockAPI\` returns { list, get, create, patch, remove } — these names exactly.
    - \`AuthProvider\` and \`MockAPIProvider\` are the default exports — use these names.
    - Route ids are snake_case / one-word: \`signup\`, \`login\`, \`forgot_password\`, \`dashboard\`, etc. NEVER \`signUp\`, \`signIn\`, \`forgotPassword\`.
    - If you deviate from any of these names, the app breaks because AuthContext.jsx and MockAPIProvider.jsx export with the exact names above.
12. ★ MANDATORY IMPORTS — every page/component file that uses \`useAuth\` MUST start with:
    \`import { useAuth } from '../components/AuthContext'\`
    Every file that uses \`useMockAPI\` MUST start with:
    \`import { useMockAPI } from '../components/MockAPIProvider'\`
    Shared components follow the same pattern: \`import Navbar from '../components/Navbar'\`, etc.
    NEVER reference a hook or component without its import statement at the top of the file.
13. ★ ACCESSIBILITY BASELINE — every form input MUST have a matching \`<label htmlFor="id">\` whose \`htmlFor\` matches the input's \`id\`. Email inputs get \`autoComplete="email"\`, password inputs get \`autoComplete="current-password"\` (login) or \`"new-password"\` (signup). Error messages use \`role="alert"\` and \`aria-live="polite"\`. Nav landmarks use \`<nav aria-label="...">\`. The main content area uses \`<main>\`. Interactive elements get \`focus-visible:ring-2 focus-visible:ring-white/50\`. Decorative SVGs/icons get \`aria-hidden="true"\`.
14. ★ RESPONSIVE BASELINE — every multi-column grid uses responsive classes like \`grid-cols-1 md:grid-cols-2 lg:grid-cols-3\` (never fixed \`grid-cols-3\` alone). Hero headlines use responsive sizing like \`text-3xl md:text-5xl lg:text-6xl\`. Navbars hide secondary links below \`md:\` or provide a mobile menu toggle. Containers use \`max-w-*\` rather than fixed pixel widths. NEVER ship a page with fixed widths or unbreakable horizontal layouts.
15. ★ ROUTER CLEANLINESS — \`app/page.jsx\` (the App router) MUST render ONLY the current route component inside a \`<div className="min-h-screen">\` wrapper (plus Providers). It MUST NOT render \`<Navbar />\`, \`<Footer />\`, or any shared layout elements directly. Every individual page component (Landing, Signup, Login, Dashboard, etc.) is responsible for rendering its own Navbar + Footer. Rendering Navbar in the router causes DUPLICATE navbars — do not do this under any circumstances.
16. ★ USE PROVIDED IMAGE ASSETS — if the context above mentions \`components/assets.js\` with LOGO_URL / HERO_URL / REFERENCE_* exports, you MUST import and render those images. Replace the recipe's default gradient-square placeholder with the real logo/image. NEVER leave a placeholder when a real asset exists.
17. ★ BRAND COPY DISCIPLINE — on the landing page specifically:
    - The H1 hero headline MUST reference the brand's core value in the brand's own tone (not "Welcome to ${plan.brand.name}").
    - The subhead MUST paraphrase the brand description and name the target audience ("${plan.brand.audience || 'our audience'}") explicitly.
    - Feature cards MUST describe concrete capabilities the app actually delivers for this archetype — not generic "Fast / Secure / Scalable" bullets.
    - CTAs MUST use verbs tied to the domain (e.g. "Start listing shoes", "Find your next hire", "Plan my trip") — NOT "Get Started".
    - Testimonials, if any, MUST sound like real user sentences tied to the audience, never "This product changed my life. — Sarah, CEO".
18. ★ THEME-TOKEN DISCIPLINE — NEVER hardcode colors. Banned patterns: \`text-white\`, \`text-black\`, \`bg-white\`, \`bg-black\`, \`from-violet-500\`, \`to-indigo-500\`, \`border-white/10\`, \`bg-gray-900\`, hex codes in className, or any \`bg-<color>-<shade>\` Tailwind utility for brand-facing UI. Use ONLY the arbitrary-value CSS-variable form: \`bg-[var(--primary)]\`, \`text-[var(--ink)]\`, \`border-[var(--border)]\`, \`rounded-[var(--radius)]\`, etc. The tokens already encode the user's chosen palette — hardcoding colors erases their reference. This applies to EVERY file you emit in this wave.

═══ REFERENCE RECIPES (adapt styling/copy to brand; keep logic identical) ═══
${recipeBlock || '(no recipes for this wave — improvise within the rules above)'}

═══ OUTPUT ═══
Single create_files tool call with one entry per file above. Each file is complete and runnable.`
}

/**
 * Build the user prompt — minimal, just a directive. When reference images
 * are provided, returns a multi-part user message with the actual images
 * attached so GPT-4o Vision re-anchors the builder on the user's aesthetic
 * for every file it emits this wave.
 *
 * @param {Object} opts
 * @param {{id:string,label:string,files:string[]}} opts.wave
 * @param {Array<{role: string, name?: string, dataUrl: string}>} [opts.referenceImages]
 *   — role-tagged user-uploaded images (logo/hero/reference)
 * @returns {string | Array<{type: string, text?: string, image_url?: {url: string, detail?: string}}>}
 */
function buildWaveUserPrompt({ wave, referenceImages }) {
  const text = `Build wave "${wave.id}" (${wave.label}). Emit all ${wave.files.length} files listed in the system prompt via a single create_files tool call. No preamble.`

  const imgs = Array.isArray(referenceImages) ? referenceImages.filter((r) => r && r.dataUrl) : []
  if (imgs.length === 0) return text

  // Cap at 2 images per wave to control token cost. The logo + hero cover
  // the "what should this look like" intent; extra references rarely add.
  const capped = imgs.slice(0, 2)
  const preamble = `${text}\n\nReference image${capped.length > 1 ? 's' : ''} attached below — USE these as your visual source of truth for palette, typography mood, and composition. Match what you see; do not default to generic SaaS aesthetics.`

  return [
    { type: 'text', text: preamble },
    ...capped.map((img) => ({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'low' },
    })),
  ]
}

/**
 * Execute one build wave. Yields SSE events; calls `onFilesProduced(files)`
 * when files are parsed from the tool call.
 *
 * @param {Object} opts
 * @param {import('./brief-planner.js').BuildPlan} opts.plan
 * @param {{id:string,label:string,files:string[]}} opts.wave
 * @param {{path:string,size?:number}[]} opts.filesBuiltSoFar
 * @param {{chatWithToolsStream: Function, chatWithTools?: Function}} opts.provider
 * @param {number} opts.waveIndex - 0-based
 * @param {number} opts.wavesTotal
 * @param {(files: {path:string,content:string}[]) => Promise<{path:string,id?:string,action?:string}[]>} opts.onFilesProduced
 */
export async function* buildWave({
  plan,
  wave,
  filesBuiltSoFar,
  provider,
  waveIndex,
  wavesTotal,
  onFilesProduced,
}) {
  yield {
    event: 'wave_start',
    data: {
      waveId: wave.id,
      label: wave.label,
      index: waveIndex,
      total: wavesTotal,
      files: wave.files,
    },
  }

  const referenceImages = Array.isArray(plan.imageAssets) ? plan.imageAssets : []
  const messages = [
    { role: 'system', content: buildWaveSystemPrompt({ plan, wave, filesBuiltSoFar }) },
    { role: 'user', content: buildWaveUserPrompt({ wave, referenceImages }) },
  ]

  let toolCalls = []
  let toolArgsAccum = ''
  let content = ''
  let lastKeepalive = Date.now()

  try {
    for await (const chunk of provider.chatWithToolsStream(messages, CREATE_TOOLS, {
      temperature: 0.7,
      max_tokens: 8192,
      tool_choice: { type: 'function', function: { name: 'create_files' } },
    })) {
      if (chunk.type === 'token') {
        content += chunk.content
      } else if (chunk.type === 'tool_calls') {
        toolCalls = chunk.tool_calls || []
      } else if (chunk.type === 'tool_args_delta') {
        toolArgsAccum += chunk.delta || ''
      }
      // Keepalive every 10s so the K8s ingress doesn't drop the connection
      const now = Date.now()
      if (now - lastKeepalive > 10000) {
        yield { event: 'keepalive', data: {} }
        lastKeepalive = now
      }
    }
  } catch (err) {
    yield { event: 'wave_error', data: { waveId: wave.id, message: err.message } }
    return { files: [], error: err.message }
  }

  // Parse files from tool calls
  let files = []
  for (const tc of toolCalls) {
    try {
      const args = JSON.parse(tc.function?.arguments || '{}')
      if (Array.isArray(args.files)) {
        for (const f of args.files) {
          if (f && f.path && typeof f.content === 'string' && f.content.length > 50) {
            files.push({ path: f.path, content: f.content })
          }
        }
      }
    } catch {}
  }

  // Recovery: if toolCalls empty but toolArgsAccum has content, try to parse it
  if (files.length === 0 && toolArgsAccum && toolArgsAccum.length > 200) {
    try {
      const parsed = JSON.parse(toolArgsAccum)
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          if (f && f.path && typeof f.content === 'string' && f.content.length > 50) {
            files.push({ path: f.path, content: f.content })
          }
        }
      }
    } catch {
      // leave empty — caller handles
    }
  }

  // Retry once non-streaming if still empty
  if (files.length === 0 && provider.chatWithTools) {
    try {
      const retry = await provider.chatWithTools(messages, CREATE_TOOLS, {
        temperature: 0.8,
        max_tokens: 8192,
        tool_choice: { type: 'function', function: { name: 'create_files' } },
      })
      for (const tc of retry.tool_calls || []) {
        try {
          const args = JSON.parse(tc.function?.arguments || '{}')
          if (Array.isArray(args.files)) {
            for (const f of args.files) {
              if (f && f.path && typeof f.content === 'string' && f.content.length > 50) {
                files.push({ path: f.path, content: f.content })
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Filter files to ONLY those declared in this wave. The LLM occasionally
  // over-produces (e.g., emits pages from a future wave). Those are dropped
  // here; the later wave will re-emit them properly with context.
  const expectedSet = new Set(wave.files)
  // Unescape any double-escaped content before filtering (see brief-utils.js)
  files = normalizeFiles(files)
  const kept = files.filter((f) => expectedSet.has(f.path))
  const dropped = files.filter((f) => !expectedSet.has(f.path)).map((f) => f.path)

  if (kept.length === 0) {
    yield {
      event: 'wave_error',
      data: {
        waveId: wave.id,
        message: `wave produced 0 expected files (got: ${files.map((f) => f.path).join(', ') || 'none'})`,
      },
    }
    return { files: [], error: 'no_expected_files' }
  }

  // Save via caller's callback
  let saved = []
  try {
    saved = await onFilesProduced(kept)
  } catch (err) {
    yield { event: 'wave_error', data: { waveId: wave.id, message: 'save failed: ' + err.message } }
    return { files: [], error: err.message }
  }

  yield {
    event: 'wave_complete',
    data: {
      waveId: wave.id,
      label: wave.label,
      filesBuilt: saved.map((f) => f.path),
      filesDropped: dropped,
    },
  }

  // Also emit files_saved for the existing preview refresh hook
  yield {
    event: 'files_saved',
    data: {
      files: saved.map((f) => ({ path: f.path, action: f.action || 'created', id: f.id })),
    },
  }

  return { files: saved, error: null }
}

/**
 * Orchestrate the whole plan: run all waves sequentially, stream events,
 * accumulate built files. Callers provide saveFiles callback.
 *
 * @param {Object} opts
 * @param {import('./brief-planner.js').BuildPlan} opts.plan
 * @param {Object} opts.provider
 * @param {Function} opts.saveFiles - async (files[]) => saved[]
 */
export async function* runAllWaves({ plan, provider, saveFiles }) {
  const filesBuiltSoFar = []
  let totalSaved = []

  for (let i = 0; i < plan.waves.length; i++) {
    const wave = plan.waves[i]
    const waveGen = buildWave({
      plan,
      wave,
      filesBuiltSoFar: filesBuiltSoFar.slice(),
      provider,
      waveIndex: i,
      wavesTotal: plan.waves.length,
      onFilesProduced: async (files) => saveFiles(files),
    })

    let result = { files: [], error: null }
    while (true) {
      const next = await waveGen.next()
      if (next.done) {
        result = next.value || { files: [], error: null }
        break
      }
      yield next.value
    }

    // Accumulate built files for context in subsequent waves
    for (const f of result.files || []) {
      filesBuiltSoFar.push({ path: f.path, size: (f.content || '').length })
      totalSaved.push(f)
    }

    // If a critical wave (scaffold) produced nothing, abort — later waves will fail anyway
    if (i === 0 && (!result.files || result.files.length === 0)) {
      yield {
        event: 'build_aborted',
        data: { reason: 'scaffold wave produced no files', waveId: wave.id },
      }
      return { files: totalSaved, aborted: true }
    }
  }

  return { files: totalSaved, aborted: false }
}
