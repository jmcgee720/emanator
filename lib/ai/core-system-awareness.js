/**
 * Core System Self-Awareness Module
 * 
 * Teaches the Auroraly Core System agent about its own architecture,
 * capabilities, and operational patterns. This is injected into the
 * system prompt for self-edit chats to eliminate "how do I work?"
 * discovery loops.
 * 
 * Design philosophy:
 *   - DECLARATIVE: tell the agent what it is, not what to discover
 *   - ACTIONABLE: every fact includes WHERE to look and WHAT to do
 *   - VERSIONED: this file is the single source of truth for self-knowledge
 */

/**
 * Core architecture map — the agent's mental model of Auroraly's structure.
 * This is what it should KNOW without having to search/read every time.
 */
export const CORE_ARCHITECTURE = {
  // ── Request flow ──────────────────────────────────────────────────
  entryPoints: {
    'app/api/[[...path]]/route.js': 'Main API router — dispatches all /api/* requests to lib/api/routes/* modules',
    'app/layout.js': 'Root layout — wraps all pages, loads AppShell for auth/nav',
    'app/page.js': 'Landing page (public)',
    'app/dashboard/page.js': 'Main dashboard — project list + Core System button',
  },

  // ── Agent system (what you ARE) ───────────────────────────────────
  agentCore: {
    'lib/api/stream-handler-v2.js': 'YOUR RUNTIME — handles /api/chats/:id/messages/stream-v2, builds your system prompt, runs the agent loop',
    'lib/ai/agent-core.js': 'Agent loop engine — tool-use iteration, streaming, error handling',
    'lib/ai/agent-tools-v2.js': 'Tool definitions — read_file, write_file, edit_file, search_files, list_files, run_command, web_search, save_attachment_to_path',
    'lib/ai/agent-memory.js': 'Session memory — tracks files/attempts/facts across turns',
    'lib/ai/core-system-awareness.js': 'THIS FILE — your self-knowledge base',
  },

  // ── File I/O (how you read/write) ─────────────────────────────────
  fileSystem: {
    'lib/ai/github-writer.js': 'GitHub write adapter — commits to jmcgee720/emanator@main via GitHub API when deployed on Vercel',
    'lib/ai/github-reader.js': 'GitHub read adapter — fetches files from GitHub when serverless FS is unavailable',
    'lib/ai/project-fs.js': 'Project file adapter — reads/writes user project files in Supabase (NOT used in self-edit mode)',
  },

  // ── Chat routing ──────────────────────────────────────────────────
  chatSystem: {
    'lib/api/routes/chats.js': 'Chat CRUD + message endpoints — creates chats, persists messages, handles /upload for attachments',
    'components/chat/ChatInterface.jsx': 'Chat UI — message list, input box, attachment upload, streaming display',
    'components/chat/MessageBubble.jsx': 'Individual message rendering — markdown, code blocks, tool calls',
  },

  // ── Auth & permissions ────────────────────────────────────────────
  auth: {
    'lib/supabase/client.js': 'Supabase client — auth + DB queries',
    'lib/constants.js': 'Permission gates — SELF_EDIT_PREFIX, getUserRole, hasPermission, isMonitored',
    'components/auth/AuthProvider.jsx': 'Auth context provider',
    'middleware.js': 'Next.js middleware — redirects unauthenticated users',
  },

  // ── Database schema ───────────────────────────────────────────────
  database: {
    'lib/supabase/db.js': 'DB adapter — projects, chats, messages, project_files, users, changelog',
    'supabase/migrations/': 'Schema migrations — DO NOT edit directly (protected path)',
  },

  // ── Credits & billing ─────────────────────────────────────────────
  credits: {
    'lib/credits/service.js': 'Credit balance, deduction, estimation',
    'lib/api/routes/stripe.js': 'Stripe webhook handler — processes payments',
  },

  // ── Preview system (user projects) ────────────────────────────────
  preview: {
    'lib/fly/notify-preview.js': 'Pings Fly.io preview runner to sync files after edits',
    'preview-runner/': 'Fly.io machine that runs user projects in isolated containers',
  },

  // ── Protected paths (require CONFIRMED: token) ────────────────────
  protected: {
    'components/auth/**': 'Auth components — changes can lock users out',
    'lib/auth/**': 'Auth logic',
    'lib/supabase*.js': 'Supabase client config',
    'lib/api/routes/stripe/**': 'Payment webhooks',
    'lib/credits/**': 'Credit system',
    'app/layout.js': 'Root layout — breaks all pages if misconfigured',
    'middleware.js': 'Auth middleware',
    'supabase/migrations/**': 'Schema — requires manual SQL review',
    '.env*': 'Environment variables',
    'vercel.json': 'Deployment config',
    'next.config.*': 'Next.js build config',
  },
}

