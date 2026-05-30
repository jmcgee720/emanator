/**
 * Stream Handler v2 — Emergent-style agent loop.
 *
 * Wires /lib/ai/agent-core.js to the existing SSE/credit/persistence
 * infrastructure. No modes, no policing, no detectors. The model uses
 * tools when it decides to and emits a text-only response when done.
 *
 * Feature flag: this is a SEPARATE endpoint
 * (POST /api/chats/:chatId/messages/stream-v2). The legacy v1 endpoint
 * remains unchanged. Frontend opts in by hitting this URL.
 *
 * SCOPE (Phase 1):
 *   - Self-edit chats: scoped to /app with sensible excludes (Core System).
 *   - Project chats: NOT YET — returns 501. Migration in Step 4.
 */

import { NextResponse } from 'next/server'
import { runAgent } from '@/lib/ai/agent-core'
import { buildDefaultToolset } from '@/lib/ai/agent-tools-v2'
import { maybeCompactPriorMessages } from '@/lib/ai/context-compactor'
import { stripInventoriedImages } from '@/lib/ai/image-replay-stripper'
import { detectCodebaseRoot } from '@/lib/ai/codebase-root'
import { buildGithubWriter, buildGithubReader, buildMissingConfigWriter } from '@/lib/ai/github-writer'
import { buildProjectFs } from '@/lib/ai/project-fs'
import { createProvider } from '@/lib/ai/providers/index'
import { SELF_EDIT_PREFIX, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { creditsDb, estimateRequestCost } from '@/lib/credits/service'
import { notifyPreviewOfFileChange } from '@/lib/fly/notify-preview'
import { captureBeforeSha, scheduleHealthCheck } from '@/lib/ai/self-edit-watchdog'
import { checkForkNeeded } from '@/lib/ai/token-counter'
import { extractMemoryFromHistory, buildMemorySummary, serializeMemory, recordFileOperation, recordAttempt, ASSUMPTION_FIRST_PROTOCOL } from '@/lib/ai/agent-memory'

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

/**
 * MANDATORY screenshot-analysis protocol.
 * Shared by both project-mode and self-edit-mode system prompts so that
 * any chat that receives a screenshot is forced through INVENTORY →
 * COMPARISON → TRUTH-CHECK GATE → MEMORY before it is allowed to emit
 * a positive assessment. This is a hard behavioural gate, NOT advice.
 *
 * Why this constant exists separately: keeping the protocol in one
 * place lets us version it (e.g. tests pin specific phrases) and
 * guarantees the two prompts stay in lock-step. A weaker version of
 * this protocol shipped previously and the agent still skipped it and
 * fabricated "looks fixed!" responses — this version makes the gate
 * explicit, names forbidden phrases, and bakes in default skepticism.
 */
const IMAGE_ANALYSIS_PROTOCOL = [
  'WHEN THE USER ATTACHES IMAGES OR SCREENSHOTS — MANDATORY ANALYSIS PROTOCOL:',
  'You CAN see them — they are passed to you as native vision content blocks (claude vision). The following five-step gate is a HARD REQUIREMENT, not a suggestion. You MUST execute every step in order BEFORE any assessment, positive or negative. Skipping a step = fabrication.',
  '',
  '  STEP 1 — INVENTORY FIRST (mandatory, written in the response):',
  '    Write a literal, neutral description of what you actually see in the screenshot — describe what you actually see in plain language. List every visible UI element, every text label (quote the exact text), positions/alignment, colors, states (active/disabled/hovered), and what is NOT visible because it is cropped or off-screen. Cue specific UI things to inventory: UI elements visible, error text, panel layout, what is highlighted or selected.',
  '    Example: "I see a modal whose header text is cut off — only the letters \'User Manag\' are visible at the top edge of the viewport. The modal\'s body is positioned at y≈0, flush with the top of the page. The Save button at the bottom is partially hidden behind the system dock."',
  '    Use the user\'s filename as a label ("attachment 1: bug-report.png — …"). Number them in order.',
  '    If an image is blurry, cropped, or you cannot identify a critical region, say "I cannot identify this clearly" and ASK the user to re-screenshot or scroll. Do not guess.',
  '',
  '  STEP 2 — COMPARISON PHASE (mandatory if the user previously described an expected state or reported a bug):',
  '    Explicitly compare what you see in the inventory to what the user said should be there. List matches and mismatches one by one.',
  '    Example: "User said the modal should be centered. INVENTORY shows the modal at y=0 (top of screen), not centered vertically → MISMATCH."',
  '    Never claim to see UI elements (buttons, error messages, toasts, console output) that are not actually in the inventory you just produced. CONFIRM, DO NOT GUESS.',
  '',
  '  STEP 3 — TRUTH-CHECK GATE (mandatory before any assessment):',
  '    Re-read the inventory and the comparison BEFORE writing any conclusion. The following phrases are FORBIDDEN if the inventory contains ANY of: cropped/cut-off elements, misalignment, error messages, blank states the user did not want, missing elements the user expected, or anything that contradicts the user\'s stated expectation:',
  '      ❌ "looks perfect"  ❌ "looks good"  ❌ "that\'s fixed"  ❌ "it\'s working now"  ❌ "the fix worked"  ❌ "great, that resolved it"  ❌ any equivalent positive phrasing.',
  '    If the inventory shows problems, you MUST instead state the problems found. NEVER FABRICATE positivity. Doing so violates your core function. If the inventory contains nothing problematic AND the comparison shows all matches, you may then state success — but you must cite the specific inventory items that prove it (e.g. "modal header reads \'User Management\' fully visible at y=120, centered horizontally — matches user\'s expected centered layout").',
  '',
  '  STEP 4 — MEMORY (mandatory):',
  '    At the end of your inventory, briefly summarize the key layout facts in a "LAYOUT NOTES" block (element positions, sizes, relationships, UI state). When the user sends a follow-up screenshot, refer back to this stored snapshot to track changes across turns ("LAYOUT NOTES (turn 3): modal y still 0; header still cropped — no change since turn 1").',
  '',
  '  STEP 5 — DEFAULT TO SKEPTICISM:',
  '    If you made a code change in a previous turn and the user sends a screenshot, your DEFAULT assumption is that the change did NOT work. You may only revise that assumption after the inventory + comparison demonstrate it. Optimism without inventory evidence is fabrication.',
  '',
  '  AFTER the five steps, you may proceed with follow-up questions, code edits, or save actions ("ONLY THEN ACT"). For any BINARY file the user uploaded (image, PDF, sprite, audio) that you want to save into a project / source tree, use save_attachment_to_path with attachment_index or attachment_filename. NEVER use write_file for a binary — that means save binaries via `save_attachment_to_path` and NOT `write_file`; it only accepts text strings and will silently truncate a PNG to a few useless bytes. After saving, mention the saved path so the user can verify. Do not reference details, characters, colors, or filenames that are not in the inventory you just produced — that is fabrication. If you have not labeled an image, propose a slot based on what you see and ASK before saving — never silently substitute or invent metadata.',
  '',
  '  ABSOLUTE PROHIBITION: NEVER tell the user "I cannot see images" or "I do not have access to the attachments". You have full vision. If you do not see attachments in your context, say "I do not see attachments on THIS message" and ask the user to re-drop the file; do not blanket-claim you lack vision capability.',
].join('\n')

/**
 * Meta-cognition / audience-awareness rule.
 * Shared by both prompts. The trigger case is: user asks the agent to
 * write a prompt for another LLM ("write a prompt I can paste to my
 * Emergent agent so it fixes X"). The agent previously wrote that
 * prompt in first-person, as if it were instructing itself — which
 * defeats the purpose, since the user then has to mentally rewrite it
 * before pasting. The fix: explicitly identify the AUDIENCE of any
 * generated artefact (prompt, email, spec, doc) before writing it.
 */
const META_COGNITION_RULE = [
  'THINK BEFORE YOU WRITE — AUDIENCE AWARENESS:',
  'Before producing any deliverable (a prompt, an email, a spec, a chat message draft, a PR description, a doc), STOP and identify WHO the audience is. The audience is rarely you.',
  '  • If the user asks you to "write a prompt for Emergent / another agent / another LLM / Cursor / ChatGPT", the audience is THAT other agent — not you. Write it in the second person addressed to that target ("You are an agent operating on … Your job is to …"). Never write it in first person referring to yourself ("When I attach a screenshot, I must …") — that artefact is unusable.',
  '  • If the user asks you to "draft an email to my customer", the audience is the customer, not the user. Address the customer.',
  '  • If the user asks you to "summarise this for the team", the audience is the team.',
  '  • Before you start writing the artefact, surface the audience in one short line: "Audience: <who>. Tone: <what>." Then write the artefact. The audience line is non-negotiable for any prompt / email / external-facing doc — it is your check against drifting into first-person self-talk.',
  'Mis-targeting the audience is one of the most expensive failure modes — it forces the user to rewrite your output by hand. Catch it upfront.',
].join('\n')

/**
 * Investigation-first / doom-loop break rule.
 *
 * Trigger pattern (from real incident transcript): user reports a
 * visual bug → agent ships fix A → user sends screenshot showing it
 * still broken → agent ships fix B → user screenshot still broken →
 * agent ships fix C → … 17 commits later the bug is still there and
 * the user is rightly furious. The agent never investigated WHY fix
 * A failed to take effect — it just tried a different fix.
 *
 * Worse: in the AdminPanel incident, the agent claimed to ship
 * `createPortal(...)` in chat but the file showed zero portal code
 * across all 17 commits. The "fix" was never even committed. The
 * inventory gate catches future fabrication of "looks fixed" but
 * does not catch "I added the portal" when no portal was added.
 *
 * This rule forces investigation after the 2nd same-bug attempt.
 */
const INVESTIGATION_FIRST_RULE = [
  'DOOM-LOOP BREAK — INVESTIGATE BEFORE YOU PATCH AGAIN:',
  'If you have already made a code change to fix a specific visual / behavioural symptom and the user comes back saying it is still broken (in words or via a screenshot), you are FORBIDDEN from shipping another fix-attempt without first running diagnostics. The default failure mode is: model assumes its first fix landed and tries a different positioning / styling / wiring approach. That is rarely the right answer — the right answer is almost always "something prevented the first fix from taking effect."',
  '',
  'Mandatory diagnostic checklist BEFORE attempting fix N+1 on the same symptom:',
  '  1. READ-BACK: open the file you claim to have edited with read_file and verify the edit is actually in it. If your earlier edit_file call returned success but the change is not present, you have a write-failure path you must surface.',
  '  2. GIT LOG: list the last few commits touching that file (search_files / git log via run_command if available) and confirm your commit hash is there. If your fix never committed, that is the bug.',
  '  3. DEPLOYMENT VERIFY: if writes go through GitHub to Vercel, confirm a redeploy was triggered AFTER your commit. If the deploy completed but the file in the served bundle is stale, suspect cache / build issue, not your code.',
  '  4. RUNTIME PROBE: if the code is provably deployed but the user still sees the bug, add a `console.log("[diag][<feature>] mounted/ran:", <state>)` near the suspect code path BEFORE making any structural change. Ask the user to send the console output. Without that data you are guessing.',
  '  5. ROOT-CAUSE PROBE: enumerate at least three concrete reasons the previous fix could have failed to take effect (cache, hydration, CSS containing-block, lint stripped the import, conditional gate, etc.) and rule them out by evidence, not by intuition.',
  '',
  'You may ONLY ship another fix-attempt after diagnostics produce evidence pointing to a specific cause. Saying "let me try a different approach" without diagnostics is the exact failure pattern the user is complaining about.',
  'Bonus: claiming you shipped a fix you did not actually commit is a critical failure — always verify your commit landed (read_file on the file, look for the literal code you intended to add). The most expensive bugs are the ones where the "fix" was never in the deployed bundle.',
].join('\n')

/**
 * Core System protected-paths rule (self-edit mode only).
 *
 * Trigger pattern from 2026-05-21 NextAuth incident: agent took
 * "fix Google login" and shipped 19 commits replacing Supabase auth
 * with a half-built next-auth migration without env vars set. User
 * was locked out of the platform for hours.
 *
 * This rule pre-warns the model BEFORE it hits the writeFile/editFile
 * tool-level refusal. The tool-level refusal is the ground truth
 * (string-match check on user's CONFIRMED: token), but a refusal
 * mid-turn is annoying — better to surface the gate upfront so the
 * model proposes the change as text first and waits for explicit
 * confirmation.
 */
const PROTECTED_PATHS_RULE = [
  'PROTECTED PATHS / DEPENDENCIES — HARD GATE (self-edit mode only):',
  'Some files and dependencies are on a Core System protected list because changes to them have caused platform outages. Before you call write_file / edit_file on any of these, you MUST first describe the proposed change to the user and WAIT for them to literally type the token `CONFIRMED: <path>` (or `CONFIRMED: <package>`) as their next message.',
  '',
  'Protected categories:',
  '  • Auth: components/auth/**, app/api/auth/**, app/auth/**, lib/auth/**, lib/supabase*.js, components/AppShell.jsx, middleware.{js,ts}',
  '  • Payments / credits: lib/api/routes/stripe/**, lib/payments/**, lib/credits/**, app/api/stripe/**, app/api/credits/**, app/api/webhooks/**',
  '  • Build / env: app/layout.{js,tsx}, .env*, vercel.json, next.config.*',
  '  • Schema: supabase/migrations/**',
  '  • Forbidden dependency additions: next-auth, @auth/*, firebase-auth, @aws-amplify/auth, passport*, @clerk/*, lucia*, iron-session, openid-client (any auth framework swap that competes with Supabase)',
  '  • Kill-switch substrings (refused even when path is not protected): `from \'next-auth\'`, `process.env.NEXTAUTH`, `supabase.auth = `, `throw new Error(\'AUTH_DISABLED`',
  '',
  'Behaviour on protected change:',
  '  1. DO NOT call write_file or edit_file. The tool will refuse.',
  '  2. Reply with: (a) WHAT you intend to change, (b) WHY this is the right approach instead of debugging the existing setup, (c) WHAT could break (env vars required, sessions invalidated, schema changes).',
  '  3. Wait. The user must literally type `CONFIRMED: <exact path or package>` as the FIRST line of their reply.',
  '  4. Only after that exact CONFIRMED line lands may you retry the write.',
  '',
  'Vague approval ("sure", "yes", "go ahead", "do it") does NOT satisfy this gate. The model interpreting non-CONFIRMED messages as confirmation is the failure mode this gate exists to prevent.',
  '',
  'Default stance: when a user says "fix the Google login thing" or "the credits aren\'t working" or "auth is broken", do NOT reach for a framework swap or a dependency add. 90% of the time the root cause is a redirect URI mismatch, an env var typo, a missing webhook secret, or a stale session — fixable in <20 lines without touching protected paths. Debug the existing integration first; propose a rewrite only as a last resort, and only with CONFIRMED.',
].join('\n')

/**
 * Detect project framework/type by inspecting key files.
 * Returns { framework, entryPoint, description } or null.
 * Best-effort — never throws, always returns something useful.
 */
async function detectProjectFramework(projectFs) {
  if (!projectFs || !projectFs.readFile) return null
  
  try {
    // Try package.json first (most reliable for Node/React/Vue/etc.)
    try {
      const pkgResult = await projectFs.readFile('package.json', 10_000)
      const pkg = JSON.parse(pkgResult.content)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      
      // React detection
      if (deps.react || deps['react-dom']) {
        if (deps.next) {
          return {
            framework: 'Next.js (React)',
            entryPoint: 'pages/index.js or app/page.js',
            description: 'Next.js app with file-based routing. Changes to pages/ or app/ trigger hot reload.',
          }
        }
        if (deps.vite || deps['@vitejs/plugin-react']) {
          return {
            framework: 'React + Vite',
            entryPoint: 'src/main.jsx or src/App.jsx',
            description: 'Vite dev server with React. index.html loads the entry script.',
          }
        }
        if (deps['react-scripts']) {
          return {
            framework: 'Create React App',
            entryPoint: 'src/index.js or src/App.js',
            description: 'CRA with webpack dev server. public/index.html is the HTML shell.',
          }
        }
        return {
          framework: 'React (custom setup)',
          entryPoint: 'src/index.js or src/main.jsx (check package.json scripts)',
          description: 'React project with custom build config.',
        }
      }
      
      // Vue detection
      if (deps.vue) {
        if (deps.nuxt) {
          return {
            framework: 'Nuxt (Vue)',
            entryPoint: 'pages/index.vue or app.vue',
            description: 'Nuxt app with file-based routing.',
          }
        }
        return {
          framework: 'Vue.js',
          entryPoint: 'src/main.js or src/App.vue',
          description: 'Vue app. index.html mounts the root component.',
        }
      }
      
      // Svelte detection
      if (deps.svelte) {
        return {
          framework: 'Svelte',
          entryPoint: 'src/main.js or src/App.svelte',
          description: 'Svelte app with Vite or Rollup.',
        }
      }
      
      // Angular detection
      if (deps['@angular/core']) {
        return {
          framework: 'Angular',
          entryPoint: 'src/main.ts',
          description: 'Angular app with CLI dev server.',
        }
      }
      
      // Node/Express API
      if (deps.express || deps.fastify || deps.koa) {
        return {
          framework: 'Node.js API server',
          entryPoint: 'server.js or index.js',
          description: 'Backend API — no browser preview, check server logs for errors.',
        }
      }
      
      // Generic Node project
      if (pkg.type === 'module' || pkg.main || pkg.scripts?.start) {
        return {
          framework: 'Node.js',
          entryPoint: pkg.main || 'index.js',
          description: 'Node project. Check package.json scripts for how to run it.',
        }
      }
    } catch {
      // package.json not found or invalid — try HTML detection
    }
    
    // Try index.html (vanilla HTML/CSS/JS or Vite without package.json)
    try {
      const htmlResult = await projectFs.readFile('index.html', 10_000)
      const html = htmlResult.content.toLowerCase()
      if (html.includes('type="module"')) {
        return {
          framework: 'Vanilla JS (ES modules)',
          entryPoint: 'index.html + script modules',
          description: 'Plain HTML/CSS/JS with ES6 modules. Changes appear on page refresh.',
        }
      }
      return {
        framework: 'Static HTML site',
        entryPoint: 'index.html',
        description: 'Plain HTML/CSS/JS. Refresh preview to see changes.',
      }
    } catch {
      // No index.html either
    }
    
    // Fallback: list files and guess
    const files = await projectFs.listFiles('*', '')
    if (files.some((f) => f.endsWith('.jsx') || f.endsWith('.tsx'))) {
      return {
        framework: 'React (inferred from .jsx/.tsx files)',
        entryPoint: 'unknown — check for src/index.js or src/App.jsx',
        description: 'React project detected. Read package.json to confirm setup.',
      }
    }
    if (files.some((f) => f.endsWith('.vue'))) {
      return {
        framework: 'Vue (inferred from .vue files)',
        entryPoint: 'unknown — check for src/main.js',
        description: 'Vue project detected. Read package.json to confirm setup.',
      }
    }
    if (files.some((f) => f.endsWith('.svelte'))) {
      return {
        framework: 'Svelte (inferred from .svelte files)',
        entryPoint: 'unknown — check for src/main.js',
        description: 'Svelte project detected. Read package.json to confirm setup.',
      }
    }
    
    return {
      framework: 'Unknown',
      entryPoint: 'not detected',
      description: 'Could not detect framework. Read package.json or index.html to identify the stack.',
    }
  } catch (e) {
    console.warn('[detectProjectFramework] detection failed:', e?.message)
    return null
  }
}

/** Project-mode system prompt — for editing user project files (not the Auroraly source). */
function buildProjectSystemPrompt(env) {
  const projectContext = env.projectContext || {}
  const frameworkInfo = projectContext.framework
    ? `\n\n## PROJECT CONTEXT\n\n**Framework/Type**: ${projectContext.framework}\n**Entry point**: ${projectContext.entryPoint || 'not detected'}\n${projectContext.description ? `**Architecture**: ${projectContext.description}\n` : ''}`
    : '\n\n## PROJECT CONTEXT\n\n**Framework/Type**: Not yet detected — use `read_file` on package.json or index.html to identify the stack.\n'
  
  // Only inject heavy protocol blocks when needed (controlled by env flags)
  const includeImageProtocol = env.hasImages !== false // default true for safety
  const includeInvestigationRule = env.includeInvestigationRule !== false // default true
  
  // Inject memory summary if available
  const memorySummary = env.memorySummary || ''
  
  return [
    `You are Auroraly's project agent. You are working inside the user's project "${env.projectName || env.projectId}".`,
    frameworkInfo,
    memorySummary,
    '## WHAT YOU ARE BUILDING',
    '',
    'This project has a **LIVE PREVIEW** — a real browser iframe that renders the code you write. When you create or edit files:',
    '  • The preview automatically hot-reloads within 2-5 seconds',
    '  • The user is watching the preview while chatting with you',
    '  • If the preview is blank, broken, or showing errors, the user will tell you (or send a screenshot)',
    '  • **The preview IS the product** — your changes must produce visible, working UI',
    '',
    '**When the user says "the preview is blank" or "nothing shows up":**',
    '  1. ASK for console errors: "Open DevTools (F12) → Console tab. What errors do you see?"',
    '  2. READ the entry file (index.html, App.jsx, main.jsx, etc.) to verify structure',
    '  3. CHECK for common causes: missing imports, typos in component names, incorrect file paths, missing dependencies in package.json',
    '  4. NEVER guess — always read the actual file content before diagnosing',
    '',
    '## FAST-PATH DIAGNOSTICS — FRAMEWORK-SPECIFIC ERRORS',
    '',
    'Before engaging in multi-turn debugging, check if the error matches a deterministic failure pattern:',
    '',
    '### Next.js / Nuxt / SvelteKit / Remix (file-based routing)',
    '**Symptom:** User reports "404 error" or "Cannot GET /some/path" when clicking a link/button.',
    '**Diagnosis:** The route file does not exist.',
    '**Action (single turn):**',
    '  1. Extract the path from the error or user description (e.g., "/campaigns/new")',
    '  2. Determine the framework routing convention:',
    '     - Next.js App Router: /app/[path]/page.jsx',
    '     - Next.js Pages Router: /pages/[path].jsx or /pages/[path]/index.jsx',
    '     - Nuxt: /pages/[path].vue',
    '     - SvelteKit: /src/routes/[path]/+page.svelte',
    '     - Remix: /app/routes/[path].jsx',
    '  3. list_files to confirm the file is missing',
    '  4. write_file to create the route with a minimal working component',
    '  5. Respond: "✅ Created /path/to/route. The 404 is fixed. Try again."',
    '',
    '**Do NOT:**',
    '  - Ask "what does the console say?" (404 = missing file, always)',
    '  - Read unrelated layout/component files',
    '  - Suggest the user check their link href (if the href is correct, the file is missing)',
    '',
    '### React / Vue / Angular (client-side routing)',
    '**Symptom:** "No route matches" or blank page with router error in console.',
    '**Diagnosis:** Route config is missing the path.',
    '**Action:** Read the router config file (App.jsx, router/index.js, app-routing.module.ts), add the route, respond in one turn.',
    '',
    '### API 404',
    '**Symptom:** "404" on /api/* path.',
    '**Diagnosis:** API route file missing (Next.js) or endpoint not registered (Express/Fastify).',
    '**Action:** Create /pages/api/[path].js (Pages Router) or /app/api/[path]/route.js (App Router), or add the route to the API framework config.',
    '',
    '**General principle:**',
    'If the framework uses **convention over configuration** (file presence = route existence), and the user reports the route doesn\'t work, the file is missing. Create it immediately. Do not debug.',
    '',
    includeImageProtocol ? '**When the user sends a screenshot of the preview:**\n  • Execute the mandatory screenshot analysis protocol (INVENTORY → COMPARISON → TRUTH-CHECK)\n  • If you see console errors in the screenshot, READ those exact error messages and trace them to the source\n  • If the preview shows a blank screen, ask for console output — never assume "it works" without evidence\n' : '',
    `READS / WRITES: All file operations target the project's files in the database. read_file / write_file / edit_file / delete_file / list_files / search_files operate on this project ONLY. Changes appear in the live preview within a few seconds.`,
    '',
    'Tools available:',
    '  • read_file       — read a project file (returns line-numbered content)',
    '  • write_file      — create a new file or completely overwrite an existing one',
    '  • edit_file       — replace exact unique text in an existing file (preferred for surgical edits)',
    '  • delete_file     — permanently remove a file from the project',
    '  • search_files    — search the project for a pattern',
    '  • list_files      — find project files by name pattern',
    '  • web_search      — Tavily-backed live web search. CALL THIS BEFORE telling the user how to navigate any 3rd-party UI (Google Cloud, Stripe, Supabase, Vercel, OAuth providers, etc.) when you are not certain the labels/tabs you remember still match the current layout. Your training data is from early 2025 and many platform consoles have been reorganised since. If a user uploads a screenshot of a 3rd-party console and asks "how do I find X?", search the web for the current layout BEFORE answering. One focused query is much cheaper than five wrong screenshots.',
    env.hasAttachments ? '  • save_attachment_to_path — save images/PDFs the user uploaded; write_file is text-only and will truncate binaries.' : '',
    '',
    env.hasAttachments ? 'ATTACHMENT PERSISTENCE: Images and files the user uploads persist across the conversation. You can save them with save_attachment_to_path even if they were uploaded several turns ago (last 5 user messages available).\n\nCRITICAL — HOW TO ANALYSE UPLOADED IMAGES:\n  • When the user uploads an image, the actual image bytes are sent to you as a VISION content block on that user message. You can literally see the pixels — no tool call is needed to "view" it.\n  • DO NOT call read_file on an uploaded image\'s saved path. That returns the base64 data URL (200KB of gibberish), not the visual contents. The image is already in front of you as a vision input — look at it directly.\n  • The [ATTACHED FILES - already saved to project: …] prefix in the user\'s message exists ONLY so you know the file path to reference in code (e.g. <img src="/images/foo.png" />). It is NOT an instruction to read the file.\n  • Then execute the screenshot analysis protocol on the actual image you can see.\n' : '',
    'Use tools whenever you need real information. If the user reports a bug or error, READ the relevant files first to understand the actual code before proposing changes. Make targeted edits with edit_file using exact text that is unique in the file.',
    '',
    'WHEN THE USER ASKS TO SEE A FILE: After calling read_file, the full file contents are ALREADY rendered to the user inline (verbatim, with line numbers). You do NOT need to re-paste them. Just answer the user\'s question about the file. If they only asked to see it with no follow-up question, a one-sentence acknowledgement is fine. Never end your turn with empty text after a read_file call — always produce SOME response.',
    '',
    includeImageProtocol ? IMAGE_ANALYSIS_PROTOCOL + '\n' : '',
    META_COGNITION_RULE,
    '',
    ASSUMPTION_FIRST_PROTOCOL,
    '',
    includeInvestigationRule ? INVESTIGATION_FIRST_RULE + '\n' : '',
    'HARD RULES (violating these is a security incident — do not):',
    '  1. NEVER touch the Auroraly source code (anything under /app, lib/, components/, package.json, supabase/, etc.). You operate ONLY on this user project. If the user asks you to edit Auroraly itself, tell them to open a Core System chat — you cannot do it here.',
    '  2. NEVER run `curl`, `wget`, `fetch`, or any other HTTP client against GitHub, Supabase, Vercel, Anthropic, OpenAI, or any other API. You do not have a `run_command` tool in project mode — your file tools are the only way to make changes, and they already use server-side credentials.',
    '  3. NEVER write, log, or echo any credential, API key, access token, service-role key, or `Authorization` header into a file, response, or shell. Treat every secret as classified.',
    '',
    'Respond with text only when you are finished. The user wants short, concrete answers (specific file paths, line numbers, what you changed and why). Do NOT ask the user questions you can answer yourself by reading the files.',
  ].filter(Boolean).join('\n') // filter(Boolean) removes empty strings from conditional blocks
}

/** Build a clean, minimal system prompt — NO policing, NO forbidden patterns. */
function buildSelfEditSystemPrompt(env) {
  const fsSummary = env.readerKind === 'github'
    ? `READS: read_file / list_files / search_files all operate on the live GitHub repo ${env.repo}@${env.branch}. The serverless filesystem at ${env.root} contains only a tree-shaken bundle and is NOT the source — always use the tools (never trust raw paths under /var/task).`
    : `READS: read_file / list_files / search_files operate on the local filesystem rooted at ${env.root}.`
  const writeMode = env.writerKind === 'github'
    ? `WRITES: write_file, edit_file, and delete_file commit directly to ${env.repo}@${env.branch} via GitHub. Each edit triggers a Vercel redeploy (~2 minutes).`
    : env.writerKind === 'missing-config'
      ? 'WRITES: this environment requires GitHub-backed writes but GITHUB_TOKEN / GITHUB_REPO are not configured. Calls to write_file / edit_file / delete_file will return setup instructions. Reads still work.'
      : 'WRITES: write_file, edit_file, and delete_file modify the local filesystem at the codebase root.'
  
  // Inject memory summary if available
  const memorySummary = env.memorySummary || ''
  
  return [
    'You are Auroraly\'s self-edit agent ("Core System mode"). You can read, search, edit, and run commands on the Auroraly source tree.',
    '',
    fsSummary,
    writeMode,
    memorySummary,
    '',
    'Tools available:',
    '  • read_file       — read a file (returns line-numbered content)',
    '  • write_file      — create a new file or completely overwrite an existing one',
    '  • edit_file       — replace exact unique text in an existing file',
    '  • run_command     — run a shell command on the runtime (NOT the source tree on serverless)',
    '  • search_files    — search the codebase for a pattern',
    '  • list_files      — find files by name pattern',
    '  • web_search      — Tavily-backed live web search. Use when you need current docs, API changelogs, or 3rd-party UI layouts that may have changed since your training data.',
    '  • save_attachment_to_path — present when attachments are available (current turn or recent history). Use this for any image/PDF/binary the user uploaded; write_file is text-only and will silently truncate binaries. Attachments from the last 5 user messages are available.',
    '',
    'Use tools whenever you need real information. If you do not know where a file lives, call list_files or search_files. If you need to see code before changing it, call read_file. Edit using edit_file with unique exact text.',
    '',
    IMAGE_ANALYSIS_PROTOCOL,
    '',
    META_COGNITION_RULE,
    '',
    ASSUMPTION_FIRST_PROTOCOL,
    '',
    INVESTIGATION_FIRST_RULE,
    '',
    PROTECTED_PATHS_RULE,
    '',
    'HARD RULES (violating these is a security incident — do not):',
    '  1. SCOPE: You operate ONLY on the Auroraly source tree. You CANNOT and MUST NOT read or write files in any user project (Nexsara, Mangia Mama, etc.) — those live in a separate Supabase database and have their own chat sessions. If the user asks you to fix something in their project, tell them to open the chat for that project.',
    '  2. NO RAW HTTP: NEVER run `curl`, `wget`, or any other HTTP client against GitHub, Supabase, Vercel, Anthropic, OpenAI, or any other API. Your read_file / write_file / edit_file / search_files tools already use server-side credentials. Calling these APIs by hand is wrong, slow, and exposes secrets to the chat transcript.',
    '  3. NO CREDENTIALS IN COMMANDS: NEVER paste a GitHub PAT, Supabase service-role key, API key, JWT, or `Authorization: Bearer …` value into a `run_command` invocation, a file, or your text response. The runtime auto-rejects commands containing token-shaped strings; getting blocked by the guard means you tried to leak a secret.',
    '',
    'Respond with text only when you are finished — when there is no further tool call to make. The user is technical and prefers short, concrete answers (specific file paths, line numbers, what you changed and why).',
  ].join('\n')
}

function buildSelfEditScope(root) {
  return {
    rootDirs: [root],
    excludePaths: [
      root + '/node_modules',
      root + '/.next',
      root + '/.git',
      root + '/.emergent',
      root + '/.vercel',
    ],
    maxFileBytes: 200 * 1024,
    execTimeoutMs: 20_000,
  }
}

/**
 * Cap inlined attachment text so a single upload can't blow the context
 * window. ~30k chars ≈ 7.5k tokens worst case — well within budget per file.
 */
const ATTACHMENT_TEXT_CHAR_CAP = 30_000

/**
 * Convert a single attachment record into an Anthropic content block.
 * Returns null when the attachment can't be represented (e.g. missing data).
 * Supports image (vision), text/code (inline), and pdf (extracted text).
 */
function attachmentToContentBlock(att, tag = 'StreamV2') {
  if (!att) return null
  const isImage =
    att.file_category === 'image' ||
    att.type?.startsWith('image/') ||
    att.mime_type?.startsWith('image/')
  if (isImage) {
    const imageData = att.preview_data || att.data
    if (!imageData) return null
    const m = imageData.match(/^data:image\/([^;]+);base64,(.+)$/)
    if (!m) {
      console.warn(`[${tag}] attachment image not a data URL:`, att.filename)
      return null
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: `image/${m[1]}`, data: m[2] },
    }
  }
  // Text / code attachments — inline the file content as a text block.
  if (att.file_category === 'text' || att.mime_type?.startsWith('text/')) {
    const body = att.content || att.extracted_text
    if (!body) return null
    const trimmed = String(body).slice(0, ATTACHMENT_TEXT_CHAR_CAP)
    const note = body.length > ATTACHMENT_TEXT_CHAR_CAP ? `\n\n[…truncated at ${ATTACHMENT_TEXT_CHAR_CAP} chars]` : ''
    return {
      type: 'text',
      text: `### Uploaded file: ${att.filename || att.path || 'attachment'} (${att.mime_type || 'text'})\n\`\`\`\n${trimmed}${note}\n\`\`\``,
    }
  }
  // PDF — use server-extracted text if available.
  if (att.file_category === 'pdf') {
    const body = att.extracted_text || att.content
    if (!body) return null
    const trimmed = String(body).slice(0, ATTACHMENT_TEXT_CHAR_CAP)
    const note = body.length > ATTACHMENT_TEXT_CHAR_CAP ? `\n\n[…truncated at ${ATTACHMENT_TEXT_CHAR_CAP} chars]` : ''
    return {
      type: 'text',
      text: `### Uploaded PDF: ${att.filename || 'document.pdf'}\nExtracted text:\n${trimmed}${note}`,
    }
  }
  return null
}

