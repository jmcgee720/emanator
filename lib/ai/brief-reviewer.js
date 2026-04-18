// ══════════════════════════════════════════════════════════════════════
// ── CREATIVE BRIEF REVIEWER ──
// After all waves complete, runs a self-review pass that inspects the
// generated files against the plan's required flows. If gaps exist,
// triggers ONE repair wave via `update_files`.
//
// This is what makes Emanator "feel agentic" — it notices its own
// mistakes and fixes them without user intervention.
// ══════════════════════════════════════════════════════════════════════

import { AI_TOOLS } from './tools.js'
import { normalizeFiles } from './brief-utils.js'

const REPAIR_TOOLS = AI_TOOLS.filter((t) => ['update_files', 'create_files'].includes(t.function?.name))

/**
 * @typedef {Object} ReviewResult
 * @property {boolean} ok - True if nothing missing/broken
 * @property {string[]} missing - Files/flows that were expected but not produced
 * @property {string[]} broken - Files that exist but have dead buttons, missing onClick, etc.
 * @property {string[]} notes - Free-form observations
 */

/**
 * Run a self-review on the built app. Uses a single LLM call that gets:
 *  - The plan (routes, flows, components)
 *  - A file index (paths + sizes, not contents — too much context)
 *  - A sampled peek at 2–3 key files (scaffold + auth + one app page)
 *
 * Returns a ReviewResult JSON object.
 *
 * @param {Object} opts
 * @param {import('./brief-planner.js').BuildPlan} opts.plan
 * @param {{path:string,content:string}[]} opts.filesBuilt
 * @param {{chat: Function}} opts.provider
 * @returns {Promise<ReviewResult>}
 */