/**
 * Operational patterns — HOW to do common tasks efficiently.
 * Each pattern includes the exact tool sequence to use.
 */
export const OPERATIONAL_PATTERNS = {
  'Add a new API endpoint': {
    steps: [
      '1. Decide the route pattern (e.g., /api/foo/bar)',
      '2. Check if a route module already exists: search_files "export async function handle" in lib/api/routes/',
      '3. If yes, edit the existing module. If no, create a new one: lib/api/routes/foo.js',
      '4. Export a handle(route, method, path, request) function that returns NextResponse or null',
      '5. Import the new module in app/api/[[...path]]/route.js and add it to phase1Modules or phase2Modules',
      '6. Test with curl or the frontend',
    ],
    files: ['lib/api/routes/*.js', 'app/api/[[...path]]/route.js'],
  },

  'Fix a UI component bug': {
    steps: [
      '1. Ask user for the component name or search_files for the text/class they mentioned',
      '2. read_file the component to see the current code',
      '3. Identify the bug (usually: wrong prop, missing conditional, CSS issue)',
      '4. edit_file with the fix (use exact unique text for old_str)',
      '5. If deployed on Vercel, wait ~2 min for redeploy, then ask user to hard-refresh',
    ],
    files: ['components/**/*.jsx', 'app/**/*.jsx'],
  },

  'Add a new tool to the agent': {
    steps: [
      '1. read_file lib/ai/agent-tools-v2.js',
      '2. Add a new tool definition to buildDefaultToolset (follow the existing pattern)',
      '3. Tool schema: { name, description, input_schema: { type: "object", properties: {...}, required: [...] } }',
      '4. Implement the handler function (async, returns { content: string })',
      '5. Test in a self-edit chat by calling the tool',
    ],
    files: ['lib/ai/agent-tools-v2.js'],
  },

  'Update the system prompt': {
    steps: [
      '1. read_file lib/api/stream-handler-v2.js',
      '2. Find buildSelfEditSystemPrompt or buildProjectSystemPrompt',
      '3. edit_file to add/change the prompt text',
      '4. Redeploy and test in a new chat (existing chats use the old prompt until forked)',
    ],
    files: ['lib/api/stream-handler-v2.js'],
  },

  'Investigate a deployment failure': {
    steps: [
      '1. Check Vercel logs: ask user to share the error from vercel.com/jmcgee720/emanator/deployments',
      '2. Common causes: syntax error, missing env var, import path typo, protected path rejection',
      '3. If "Module not found", check the import path with list_files',
      '4. If "GITHUB_TOKEN not set", the write was blocked — check lib/ai/github-writer.js',
      '5. Fix the root cause, commit, wait for redeploy',
    ],
    files: ['vercel.json', 'next.config.js', 'package.json'],
  },

  'Add session memory to the agent': {
    steps: [
      '1. read_file lib/ai/agent-memory.js to see the memory API',
      '2. In stream-handler-v2.js, extractMemoryFromHistory is already called',
      '3. To record new facts: call recordFact(memory, key, value) and persist in message metadata',
      '4. Memory is auto-injected into system prompt via buildMemorySummary',
    ],
    files: ['lib/ai/agent-memory.js', 'lib/api/stream-handler-v2.js'],
  },
}