/**
 * Format a user message + its attachments as Anthropic content. Returns a
 * string when there are no attachments, otherwise an array of content blocks.
 */
function buildUserContent(textContent, attachments, tag = 'StreamV2') {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return textContent
  }
  const blocks = []
  for (const att of attachments) {
    const b = attachmentToContentBlock(att, tag)
    if (b) blocks.push(b)
  }
  // No attachments produced usable blocks → just send the original text.
  // Wrapping a single text block in an array works but adds noise to the
  // wire format and to history, so prefer plain string when possible.
  if (blocks.length === 0) return textContent
  if (textContent && textContent.length > 0) {
    blocks.push({ type: 'text', text: textContent })
  }
  return blocks
}

/**
 * Strip verbose tool results from history to save tokens.
 * When read_file returns 50KB of code, we only need the first few lines
 * in history — the full content was already shown inline on the turn it
 * was read. This keeps long conversations from blowing the context window.
 */
function stripVerboseToolResults(messages) {
  const TOOL_RESULT_PREVIEW_CHARS = 800
  return messages.map((msg) => {
    // Only strip content from assistant messages that look like inline
    // tool results (the "> ↳ file\n\n<full file content>" pattern from
    // lines 1099-1100). User messages and short assistant messages pass
    // through unchanged.
    if (msg.role !== 'assistant' || !msg.content || typeof msg.content !== 'string') {
      return msg
    }
    // Heuristic: if the message is >5KB and contains the tool-result
    // marker ("> ↳"), assume it's a verbose tool result that can be
    // trimmed. Keep the first ~800 chars (file path + first few lines)
    // as context, then append a truncation note.
    if (msg.content.length > 5000 && msg.content.includes('> ↳')) {
      const preview = msg.content.slice(0, TOOL_RESULT_PREVIEW_CHARS)
      return {
        ...msg,
        content: preview + '\n\n[...tool result content stripped to save tokens — full content was shown inline on the turn it was called]',
      }
    }
    return msg
  })
}