export async function reviewBuild({ plan, filesBuilt, provider }) {
  if (!Array.isArray(filesBuilt) || filesBuilt.length === 0) {
    return { ok: false, missing: ['no files produced'], broken: [], notes: [] }
  }

  // Sample files for peek (the 2-3 most likely to contain wiring bugs)
  const samplePaths = [
    'app/page.jsx',
    'components/AuthContext.jsx',
    'pages/Signup.jsx',
    'pages/Login.jsx',
    'pages/Landing.jsx',
  ]
  const samples = filesBuilt
    .filter((f) => samplePaths.includes(f.path))
    .slice(0, 4)
    .map((f) => `─── ${f.path} ───\n${(f.content || '').slice(0, 2000)}`)
    .join('\n\n')

  const fileIndex = filesBuilt.map((f) => `${f.path} (${(f.content || '').length}b)`).join('\n')
  const flowsText = plan.flows.map((f) => `- ${f.id}: ${f.desc}`).join('\n')
  const routesText = plan.routes.map((r) => `- ${r.id} → ${r.file}`).join('\n')

  const systemPrompt = `You are an app reviewer. You built an app from this plan, and now you check YOUR OWN WORK for gaps.

A flow is "wired" only if ALL of these are true:
  1. Every route in the flow exists as a file in the index
  2. Every button that should navigate has \`onClick={() => onNavigate('<routeId>')}\`
  3. Auth flows call \`useAuth()\` from AuthContext and use signup/login/logout
  4. Forms actually submit — they do NOT just have empty onSubmit handlers
  5. localStorage persistence comes from AuthContext / MockAPIProvider (not ad-hoc)
  6. Accessibility baseline holds: every <input> has a matching <label htmlFor="id"> (same id); error <p> uses role="alert"; <nav> has aria-label; decorative gradients/icons use aria-hidden. Flag files violating this as broken: "<path>: missing-label-for-input" / "missing-role-alert" / etc.
  7. Responsive baseline holds: pages with grids use responsive column classes (e.g. \`grid-cols-1 md:grid-cols-2 lg:grid-cols-3\`); nav bars hide secondary links on mobile or offer a toggle; hero font sizes use responsive tokens (\`text-3xl md:text-5xl\`); containers have \`max-w-\` constraints instead of fixed pixel widths. Flag files without any \`sm:\`, \`md:\`, or \`lg:\` prefixes AND containing flex/grid/large text as broken: "<path>: missing-responsive-classes".
  8. Router cleanliness: \`app/page.jsx\` MUST NOT render \`<Navbar />\` or \`<Footer />\` directly — only the current route + Providers. If the router renders a Navbar AND pages also render their own Navbar, the preview will show DUPLICATE navbars stacked. Flag as "app/page.jsx: router-renders-navbar-causing-duplicates".
  9. Image asset usage: if \`components/assets.js\` exists with LOGO_URL / HERO_URL exports, the Navbar MUST render \`<img src={LOGO_URL}>\` instead of a placeholder, and the hero MUST use \`<img src={HERO_URL}>\` instead of a gradient rectangle. Flag as "<path>: ignored-user-logo" or "<path>: ignored-user-hero-image".

Respond with STRICT JSON matching this schema:
{"ok": <boolean>, "missing": ["<file path or 'flow:<id>' for missing flows>"], "broken": ["<path: reason>"], "notes": ["<observation>"]}

Be STRICT. If a flow's steps cannot all be traced in the sampled files, list it as missing. Do not invent problems — only flag what you can evidence from the index or samples.`

  const userPrompt = `PLAN:
Routes:
${routesText}

Required flows:
${flowsText}

FILE INDEX (${filesBuilt.length} files):
${fileIndex}

SAMPLED FILES:
${samples || '(no key files sampled — something is very wrong)'}
`

  let raw
  try {
    raw = await provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt.slice(0, 12000) },
      ],
      { temperature: 0.1, max_tokens: 800, response_format: { type: 'json_object' } }
    )
  } catch (err) {
    return { ok: true, missing: [], broken: [], notes: ['review skipped: ' + err.message] }
  }

  let parsed
  try { parsed = JSON.parse(raw) } catch { parsed = { ok: true, missing: [], broken: [] } }
  return {
    ok: parsed.ok !== false && (!parsed.missing || parsed.missing.length === 0) && (!parsed.broken || parsed.broken.length === 0),
    missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    broken: Array.isArray(parsed.broken) ? parsed.broken : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  }
}

/**
 * Run a single repair wave based on a ReviewResult.
 * Produces either create_files (for missing) or update_files (for broken).
 *
 * @param {Object} opts
 * @param {import('./brief-planner.js').BuildPlan} opts.plan
 * @param {ReviewResult} opts.review
 * @param {{path:string,content:string}[]} opts.filesBuilt
 * @param {Object} opts.provider
 * @param {Function} opts.saveFiles
 * @param {Function} opts.updateFiles
 * @yields SSE events
 * @returns {Promise<{filesRepaired: string[], error?: string}>}
 */