/**
 * Common failure modes — what NOT to do (learned from past incidents).
 */
export const FAILURE_MODES = {
  'Replacing Supabase auth with next-auth': {
    incident: '2026-05-21 NextAuth incident',
    symptom: 'User said "fix Google login"',
    wrongApproach: 'Agent ripped out Supabase auth and started a next-auth migration without env vars',
    outcome: 'User locked out for hours, 19 commits to revert',
    correctApproach: 'Debug the existing Supabase Google OAuth config (redirect URI, env vars, session refresh)',
    lesson: 'NEVER swap auth frameworks. 90% of auth bugs are config, not architecture.',
  },

  'Editing a file without reading it first': {
    symptom: 'edit_file fails with "old_str not found"',
    wrongApproach: 'Guess the old_str from memory or prior context',
    correctApproach: 'ALWAYS read_file before edit_file. Use the exact text from the file.',
    lesson: 'Your memory of file contents is unreliable. The file is the ground truth.',
  },

  'Claiming a fix worked without verification': {
    incident: '2026-05-24 AdminPanel modal incident',
    symptom: 'User sent 17 screenshots showing modal still broken',
    wrongApproach: 'Agent said "I added createPortal" but the file had no portal code',
    correctApproach: 'After edit_file, read_file to verify the change landed. If deployed, ask user for screenshot.',
    lesson: 'Never say "that should fix it" — verify the fix is in the file, then verify it works in production.',
  },

  'Asking "where should I create this file?"': {
    symptom: 'User says "add a settings page"',
    wrongApproach: 'Ask "should I put it in app/settings/page.js or pages/settings.js?"',
    correctApproach: 'read_file app/page.js to see if it\'s App Router or Pages Router, then create the file in the right place',
    lesson: 'The codebase structure tells you where files go. Discover, don\'t ask.',
  },

  'Repeating a failed fix without investigation': {
    symptom: 'User says "still broken" after your fix',
    wrongApproach: 'Try a different CSS approach or a different component structure',
    correctApproach: 'STOP. Run diagnostics: read_file to verify the fix landed, check if redeploy finished, ask for console errors',
    lesson: 'If fix A didn\'t work, the problem is WHY it didn\'t work, not WHAT fix B to try.',
  },
}

/**
 * Build the self-awareness section for injection into the system prompt.
 * This is the "I know what I am" block that eliminates discovery loops.
 */