/**
 * Build prior messages from the chat history for the agent.
 * Strips assistant tool-call metadata since v2 reconstructs its own.
 * Converts image / text / pdf attachments into Anthropic content blocks.
 */
async function loadPriorMessages(db, chatId, currentUserMessageId) {
  try {
    const rows = await db.messages.findByChatId(chatId)
    const prior = (rows || [])
      .filter((m) => m.id !== currentUserMessageId)
      .filter((m) => !m.metadata?.silent)
      .slice(-40) // last 40 turns for better memory retention
      .map((m) => {
        const textContent = typeof m.content === 'string' ? m.content : String(m.content || '')

        // User messages with attachments → content blocks (image + text + pdf)
        if (m.role === 'user' && m.metadata?.attachments && Array.isArray(m.metadata.attachments) && m.metadata.attachments.length > 0) {
          const content = buildUserContent(textContent, m.metadata.attachments, 'StreamV2/history')
          if (Array.isArray(content) && content.length > 0) {
            return { role: 'user', content }
          }
        }

        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: textContent,
        }
      })
      .filter((m) => {
        if (Array.isArray(m.content)) return m.content.length > 0
        return m.content && m.content.length > 0
      })
    return prior
  } catch (e) {
    // Loud failure so future regressions appear in Vercel logs immediately.
    console.error('[StreamV2] loadPriorMessages FAILED — agent will run with no memory:', e?.message, e?.stack)
    return []
  }
}

