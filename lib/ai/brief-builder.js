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

const CREATE_TOOLS = AI_TOOLS.filter((t) => ['create_files', 'update_files'].includes(t.function?.name))

/**
 * Build the system prompt for a single wave.
 * Shared constraints + wave-specific recipes + plan summary.
 */
function buildWaveSystemPrompt({ plan, wave, filesBuiltSoFar }) {
  const useSupabase = !!plan.useSupabase
  const recipeIds = recipesForWave(wave.id, plan.archetypeId, { useSupabase })
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
${useSupabase ? '\n═══ BACKEND ═══\nThis project is wired to a real Supabase backend. The scaffold recipes use `./supabaseClient` for real auth and CRUD calls; they fall back to localStorage when the client is unavailable (preview). Do NOT invent your own auth or storage — always route through `useAuth()` and `useMockAPI()` exactly as the Supabase-wired recipes define.\n' : ''}

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
9. NEVER use "Feature 1", "Item 1", "Lorem ipsum". Use real, brand-specific copy derived from the brief.
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

═══ REFERENCE RECIPES (adapt styling/copy to brand; keep logic identical) ═══
${recipeBlock || '(no recipes for this wave — improvise within the rules above)'}

═══ OUTPUT ═══
Single create_files tool call with one entry per file above. Each file is complete and runnable.`
}

/**
 * Build the user prompt — minimal, just a directive.
 */
function buildWaveUserPrompt({ wave }) {
  return `Build wave "${wave.id}" (${wave.label}). Emit all ${wave.files.length} files listed in the system prompt via a single create_files tool call. No preamble.`
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

  const messages = [
    { role: 'system', content: buildWaveSystemPrompt({ plan, wave, filesBuiltSoFar }) },
    { role: 'user', content: buildWaveUserPrompt({ wave }) },
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