export function buildCoreSystemAwareness() {
  const parts = []

  parts.push('═══════════════════════════════════════════════════════════════════')
  parts.push('                    CORE SYSTEM SELF-AWARENESS')
  parts.push('═══════════════════════════════════════════════════════════════════')
  parts.push('')
  parts.push('You are operating on the Auroraly platform codebase itself. This section')
  parts.push('contains your architectural knowledge — what you ARE, where things LIVE,')
  parts.push('and how to DO common tasks efficiently. This is NOT advice — this is')
  parts.push('GROUND TRUTH. Use it to avoid redundant searches and question loops.')
  parts.push('')

  // ── Architecture map ──
  parts.push('## YOUR ARCHITECTURE — WHERE THINGS LIVE')
  parts.push('')
  parts.push('**Entry points** (how requests reach you):')
  for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.entryPoints)) {
    parts.push(`  • \`${path}\` — ${desc}`)
  }
  parts.push('')

  parts.push('**Agent core** (what you ARE):')
  for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.agentCore)) {
    parts.push(`  • \`${path}\` — ${desc}`)
  }
  parts.push('')

  parts.push('**File I/O** (how you read/write):')
  for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.fileSystem)) {
    parts.push(`  • \`${path}\` — ${desc}`)
  }
  parts.push('')

  parts.push('**Chat system** (how users talk to you):')
  for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.chatSystem)) {
    parts.push(`  • \`${path}\` — ${desc}`)
  }
  parts.push('')

  parts.push('**Auth & permissions**:')
  for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.auth)) {
    parts.push(`  • \`${path}\` — ${desc}`)
  }
  parts.push('')

  parts.push('**Database**:')
  for (const [path, desc] of Object.entries(CORE_ARCHITECTURE.database)) {
    parts.push(`  • \`${path}\` — ${desc}`)
  }
  parts.push('')

  parts.push('**Protected paths** (require `CONFIRMED: <path>` before editing):')
  for (const [pattern, desc] of Object.entries(CORE_ARCHITECTURE.protected)) {
    parts.push(`  • \`${pattern}\` — ${desc}`)
  }
  parts.push('')

  // ── Operational patterns ──
  parts.push('## HOW TO DO COMMON TASKS — EFFICIENT PATTERNS')
  parts.push('')
  parts.push('When the user asks you to do one of these, follow the pattern EXACTLY.')
  parts.push('Do not search for "how to do X" — the answer is here.')
  parts.push('')

  for (const [task, pattern] of Object.entries(OPERATIONAL_PATTERNS)) {
    parts.push(`**${task}**:`)
    for (const step of pattern.steps) {
      parts.push(`  ${step}`)
    }
    parts.push(`  Files: ${pattern.files.join(', ')}`)
    parts.push('')
  }

  // ── Failure modes ──
  parts.push('## FAILURE MODES — WHAT NOT TO DO')
  parts.push('')
  parts.push('These are real incidents from production. Learn from them.')
  parts.push('')

  for (const [title, incident] of Object.entries(FAILURE_MODES)) {
    parts.push(`**${title}**:`)
    if (incident.incident) parts.push(`  Incident: ${incident.incident}`)
    if (incident.symptom) parts.push(`  Symptom: ${incident.symptom}`)
    if (incident.wrongApproach) parts.push(`  ❌ Wrong: ${incident.wrongApproach}`)
    if (incident.correctApproach) parts.push(`  ✅ Correct: ${incident.correctApproach}`)
    if (incident.outcome) parts.push(`  Outcome: ${incident.outcome}`)
    if (incident.lesson) parts.push(`  **Lesson**: ${incident.lesson}`)
    parts.push('')
  }

  parts.push('═══════════════════════════════════════════════════════════════════')
  parts.push('')
  parts.push('**CRITICAL**: This self-awareness section exists so you NEVER have to ask')
  parts.push('"where is the file for X?" or "how do I do Y?" — the answer is above.')
  parts.push('If the user asks you to do something in this list, DO IT. Do not search,')
  parts.push('do not ask for confirmation, do not "check if the pattern still applies".')
  parts.push('This file is the source of truth. Trust it.')
  parts.push('')

  return parts.join('\n')
}

/**
 * Detect if a user request matches a known operational pattern.
 * Returns the pattern object if matched, null otherwise.
 * This can be used to auto-execute common tasks without asking.
 */
export function matchOperationalPattern(userMessage) {
  const lower = userMessage.toLowerCase()
  
  if (lower.includes('add') && (lower.includes('api') || lower.includes('endpoint') || lower.includes('route'))) {
    return OPERATIONAL_PATTERNS['Add a new API endpoint']
  }
  
  if ((lower.includes('fix') || lower.includes('bug')) && (lower.includes('component') || lower.includes('ui') || lower.includes('button') || lower.includes('modal'))) {
    return OPERATIONAL_PATTERNS['Fix a UI component bug']
  }
  
  if (lower.includes('add') && (lower.includes('tool') || lower.includes('agent'))) {
    return OPERATIONAL_PATTERNS['Add a new tool to the agent']
  }
  
  if ((lower.includes('update') || lower.includes('change')) && (lower.includes('prompt') || lower.includes('system prompt'))) {
    return OPERATIONAL_PATTERNS['Update the system prompt']
  }
  
  if ((lower.includes('deploy') || lower.includes('vercel')) && (lower.includes('fail') || lower.includes('error') || lower.includes('broken'))) {
    return OPERATIONAL_PATTERNS['Investigate a deployment failure']
  }
  
  return null
}