/**
 * Main handler. Mirrors v1's auth/credit shell but delegates the actual
 * agent loop to /lib/ai/agent-core.js.
 */
export async function handleStreamMessageV2(request, { chatId, authUser: _authUser, dbUser, db }) {
  const body = await request.json()
  const { content, metadata = {} } = body
  const isSilent = metadata.silent === true

  if (!content) {
    return handleCORS(NextResponse.json({ error: 'Content required' }, { status: 400 }))
  }

  const chat = await db.chats.findById(chatId)
  if (!chat) {
    return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
  }

  // Conversation lock
  if (metadata.projectId && metadata.projectId !== chat.project_id) {
    return handleCORS(NextResponse.json({ error: 'Chat belongs to a different project. Confirm project context.' }, { status: 403 }))
  }

  // ── Self-edit detection ────────────────────────────────────────────
  // A chat operates on Auroraly's own codebase (self-edit / Core System
  // mode) if EITHER:
  //   (a) its title starts with the canonical "⚙ Self-Edit: " prefix
  //       (created via createSelfEditChat in useDashboardProject.js), OR
  //   (b) it lives inside a project flagged with settings.is_core === true
  //       (i.e. the project the dashboard's "Core System" button creates).
  //
  // Path (b) was added because users could create a chat inside the
  // Core System project via the regular "+ New chat" button (which
  // doesn't add the prefix) and end up with a "project agent" that
  // refused to touch Auroraly's source — defeating the entire reason
  // Core System exists. With path (b) any chat in a Core System
  // project is self-edit regardless of how it was created, so the
  // permission model is governed by the *project*, not the *title*.
  let prefetchedProject = null
  if (chat.project_id) {
    try {
      prefetchedProject = await db.projects.findById(chat.project_id)
    } catch (e) {
      console.warn('[StreamV2] project prefetch failed; will retry later if needed:', e?.message)
    }
  }
  const isSelfEditByTitle = chat.title?.startsWith(SELF_EDIT_PREFIX) === true
  const isCoreProject = prefetchedProject?.settings?.is_core === true
  const isSelfEdit = isSelfEditByTitle || isCoreProject
  console.log('[StreamV2] self-edit detection:', {
    chatId,
    titleStartsWithPrefix: isSelfEditByTitle,
    projectIsCore: isCoreProject,
    finalIsSelfEdit: isSelfEdit,
  })

  // Permission gates (mirror v1)
  if (isMonitored(getUserRole(dbUser)) && isSelfEdit) {
    return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
  }
  if (isSelfEdit && !hasPermission(getUserRole(dbUser), 'self_edit')) {
    return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
  }

  // For project chats, ensure we actually have a project to operate on.
  let project = null
  if (!isSelfEdit) {
    if (!chat.project_id) {
      return handleCORS(NextResponse.json({ error: 'Chat is not linked to a project' }, { status: 400 }))
    }
    project = prefetchedProject || (await db.projects.findById(chat.project_id))
    if (!project) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }
  }

  // Persist the user message before streaming (mirrors v1)
  const userMessage = await db.messages.create({
    chat_id: chatId,
    project_id: chat.project_id,
    role: 'user',
    content: metadata.displayContent || content,
    metadata: { ...metadata, ...(isSilent ? { silent: true, full_content: content } : {}), agent_version: 'v2' },
  })
  await db.chats.update(chatId, { updated_at: new Date().toISOString() })

  // Pick provider + model — default to Claude Sonnet 4.5 for self-edit
  const providerName = metadata.provider || 'anthropic'
  const modelName = metadata.model || (providerName === 'anthropic' ? 'claude-sonnet-4-5-20250929' : 'gpt-4o')
  const apiKey = providerName === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : providerName === 'openai'
      ? process.env.OPENAI_API_KEY
      : (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)

  if (!apiKey) {
    return handleCORS(NextResponse.json({
      error: `No API key configured for provider "${providerName}"`,
    }, { status: 500 }))
  }

  // Credit pre-check
  const estimatedCost = estimateRequestCost(modelName, metadata.visualMode)
  let creditBalance = null
  try {
    creditBalance = await creditsDb.getBalance(dbUser.id)
  } catch (e) {
    console.warn('[StreamV2] balance check failed, proceeding:', e?.message)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: keepalive\ndata: {}\n\n`))
        } catch {
          closed = true
          clearInterval(heartbeat)
        }
      }, 8000)

      // Track whether a `done` event has been emitted on this stream.
      // If finish() runs without one (e.g. db persist failed in the
      // catch path), we synthesize a `done` so the client doesn't
      // fall into the 20-30s "stream timeout" recovery polling and
      // surface the misleading 'Build completed but the connection
      // timed out' toast.
      let doneSent = false
      const send = (event, data) => {
        if (closed) return
        if (event === 'done') doneSent = true
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const finish = () => {
        if (closed) return
        // Last-resort: any code path that reaches finish() without
        // having sent a `done` event would leave the client polling
        // for recovery and surfacing 'stream timeout'. Synthesize
        // one here so every stream guarantees a terminal event.
        if (!doneSent) {
          try {
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ content: '', _synthetic_terminal: true })}\n\n`))
          } catch { /* controller may already be closing */ }
          doneSent = true
        }
        closed = true
        clearInterval(heartbeat)
        try { controller.close() } catch {}
      }

      // Surface user message immediately (mirrors v1 UX)
      if (!isSilent) {
        send('user_message', { id: userMessage.id, content: userMessage.content, created_at: userMessage.created_at })
      }

      // Credit exhaustion: short-circuit
      if (creditBalance && creditBalance.balance < estimatedCost && !isSilent) {
        const upsellContent = `I'd love to help, but you're out of credits. You need at least **${estimatedCost}** credits for this request (current balance: **${creditBalance.balance.toFixed(2)}**).\n\nTap **Buy Credits** to top up and keep building!`
        const upsellMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: upsellContent,
          metadata: { credits_exhausted: true, required: estimatedCost, balance: creditBalance.balance, streamed: true, agent_version: 'v2' },
        })
        send('token', { content: upsellContent })
        send('credits_exhausted', { balance: creditBalance.balance, required: estimatedCost, messageId: upsellMessage.id })
        send('done', { content: upsellContent, messageId: upsellMessage.id, credits_exhausted: true })
        send('message_saved', { id: upsellMessage.id, credits_exhausted: true })
        return finish()
      }

      // ── Proactive fork check: warn before hitting context limits ──
      // Load full message history to calculate token usage
      const allMessages = await db.messages.findByChatId(chatId)
      const forkCheck = checkForkNeeded(allMessages, modelName)
      
      // If critical (>85%), block the request and force fork
      if (forkCheck.critical) {
        const forkWarning = `⚠️ **Conversation Too Long**\n\n${forkCheck.message}\n\nClick the **Fork** button below to continue in a new chat. I'll write a summary of what we've built so you can pick up right where we left off.`
        const warnMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: forkWarning,
          metadata: { fork_warning: true, tokens_used: forkCheck.tokensUsed, limit: forkCheck.limit, streamed: true, agent_version: 'v2' }
        })
        send('token', { content: forkWarning })
        send('fork_required', { tokensUsed: forkCheck.tokensUsed, limit: forkCheck.limit, percentage: forkCheck.percentage })
        send('done', { content: forkWarning, messageId: warnMessage.id, fork_required: true })
        send('message_saved', { id: warnMessage.id, fork_required: true })
        return finish()
      }
      
      // Soft warning at 70-85%: let the request proceed but notify user
      if (forkCheck.needsFork && !forkCheck.critical) {
        send('fork_suggested', { 
          tokensUsed: forkCheck.tokensUsed, 
          limit: forkCheck.limit, 
          percentage: forkCheck.percentage,
          message: forkCheck.message 
        })
      }

      send('status', { stage: 'agent_starting', detail: 'Starting v2 agent…' })

      let scope, writer, reader, writerKind, systemPrompt
      const detected = detectCodebaseRoot()

      // ── Attachment metadata: hoisted so BOTH self-edit and project ──
      // branches populate the same variable. Previously project mode
      // declared `const allAttachments` inside its else-block, the
      // const went out of scope before line ~969, and the outer
      // self-edit `let allAttachments = []` reached buildDefaultToolset
      // empty. Result: project chats never got the
      // submit_screenshot_inventory tool registered, so the anti-
      // fabrication gate never fired in user-project chats. Users saw
      // the model invent screenshot contents (reported 2026-05-24 in
      // the Nexsara chat). Hoisting fixes both branches with one var.
      let allAttachments = []
      let historicalAttachments = []

      if (isSelfEdit) {
        // ── Self-edit (Core System) — operates on Auroraly's own source ──
        scope = buildSelfEditScope(detected.root)
        writer = null
        reader = null
        writerKind = 'fs'
        if (!detected.isPersistent) {
          const ghWriter = buildGithubWriter()
          const ghReader = buildGithubReader()
          if (ghWriter && ghReader) {
            writer = ghWriter
            reader = ghReader
            writerKind = 'github'
          } else {
            const missing = []
            if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN')
            if (!process.env.GITHUB_REPO) missing.push('GITHUB_REPO')
            writer = buildMissingConfigWriter(missing)
            reader = null
            writerKind = 'missing-config'
          }
        }
        systemPrompt = buildSelfEditSystemPrompt({
          root: detected.root,
          writerKind,
          readerKind: reader ? 'github' : 'fs',
          repo: writer?.repo || reader?.repo,
          branch: writer?.branch || reader?.branch,
        })
        console.log('[StreamV2] mode=self-edit env:', { root: detected.root, source: detected.source, isPersistent: detected.isPersistent, writerKind })
        send('status', {
          stage: 'env_detected',
          detail: `Mode: self-edit · Root: ${detected.root} · reads: ${reader ? `${reader.repo}@${reader.branch} via GitHub` : 'local filesystem'} · writes: ${writerKind === 'fs' ? 'local filesystem' : writerKind === 'github' ? `${writer.repo}@${writer.branch} via GitHub` : 'NOT CONFIGURED (read-only)'}`,
        })
      } else {
        // ── Project mode — operates on user-project files in Supabase ──
        const projectFs = buildProjectFs({ db, projectId: chat.project_id, projectName: project?.name })
        if (!projectFs) {
          send('error', { message: 'Failed to initialize project file adapter', error_type: 'project_fs_init' })
          return finish()
        }
        // Scope is nominal (we never touch the disk in project mode) but tools
        // expect a scope object — use the project root as a sentinel.
        scope = { rootDirs: ['/project-' + chat.project_id], excludePaths: [] }
        writer = projectFs
        reader = projectFs
        writerKind = 'project-fs'
        
        // ── Detect project framework/type from files ──────────────────
        // Best-effort: if this fails, the prompt still works but won't
        // have framework context. Never crash the chat on detection.
        let projectContext = null
        try {
          projectContext = await detectProjectFramework(projectFs)
        } catch (e) {
          console.warn('[StreamV2] framework detection failed:', e?.message)
        }
        
        // ── Collect attachments from recent history (last 5 user messages) ──
        // Must be done BEFORE buildProjectSystemPrompt so hasAttachments flag is correct.
        // `historicalAttachments` and `allAttachments` are hoisted to the outer
        // scope so buildDefaultToolset(...) below sees them in BOTH modes.
        try {
          const recentUserMessages = await db.messages.findByChatId(chatId)
          const userMessagesWithAttachments = (recentUserMessages || [])
            .filter((m) => m.role === 'user' && m.id !== userMessage.id && m.metadata?.attachments)
            .slice(-5) // last 5 user messages with attachments
          for (const msg of userMessagesWithAttachments) {
            if (Array.isArray(msg.metadata.attachments)) {
              historicalAttachments.push(...msg.metadata.attachments)
            }
          }
        } catch (e) {
          console.warn('[StreamV2] failed to load historical attachments:', e?.message)
        }
        
        // Merge current-turn attachments with historical ones (current turn first)
        allAttachments = [
          ...(Array.isArray(metadata.attachments) ? metadata.attachments : []),
          ...historicalAttachments,
        ]
        
        systemPrompt = buildProjectSystemPrompt({
          projectId: chat.project_id,
          projectName: project?.name,
          projectContext,
          hasImages: Array.isArray(metadata.attachments) && metadata.attachments.some((a) => a?.file_category === 'image' || a?.type?.startsWith('image/')),
          hasAttachments: allAttachments.length > 0,
          includeInvestigationRule: true, // always include for now; can be made conditional later
        })
        console.log('[StreamV2] mode=project env:', { 
          projectId: chat.project_id, 
          projectName: project?.name,
          detectedFramework: projectContext?.framework || 'unknown',
        })
        send('status', {
          stage: 'env_detected',
          detail: `Mode: project "${project?.name || chat.project_id}" · ${projectContext?.framework ? `${projectContext.framework} detected` : 'framework detection pending'} · all reads/writes go to project files`,
        })
      }

      // Build provider + tools
      let provider
      try {
        provider = createProvider(providerName, apiKey, modelName, {})
      } catch (e) {
        send('error', { message: 'Provider init failed: ' + (e?.message || 'unknown'), error_type: 'provider_init' })
        return finish()
      }
      // ── Core System self-edit guards: pass the prior-messages array
      // so the write tools can look for `CONFIRMED: <path>` confirmations
      // before allowing writes to protected paths / dependency adds.
      // priorMessages is loaded a few lines below, but tools must be
      // constructed now (effectiveTools filtering happens here too).
      // We pass an object reference and mutate priorMessages on it
      // later — the tool .execute() closures read guardCtx at call
      // time, not at construction time, so the late mutation lands.
      const guardCtx = isSelfEdit
        ? { isSelfEdit: true, priorMessages: [] }
        : null
      
      // ── Collect attachments from recent history (self-edit mode only) ──
      // For project mode, allAttachments was already populated above (before
      // buildProjectSystemPrompt). For self-edit, populate the hoisted
      // outer-scope vars here. Same merge order: current turn first.
      if (isSelfEdit) {
        try {
          const recentUserMessages = await db.messages.findByChatId(chatId)
          const userMessagesWithAttachments = (recentUserMessages || [])
            .filter((m) => m.role === 'user' && m.id !== userMessage.id && m.metadata?.attachments)
            .slice(-5) // last 5 user messages with attachments
          for (const msg of userMessagesWithAttachments) {
            if (Array.isArray(msg.metadata.attachments)) {
              historicalAttachments.push(...msg.metadata.attachments)
            }
          }
        } catch (e) {
          console.warn('[StreamV2] failed to load historical attachments:', e?.message)
        }
        
        // Merge current-turn attachments with historical ones (current turn first)
        allAttachments = [
          ...(Array.isArray(metadata.attachments) ? metadata.attachments : []),
          ...historicalAttachments,
        ]
      }
      
      // ── Diagnostic: surface attachment metadata BEFORE tool construction ──
      console.log('[StreamV2] attachment metadata received:', {
        currentTurnCount: Array.isArray(metadata.attachments) ? metadata.attachments.length : 0,
        historicalCount: historicalAttachments.length,
        totalAvailable: allAttachments.length,
        currentFilenames: Array.isArray(metadata.attachments)
          ? metadata.attachments.map((a) => a.filename || a.name || 'unnamed')
          : [],
        historicalFilenames: historicalAttachments.map((a) => a.filename || a.name || 'unnamed'),
      })
      const tools = buildDefaultToolset(scope, writer, reader, allAttachments.length > 0 ? allAttachments : null, guardCtx)
      // Surface in Vercel logs so we can confirm save_attachment_to_path
      // is actually being exposed to the model on attachment turns. If
      // the user reports "agent says it can't save binaries" but this
      // log shows save_attachment_to_path=true, the model is ignoring
      // the tool and we need a stricter system prompt (not a wiring fix).
      console.log('[StreamV2] tools exposed:', {
        count: tools.length,
        names: tools.map((t) => t.name),
        hasAttachments: Array.isArray(metadata.attachments) ? metadata.attachments.length : 0,
        saveAttachmentToolPresent: tools.some((t) => t.name === 'save_attachment_to_path'),
      })

      // ── Self-edit watchdog: snapshot main's HEAD before the agent
      // touches anything. If the turn's commits end up breaking the
      // live deploy (build passes but runtime fails), we'll force-
      // revert back to this SHA after a health-check probe. Only
      // engaged for GitHub-backed self-edit turns — local FS and
      // project-fs paths skip it.
      let watchdogBeforeSha = null
      if (isSelfEdit && writerKind === 'github' && writer?.repo) {
        watchdogBeforeSha = await captureBeforeSha({
          repo: writer.repo,
          branch: writer.branch || 'main',
        })
      }
      // Project mode: run_command is not meaningful (no shell on the project
      // files in the DB). Filter it out so the model can't waste turns.
      const effectiveTools = isSelfEdit ? tools : tools.filter((t) => t.name !== 'run_command')

      // ── Load prior chat history ─────────────────────────────────
      // Always coerce to an array; loadPriorMessages already guards but
      // a single null escape would crash `runAgent` with the misleading
      // 'priorMessages is not defined' ReferenceError that users were
      // seeing in project chats. Belt + suspenders here is cheap.
      let priorMessages = (await loadPriorMessages(db, chatId, userMessage.id)) || []
      if (!Array.isArray(priorMessages)) priorMessages = []

      // ── Strip verbose tool results ─────────────────────────────
      // Trim down assistant messages that contain large tool results
      // (read_file output, etc.) to just a preview. The full content was
      // already shown inline on the turn it was called, so keeping 50KB
      // of file content in every subsequent turn is wasteful. This runs
      // BEFORE compaction so the compactor sees the already-trimmed
      // history (lower token count = less likely to trigger compaction).
      priorMessages = stripVerboseToolResults(priorMessages)

      // ── Context compaction ─────────────────────────────────────
      // If the conversation has grown past ~130K tokens, summarize the
      // older messages with Haiku and replace them with a single
      // PRIOR CONTEXT SUMMARY block. This keeps long chats under the
      // 200K Anthropic ceiling indefinitely. Done BEFORE guardCtx is
      // populated so the guards see the compacted history (which is
      // fine — CONFIRMED tokens in the recent tail are preserved).
      try {
        // Reuse the same provider config (API key + provider name) for
        // the Haiku summarizer — same Anthropic credentials, different
        // model. If creating the Haiku provider fails for any reason,
        // compactor handles it gracefully and the turn falls through.
        let summaryProvider = null
        try {
          summaryProvider = createProvider(providerName, apiKey, 'claude-haiku-4-5-20251001', {})
        } catch { summaryProvider = null }
        const { messages: compacted, didCompact, decision } = await maybeCompactPriorMessages(
          priorMessages,
          summaryProvider,
        )
        if (didCompact && Array.isArray(compacted)) {
          console.log('[StreamV2] context compacted:', {
            before_messages: priorMessages.length,
            after_messages: compacted.length,
            estimated_tokens_before: decision.totalTokens,
            split_at: decision.splitAt,
          })
          priorMessages = compacted
        }
      } catch (err) {
        // Compaction is best-effort. If it fails we just send the
        // un-compacted history and let Anthropic surface the 200K
        // error (now classified more clearly — see errors.js).
        console.warn('[StreamV2] compaction skipped:', err?.message)
      }

      // ── Image-replay stripping ─────────────────────────────────
      // Drop image bytes from history that have already been processed
      // via a submit_screenshot_inventory tool call. Saves ~1500 tokens
      // per inventoried image per turn. Best-effort: any failure falls
      // through with the original messages — never crash the chat.
      try {
        const stripResult = stripInventoriedImages(priorMessages)
        if (stripResult && Array.isArray(stripResult.messages) && stripResult.droppedImages > 0) {
          console.log('[StreamV2] image-replay stripped:', {
            dropped_images: stripResult.droppedImages,
            estimated_tokens_freed: stripResult.freedTokensEstimate,
          })
          priorMessages = stripResult.messages
        }
      } catch (err) {
        console.warn('[StreamV2] image-replay strip skipped:', err?.message)
      }

      // Final defensive snapshot — `priorMessages` is now frozen as
      // the value we'll pass to runAgent. If anything above produced
      // a non-array, fall back to [] so spread (`...priorMessages`)
      // inside agent-core.js cannot throw.
      if (!Array.isArray(priorMessages)) priorMessages = []

      // Now that priorMessages is loaded, populate guardCtx.priorMessages
      // AND append a synthetic "current user message" so a CONFIRMED:
      // typed in the same turn as the protected-path request still
      // satisfies the gate (most users will type it in one message,
      // not in a separate prior turn).
      if (guardCtx) {
        const synthesizedCurrent = { role: 'user', content: typeof content === 'string' ? content : '' }
        guardCtx.priorMessages = [...priorMessages, synthesizedCurrent]
      }

      // Format current user message with attachments (if any) for vision +
      // text/pdf support. Shared helper keeps history + current path in sync.
      let currentUserMessage = content
      if (metadata.attachments && Array.isArray(metadata.attachments) && metadata.attachments.length > 0) {
        const built = buildUserContent(content, metadata.attachments, 'StreamV2/current')
        if (Array.isArray(built)) {
          const imageCount = built.filter((b) => b.type === 'image').length
          const textBlockCount = built.filter((b) => b.type === 'text').length
          console.log('[StreamV2] attachments → content blocks:', { total: metadata.attachments.length, images: imageCount, textBlocks: textBlockCount })
          // ── Per-turn forcing reminder ──────────────────────────────
          // When images are on the current turn, prepend a short, sharp
          // instruction at the TOP of the content array (before the
          // image blocks themselves). The system prompt already
          // describes the protocol but the model's attention is
          // dominated by recent content, so we repeat the gate inline
          // exactly where the screenshot lands. This is the difference
          // between the model "knowing" the rule and the model
          // EXECUTING the rule.
          if (imageCount > 0) {
            built.unshift({
              type: 'text',
              text: [
                `[SYSTEM REMINDER — ${imageCount} screenshot${imageCount === 1 ? '' : 's'} attached this turn]`,
                'You MUST execute the screenshot analysis protocol from your system prompt BEFORE any other response:',
                '  1. INVENTORY FIRST — literal description of every UI element, text label, position, state, and what is cropped/cut-off. Quote exact text.',
                '  2. COMPARISON — match the inventory against what the user said should be there. State matches and mismatches one by one.',
                '  3. TRUTH-CHECK GATE — if the inventory shows ANY problems (cropped, misaligned, missing, errors, etc.) you are FORBIDDEN from saying "looks perfect", "that\'s fixed", "it\'s working now", or any positive assessment. State the problems instead.',
                '  4. LAYOUT NOTES — store key positions for cross-turn tracking.',
                '  5. DEFAULT SKEPTICISM — if your last turn was a code change, assume it did NOT work until the inventory proves it did.',
                'Do steps 1–4 in your visible response, in order, before any conclusion. Skipping is fabrication.',
              ].join('\n'),
            })
          }
          currentUserMessage = built
        } else {
          console.warn('[StreamV2] attachments present but no content blocks produced. Filenames:', metadata.attachments.map((a) => a.filename))
        }
      }

      // Stream the agent loop
      let fullContent = ''
      let toolEventCount = 0
      let errored = false

      // Format tool arguments for inline visibility — keep it compact,
      // NEVER fall back to raw JSON (which feels like the AI is dumping code
      // at the user). Unknown args render as just an arg count.
      const summarizeArgs = (args) => {
        try {
          if (!args || typeof args !== 'object') return ''
          if (args.path) return ` ${args.path}`
          if (args.name_pattern) return ` "${args.name_pattern}"`
          if (args.pattern) return ` "${args.pattern}"`
          if (args.command) return ` ${String(args.command).slice(0, 80)}`
          if (args.old_str) return ' (edit)'
          const keys = Object.keys(args)
          if (keys.length === 0) return ''
          return ` (${keys.length} arg${keys.length === 1 ? '' : 's'})`
        } catch { return '' }
      }
      const summarizeResult = (content) => {
        const s = typeof content === 'string' ? content : String(content || '')
        const firstLine = s.split('\n').find((l) => l.trim().length > 0) || ''
        const trimmed = firstLine.slice(0, 120)
        const total = s.length
        return total > trimmed.length ? `${trimmed} … (${total} chars)` : trimmed
      }

      // Track tool_use args by id so we can pair them with their
      // tool_result (used to emit files_saved after successful project
      // writes — which is what makes the preview iframe refresh).
      const pendingToolArgs = new Map()

      // ── Force-first-tool-call gating ────────────────────────────
      // When the current user turn includes ≥1 image, lock the model's
      // first reply to a call to submit_screenshot_inventory. This is
      // the structural anti-fabrication gate — the model literally
      // cannot emit prose until it has filled out the inventory's
      // structured fields. Subsequent iterations are 'auto'.
      let forceFirstToolCall = null
      // ── Diagnostic logging for anti-fabrication gate (2026-05-28) ──
      // User reported the model fabricating screenshot contents AFTER
      // four layers of defense shipped. To distinguish "gate fired but
      // model fabricated anyway" from "gate didn't fire at all", log
      // EVERY decision branch so the deploy logs tell us which.
      const inventoryToolPresent = effectiveTools.some((t) => t.name === 'submit_screenshot_inventory')
      if (Array.isArray(metadata.attachments) && metadata.attachments.length > 0) {
        const imageAttachments = metadata.attachments.filter((a) =>
          a?.file_category === 'image' ||
          a?.type?.startsWith('image/') ||
          a?.mime_type?.startsWith('image/'),
        )
        const hasImage = imageAttachments.length > 0
        console.log('[StreamV2] anti-fabrication gate decision:', {
          totalAttachments: metadata.attachments.length,
          imageAttachments: imageAttachments.length,
          imageFilenames: imageAttachments.map((a) => a?.filename || '?').slice(0, 5),
          inventoryToolRegistered: inventoryToolPresent,
          historicalAttachmentsMerged: historicalAttachments.length,
          allAttachmentsLength: allAttachments.length,
          willForce: hasImage && inventoryToolPresent,
        })
        if (hasImage && inventoryToolPresent) {
          forceFirstToolCall = 'submit_screenshot_inventory'
          console.log('[StreamV2] forcing first tool call → submit_screenshot_inventory (anti-fabrication gate)')
        } else if (hasImage && !inventoryToolPresent) {
          console.warn('[StreamV2] ⚠ GATE FAILED TO FIRE: image attachments present but submit_screenshot_inventory tool not registered. allAttachments.length =', allAttachments.length, 'isSelfEdit =', isSelfEdit)
        }
      } else {
        console.log('[StreamV2] no attachments on this turn — no gate to fire')
      }

      try {
        for await (const ev of runAgent({
          provider,
          systemPrompt,
          userMessage: currentUserMessage,
          priorMessages,
          tools: effectiveTools,
          maxIterations: 100,
          forceFirstToolCall,
        })) {
          if (closed) break
          if (ev.type === 'text_delta') {
            fullContent += ev.content
            send('token', { content: ev.content })
          } else if (ev.type === 'tool_use') {
            toolEventCount++
            pendingToolArgs.set(ev.id, { name: ev.name, args: ev.args })
            // Make tool calls VISIBLE inline as markdown blockquotes so the
            // user can see what the agent is actually doing instead of
            // staring at disconnected narration.
            const inline = `\n\n> 🔧 **${ev.name}**${summarizeArgs(ev.args)}\n\n`
            fullContent += inline
            send('token', { content: inline })
            send('status', { stage: 'tool_use', detail: `${ev.name}${summarizeArgs(ev.args)}` })
            send('tool_use', { name: ev.name, id: ev.id, args: ev.args })
          } else if (ev.type === 'tool_result') {
            // For read_file: render the FULL file content inline so the
            // user can actually see it (Emergent-style). Without this,
            // Claude saw the file via the tool result, assumed the user
            // saw it too (they didn't — UI was showing only the summary),
            // and ended the turn without re-pasting. Showing the full
            // content here removes the ambiguity entirely.
            //
            // For all other tools, keep the compact summary so the chat
            // isn't spammed with raw command output.
            const pendingForResult = pendingToolArgs.get(ev.id)
            const isReadFile = pendingForResult?.name === 'read_file'
            const inline = isReadFile
              ? `> ↳ ${pendingForResult?.args?.path || 'file'}\n\n${ev.content}\n\n`
              : `> ↳ ${summarizeResult(ev.content)}\n\n`
            fullContent += inline
            send('token', { content: inline })
            send('tool_result', { name: ev.name, id: ev.id, content: ev.content })

            // Preview-refresh hook: when the agent successfully writes,
            // edits, or deletes a PROJECT file, emit files_saved so the
            // dashboard re-fetches files and reloads the iframe. Without
            // this, edits persist to Supabase but the preview keeps
            // showing the stale version — which makes it look like the
            // edit silently failed.
            if (!isSelfEdit && (ev.name === 'write_file' || ev.name === 'edit_file' || ev.name === 'delete_file')) {
              const resultStr = typeof ev.content === 'string' ? ev.content : String(ev.content || '')
              const looksSuccessful = !resultStr.startsWith('Error') && !resultStr.includes('Error executing')
              if (looksSuccessful) {
                const pending = pendingToolArgs.get(ev.id)
                const filePath = pending?.args?.path
                const action = ev.name === 'write_file' ? 'write'
                  : ev.name === 'edit_file' ? 'edit'
                  : 'delete'
                send('files_saved', {
                  paths: filePath ? [filePath] : [],
                  action,
                  agent_version: 'v2',
                })
                // ── Poke the Fly preview runner ────────────────────────
                // The runner has its own on-disk copy of the project. We
                // ping /sync-from-supabase so it re-pulls the just-edited
                // file and Vite HMR shows the change. Fire-and-forget:
                // never block the chat stream on preview infra latency.
                notifyPreviewOfFileChange(chat.project_id, {
                  changedPaths: filePath ? [filePath] : [],
                })
                  .then((r) => {
                    if (r.notified) {
                      console.log(`[StreamV2] preview synced for project ${chat.project_id} (machine ${r.machineId})`)
                      send('status', { stage: 'preview_synced', detail: `Preview hot-reloaded (machine ${r.machineId?.slice(0, 8)})` })
                    } else {
                      console.log(`[StreamV2] preview not synced for project ${chat.project_id}: ${r.reason}`)
                    }
                    if (r.requiresRestart) {
                      // package.json changed → the runner only runs
                      // `npm install` on cold boot, so a hot sync alone
                      // won't pick up newly added dependencies. Surface
                      // this loudly to the user so they don't waste a
                      // minute debugging "why isn't my new package
                      // working" — the answer is always "click Hard
                      // Reset → Start Preview".
                      send('status', {
                        stage: 'deps_changed',
                        detail: '📦 package.json changed — click Hard Reset → Start Preview to install new dependencies.',
                      })
                    }
                  })
                  .catch((err) => console.warn('[StreamV2] preview notify crashed:', err?.message))
              }
            }
            pendingToolArgs.delete(ev.id)
          } else if (ev.type === 'done') {
            send('status', { stage: 'complete', detail: 'Done.' })
          } else if (ev.type === 'error') {
            errored = true
            const inline = `\n\n> ⚠️ ${ev.message}\n`
            fullContent += inline
            send('token', { content: inline })
            send('error', { message: ev.message, error_type: 'agent_error' })
          }
        }
      } catch (e) {
        errored = true
        // Log the full stack so we can debug recurring crashes from
        // Vercel logs. The string `e?.message` alone strips line/file
        // context that V8 ReferenceErrors normally carry.
        console.error('[StreamV2] agent loop crashed:', {
          message: e?.message,
          name: e?.name,
          stack: e?.stack,
        })
        send('error', { message: 'Agent loop crashed: ' + (e?.message || 'unknown'), error_type: 'agent_crash' })
      }

      // Empty-response fallback — never persist a literally-empty assistant
      // turn. Surface what happened so the user sees a real message.
      if (!fullContent.trim()) {
        fullContent = errored
          ? '_(the agent encountered an error before producing a response — see above)_'
          : '_(the agent finished without producing a text response — try rephrasing or asking a more specific question)_'
        send('token', { content: fullContent })
      }

      // Persist the assistant message
      try {
        if (!errored || fullContent) {
          const assistantMessage = await db.messages.create({
            chat_id: chatId,
            project_id: chat.project_id,
            role: 'assistant',
            content: fullContent || '(no response)',
            metadata: {
              streamed: true,
              agent_version: 'v2',
              provider: providerName,
              model: modelName,
              toolCalls: toolEventCount,
            },
          })
          send('done', { content: fullContent, messageId: assistantMessage.id })
          send('message_saved', { id: assistantMessage.id, generatedFiles: [] })

          // Deduct credits (fire-and-forget)
          creditsDb.deductCredits(dbUser.id, 'chat_message', { model: modelName }).then((result) => {
            if (!result.error) {
              send('credits_update', { balance: result.balance, cost: result.cost, model: modelName })
            }
          }).catch((e) => console.warn('[StreamV2] credit deduct failed:', e?.message))
        }
      } catch (e) {
        console.error('[StreamV2] persist failed:', e)
        send('error', { message: 'Failed to save assistant message: ' + (e?.message || 'unknown'), error_type: 'persist_failed' })
        // Even on persist failure, emit `done` so the client doesn't
        // hang in the SSE recovery loop and surface 'stream timeout'.
        // The content we have in-memory is still useful to the user.
        send('done', { content: fullContent || '', _persist_failed: true })
      }

      // ── Self-edit watchdog: schedule the health-check + auto-revert.
      // Fire-and-forget. The chat stream finishes immediately; the
      // watchdog runs in the background, polls /api/health on prod
      // once Vercel's had time to deploy, and force-reverts the
      // branch ref if health stays 5xx. We pipe its events through
      // the SSE channel ONLY if the stream is still open — most of
      // the time the response has already closed by the time the
      // watchdog fires (45s+), in which case the events just hit
      // Vercel logs for postmortem.
      if (isSelfEdit && watchdogBeforeSha && writerKind === 'github' && writer?.repo) {
        const healthUrl = process.env.SELF_EDIT_HEALTH_URL
          || (process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/api/health` : null)
          || 'https://www.auroraly.co/api/health'
        scheduleHealthCheck({
          repo: writer.repo,
          branch: writer.branch || 'main',
          beforeSha: watchdogBeforeSha,
          healthUrl,
          onStatus: (event) => {
            // Best-effort: surface watchdog events to the user. Most
            // will fire after the stream has closed, which is fine —
            // they still land in Vercel logs.
            try { send('status', { stage: event.stage, detail: JSON.stringify(event) }) } catch {}
          },
        }).catch((e) => console.warn('[StreamV2] watchdog crashed:', e?.message))
      }

      finish()
    },
  })

  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
  return handleCORS(response)
}