export async function* repairBuild({ plan, review, filesBuilt, provider, saveFiles }) {
  yield { event: 'repair_start', data: { missing: review.missing, broken: review.broken } }

  // Build a laser-focused repair prompt
  const brokenPathRegex = /^([^:]+):/
  const brokenPaths = review.broken.map((b) => (brokenPathRegex.exec(b)?.[1] || '').trim()).filter(Boolean)
  const brokenFiles = filesBuilt.filter((f) => brokenPaths.includes(f.path))

  const missingRoutes = review.missing
    .map((m) => {
      const flowMatch = /^flow:(.+)$/.exec(m)
      if (flowMatch) {
        const flow = plan.flows.find((f) => f.id === flowMatch[1])
        return flow ? `Flow "${flow.id}" (${flow.desc}) — trace the steps and add missing files/wiring.` : null
      }
      return `File: ${m}`
    })
    .filter(Boolean)
    .join('\n')

  const brokenSummary = review.broken.slice(0, 6).join('\n')
  const brokenFileSamples = brokenFiles
    .slice(0, 3)
    .map((f) => `─── ${f.path} ───\n${(f.content || '').slice(0, 3000)}`)
    .join('\n\n')

  const routesText = plan.routes.map((r) => `- ${r.id} → ${r.file}`).join('\n')

  const systemPrompt = `You are repairing gaps in an app you just built. Follow the plan's routing contract (onNavigate route ids must match the plan).

Hard rules:
  - No \`import React\`. React and hooks are global.
  - Local imports use relative paths like \`../components/AuthContext\`.
  - Use \`useAuth()\` from AuthContext for auth, \`useMockAPI()\` from MockAPIProvider for data.
  - ★ EXACT SYMBOL NAMES — do NOT rename these:
     useAuth returns { user, signup, login, logout, isAuthenticated } — lowercase \`signup\` (not \`signUp\`), lowercase \`login\` (not \`signIn\`).
     useMockAPI returns { list, get, create, patch, remove }.
     Route ids are snake_case: \`signup\`, \`login\`, \`forgot_password\`, \`dashboard\`.
  - Every interactive element has a \`data-testid\`.
  - If adding NEW files: use create_files.
  - If fixing EXISTING files: use update_files with complete file contents (not patches).

Plan routes:
${routesText}

Repair scope: ${brokenFiles.length} file(s) to update, ${missingRoutes.split('\n').filter(Boolean).length} missing item(s) to create.

OUTPUT: one tool call. Prefer create_files if adding, update_files if modifying. If you must do both, use create_files (it can also replace existing files).`

  const userPrompt = `Issues to fix:

MISSING:
${missingRoutes || '(none)'}

BROKEN:
${brokenSummary || '(none)'}

${brokenFiles.length > 0 ? 'Current content of broken files:\n\n' + brokenFileSamples : ''}

Emit ONLY the files that need to be added or changed. Do not touch untouched files.`

  let toolCalls = []
  let toolArgsAccum = ''
  try {
    for await (const chunk of provider.chatWithToolsStream(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt.slice(0, 12000) },
      ],
      REPAIR_TOOLS,
      { temperature: 0.5, max_tokens: 6000, tool_choice: 'auto' }
    )) {
      if (chunk.type === 'tool_calls') toolCalls = chunk.tool_calls || []
      else if (chunk.type === 'tool_args_delta') toolArgsAccum += chunk.delta || ''
    }
  } catch (err) {
    return { filesRepaired: [], error: 'repair stream failed: ' + err.message }
  }

  let repairFiles = []
  for (const tc of toolCalls) {
    try {
      const args = JSON.parse(tc.function?.arguments || '{}')
      if (Array.isArray(args.files)) {
        for (const f of args.files) {
          if (f?.path && typeof f.content === 'string' && f.content.length > 50) {
            repairFiles.push({ path: f.path, content: f.content })
          }
        }
      }
    } catch {}
  }

  // Recovery from tool_args_delta
  if (repairFiles.length === 0 && toolArgsAccum.length > 200) {
    try {
      const parsed = JSON.parse(toolArgsAccum)
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          if (f?.path && typeof f.content === 'string' && f.content.length > 50) {
            repairFiles.push({ path: f.path, content: f.content })
          }
        }
      }
    } catch {}
  }

  if (repairFiles.length === 0) {
    return { filesRepaired: [], error: 'no repair files produced' }
  }

  // Unescape double-escaped content (LLM sometimes emits \\n instead of \n
  // in tool args when the prompt is terser — see brief-utils.js)
  repairFiles = normalizeFiles(repairFiles)

  let saved
  try {
    saved = await saveFiles(repairFiles)
  } catch (err) {
    return { filesRepaired: [], error: 'save failed: ' + err.message }
  }

  yield {
    event: 'files_saved',
    data: { files: saved.map((f) => ({ path: f.path, action: f.action || 'updated', id: f.id })) },
  }

  return { filesRepaired: saved.map((f) => f.path) }
}
