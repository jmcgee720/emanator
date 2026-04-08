/**
 * Context Assembly Module
 * Builds context for AI from project data, platform knowledge, or workspace search
 */

const MAX_RECENT_MESSAGES = 20
const MAX_FILES_IN_CONTEXT = 10
const MAX_FILE_CONTENT_LENGTH = 3000

// ─── Scope Classification ───────────────────────────────────────────

const PLATFORM_KEYWORDS = [
  'mymergent', 'my mergent',
  'platform architecture', 'platform scope',
  'dashboard component', 'dashboard layout',
  'provider system', 'provider factory', 'ai provider',
  'auth flow', 'authentication flow', 'cookie auth', 'supabase auth',
  'api route', 'api endpoint', 'route handler',
  'canvas system', 'knowledge canvas', 'canvas panel',
  'preview system', 'preview tab', 'sandboxed iframe',
  'model selector', 'recipe selector', 'chat composer',
  'left panel', 'right panel', 'top bar',
  'ai service', 'ai engine', 'context assembly',
  'generation run', 'generation log',
  'admin panel', 'allowlist',
  'search panel', 'global search',
  'export system', 'import system', 'snapshot',
  'this app', 'this platform', 'this tool',
  'how does this work', 'how is this built',
  'builder mode', 'scope selector',
]

/**
 * Classify the likely scope from user message text.
 * Returns 'platform' | 'workspace' | 'project'
 */
export function classifyScope(message) {
  const lower = message.toLowerCase()

  // Explicit workspace keywords
  if (
    lower.includes('across all projects') ||
    lower.includes('search all') ||
    lower.includes('workspace') ||
    lower.includes('every project') ||
    lower.includes('all my projects')
  ) {
    return 'workspace'
  }

  // Platform keywords
  for (const kw of PLATFORM_KEYWORDS) {
    if (lower.includes(kw)) return 'platform'
  }

  return 'project'
}

// ─── Platform Knowledge ─────────────────────────────────────────────

const PLATFORM_KNOWLEDGE = `
# MyMergent Platform Architecture

## Overview
MyMergent is a private, approval-based AI builder platform for generating websites, web apps, product specs, UI screens, images, and code files. It uses a full-stack Next.js 14 monorepo architecture with Supabase for auth and PostgreSQL.

## Tech Stack
- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, shadcn/ui, lucide-react
- **Backend**: Next.js API Routes (catch-all at \`/api/[[...path]]/route.js\`)
- **Database**: Supabase PostgreSQL (service-role client for writes, anon+cookies for auth)
- **Auth**: Supabase Auth via \`@supabase/ssr\` (cookie-based SSR sessions)
- **AI**: OpenAI SDK + Anthropic SDK with a provider-agnostic factory pattern

## Directory Layout
\`\`\`
/app
├── app/
│   ├── api/[[...path]]/route.js   ← All API endpoints (single catch-all)
│   ├── page.js                     ← Root page (login gate → dashboard)
│   └── layout.js                   ← Root layout, global CSS
├── components/
│   ├── auth/LoginPage.jsx          ← Supabase sign-in / sign-up form
│   ├── dashboard/
│   │   ├── Dashboard.jsx           ← Main state hub (projects, chats, messages, files, canvas)
│   │   ├── LeftPanel.jsx           ← Project selector, conversations, messages, composer
│   │   ├── RightPanel.jsx          ← Tabbed workspace (Preview, Code, Assets, Logs, Export, Deploy)
│   │   ├── TopBar.jsx              ← App header (user menu, search, canvas toggle)
│   │   ├── ChatComposer.jsx        ← Auto-resize textarea with model/recipe/scope pills
│   │   ├── ModelSelector.jsx       ← Provider + model dropdown with status badges
│   │   ├── RecipeSelector.jsx      ← Predefined generation templates
│   │   ├── ScopeSelector.jsx       ← Project / Platform / Workspace scope picker
│   │   ├── CanvasPanel.jsx         ← Project Knowledge Canvas overlay
│   │   ├── MessageRenderer.jsx     ← Markdown rendering with code blocks
│   │   ├── MessageActions.jsx      ← Copy, regenerate, thumbs, collapse
│   │   ├── AdminPanel.jsx          ← Owner user management
│   │   ├── SearchPanel.jsx         ← Global search overlay
│   │   └── tabs/                   ← PreviewTab, CodeTab, AssetsTab, LogsTab, ExportTab, DeployTab
│   └── ui/                         ← shadcn/ui primitives
├── lib/
│   ├── ai/
│   │   ├── service.js              ← AIService class — processMessage, loadContext, canvas updates
│   │   ├── context.js              ← Context assembly, scope classification, platform knowledge
│   │   ├── errors.js               ← ProviderError, classifyProviderError
│   │   ├── tools.js                ← AI tool definitions (create_files, update_files, plan, summarize)
│   │   └── providers/
│   │       ├── index.js            ← createProvider factory + AVAILABLE_PROVIDERS registry
│   │       ├── base.js             ← BaseAIProvider interface
│   │       ├── openai.js           ← OpenAI adapter with error wrapping
│   │       └── anthropic.js        ← Anthropic adapter with error wrapping
│   ├── supabase/
│   │   ├── client.js               ← Browser client (cookie-based, for frontend)
│   │   ├── server.js               ← Server client (cookie reader, for API routes)
│   │   └── db.js                   ← Service-role admin client for data writes
│   ├── constants.js                ← App constants (modes, tabs, export targets, scopes)
│   └── utils.js                    ← cn() helper
└── .env                            ← All credentials (Supabase, OpenAI, Anthropic)
\`\`\`

## Key Architectural Patterns

### Authentication
- Cookie-based SSR auth via \`@supabase/ssr\`
- Browser: \`createBrowserClient()\` stores sessions in cookies
- Server: \`createServerClient()\` reads cookies via Next.js \`cookies()\` API
- API routes call \`getAuthUser()\` which reads the cookie session
- Allowlist: After auth, the user's email is checked against a \`users\` table with \`is_allowlisted\` flag
- Roles: \`owner\` (full admin) and \`member\` (project access only)

### AI Service Layer
- \`AIService\` class in \`/lib/ai/service.js\` is the core orchestrator
- Provider factory in \`/lib/ai/providers/index.js\` returns OpenAI or Anthropic adapter
- Both adapters wrap SDK calls in \`classifyProviderError()\` for graceful error handling
- Tool calling: AI can call \`create_files\`, \`update_files\`, \`plan_project\`, \`summarize_project\`
- After each exchange, the canvas is auto-updated and files are verified in DB
- Generation runs are logged with provider, model, scope, duration, error info

### Context Scoping
- **Project scope**: Loads project files, canvas, and chat history for the selected project
- **Platform scope**: Provides MyMergent architecture documentation (this text) instead of project files
- **Workspace scope**: Searches across all user projects for cross-project context

### Data Model
- **users**: id, email, role, is_allowlisted
- **projects**: id, user_id, name, description, type, settings
- **chats**: id, project_id, title
- **messages**: id, chat_id, project_id, role, content, metadata
- **project_files**: id, project_id, path, content, file_type, version
- **project_canvas**: id, project_id, canvas_content (JSON), last_updated
- **generation_runs**: id, project_id, chat_id, provider, model, scope, tool_mode, success, duration
- **snapshots**: id, project_id, name, files_snapshot, canvas_snapshot
- **exports**: id, project_id, export_type, status, artifact_data

### API Routes (all prefixed /api)
- \`POST /api/auth/check\` — Allowlist check
- \`GET|POST /api/projects\` — List / Create projects
- \`GET|PUT|DELETE /api/projects/:id\` — Single project CRUD
- \`GET|POST /api/projects/:id/chats\` — Chat threads
- \`GET|POST /api/chats/:id/messages\` — Messages + AI generation
- \`GET|PUT /api/projects/:id/canvas\` — Knowledge canvas
- \`GET|POST /api/projects/:id/files\` — Project files
- \`GET /api/providers/status\` — Provider health check
- \`POST /api/search\` — Global search
- \`GET|POST /api/projects/:id/snapshots\` — Snapshots
- \`GET|POST /api/projects/:id/exports\` — Exports
- \`POST /api/projects/import\` — Import from manifest
- \`GET|POST|PUT|DELETE /api/admin/users\` — Admin user management

### Frontend State Management
- \`Dashboard.jsx\` is the central state hub, managing:
  - projects, selectedProject, chats, selectedChat, messages, files, canvas
  - aiProvider, aiModel, scope, providerStatus, builderMode
  - Passes state + handlers down to LeftPanel, RightPanel, TopBar
- No external state library; pure React useState + useCallback
`

// ─── Project Context Assembly (existing) ────────────────────────────

export function assembleContext({
  project,
  chat,
  messages = [],
  files = [],
  canvas = null,
  memory = []
}) {
  return {
    project: assembleProjectContext(project),
    chat: assembleChatContext(chat, messages),
    files: assembleFilesContext(files),
    canvas: assembleCanvasContext(canvas),
    memory: memory || []
  }
}

function assembleProjectContext(project) {
  if (!project) return null
  return {
    id: project.id,
    name: project.name,
    description: project.description || '',
    type: project.type,
    settings: project.settings || {},
    created_at: project.created_at
  }
}

function assembleChatContext(chat, messages) {
  if (!chat) return null
  const recentMessages = messages
    .slice(-MAX_RECENT_MESSAGES)
    .map(m => ({ role: m.role, content: m.content, created_at: m.created_at }))
  return { id: chat.id, title: chat.title, messages: recentMessages }
}

function assembleFilesContext(files) {
  if (!files || files.length === 0) return []
  const priorityPatterns = [
    /package\.json$/, /index\.(js|jsx|ts|tsx|html)$/, /app\.(js|jsx|ts|tsx)$/,
    /page\.(js|jsx|ts|tsx)$/, /layout\.(js|jsx|ts|tsx)$/, /\.(css|scss)$/,
    /config/, /README/i
  ]
  const sortedFiles = [...files].sort((a, b) => {
    const aPriority = priorityPatterns.findIndex(p => p.test(a.path))
    const bPriority = priorityPatterns.findIndex(p => p.test(b.path))
    if (aPriority !== -1 && bPriority === -1) return -1
    if (bPriority !== -1 && aPriority === -1) return 1
    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority
    return a.path.localeCompare(b.path)
  })
  return sortedFiles.slice(0, MAX_FILES_IN_CONTEXT).map(f => ({
    path: f.path,
    content: truncateContent(f.content, MAX_FILE_CONTENT_LENGTH),
    file_type: f.file_type,
    version: f.version
  }))
}

function assembleCanvasContext(canvas) {
  if (!canvas) return null
  const keySections = [
    'project_overview', 'project_goals', 'key_decisions',
    'architecture_notes', 'technical_specs', 'constraints',
    'open_tasks', 'successful_patterns', 'creative_brief'
  ]
  const contextCanvas = {}
  for (const key of keySections) {
    if (canvas[key]) {
      if (key === 'creative_brief') {
        contextCanvas[key] = canvas[key] // Pass full brief object
      } else {
        contextCanvas[key] = Array.isArray(canvas[key]) ? canvas[key].slice(0, 10) : canvas[key]
      }
    }
  }
  return contextCanvas
}

function truncateContent(content, maxLength) {
  if (!content) return ''
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '\n... [truncated]'
}

// ─── System Message Formatters ──────────────────────────────────────

/**
 * Format context as a system message.
 * @param {Object} context     assembled context object
 * @param {string} builderMode 'app' | 'website' | 'image' | 'document'
 * @param {string} scope       'project' | 'platform' | 'workspace'
 */
export function formatContextAsSystemMessage(context, builderMode = 'app', scope = 'project') {
  if (scope === 'platform') return formatPlatformSystemMessage(context)
  if (scope === 'workspace') return formatWorkspaceSystemMessage(context)
  return formatProjectSystemMessage(context, builderMode)
}

function formatProjectSystemMessage(context, builderMode) {
  const modeInstructions = {
    app: 'You are building a web application.',
    website: 'You are building a website.',
    image: 'You are helping design visual assets.',
    document: 'You are creating documentation and specifications.'
  }

  let msg = `You are Emanator, a developer AI. You build things. You write code. You ship.

## Personality
- Talk like a senior dev pair-programming with a friend. Casual, direct, confident.
- When someone asks "can you build X?" — say yes and start building. Don't write a proposal.
- When someone describes what they want, your first instinct is to write code, not to outline a plan.
- Keep explanations short. If the code speaks for itself, let it.
- Ask clarifying questions only when truly blocked, not as a formality.
- Never say "I'd be happy to help" or "Great question!" — just do the work.

## Mode
${modeInstructions[builderMode] || modeInstructions.app}

## Scope: PROJECT
You are working within the user's currently selected project. All files and canvas data below belong to this project.

## Code Standards
- Complete, working code — never stubs or placeholders
- Modern best practices, clean structure
- When editing files, preserve what already works
- ALWAYS include real images using <img src="https://images.unsplash.com/..." /> — NEVER say you cannot add images
- NEVER tell the user to "source images" or "use a stock photo service" — you write the code WITH images included

## Response Format
When generating or editing files, respond with JSON:
\`\`\`json
{
  "plan": "Brief one-liner of what you're doing",
  "files": [
    {
      "action": "create" | "update",
      "path": "path/to/file.ext",
      "content": "file content here",
      "description": "what this file does"
    }
  ],
  "summary": "What was done",
  "next_steps": ["What to do next"]
}
\`\`\`

For conversational responses (questions, explanations), just talk normally — no JSON.

## Current Project Context
`

  if (context.project) {
    msg += `\n### Project: ${context.project.name}\n- Type: ${context.project.type}\n- Description: ${context.project.description || 'No description'}\n`
  }

  if (context.canvas) {
    msg += `\n### Project Knowledge Canvas\n`
    if (context.canvas.project_overview) msg += `**Overview:** ${context.canvas.project_overview}\n`
    if (context.canvas.project_goals?.length) msg += `**Goals:** ${context.canvas.project_goals.map(g => g.text || g).join(', ')}\n`
    if (context.canvas.architecture_notes?.length) msg += `**Architecture:** ${context.canvas.architecture_notes.map(a => a.text || a).join('; ')}\n`
    if (context.canvas.technical_specs?.length) msg += `**Tech Specs:** ${context.canvas.technical_specs.map(t => t.text || t).join('; ')}\n`
    if (context.canvas.constraints?.length) msg += `**Constraints:** ${context.canvas.constraints.map(c => c.text || c).join('; ')}\n`
    if (context.canvas.open_tasks?.length) msg += `**Open Tasks:** ${context.canvas.open_tasks.map(t => t.text || t).join('; ')}\n`

    // Creative Brief — user-authored project direction
    const brief = context.canvas.creative_brief
    if (brief) {
      msg += `\n### Creative Brief (User-Provided Direction)\n`
      msg += `The user has filled out a detailed creative brief. You MUST generate COMPLETE, production-ready code for this project — not placeholder stubs.\n`
      msg += `**CRITICAL**: Every page/component you create must have FULL, real UI with proper layouts, working navigation, real form elements, styled sections, and meaningful content. Do NOT create pages that only display a title — each page must be fully designed and functional.\n`
      msg += `When the brief specifies pages, build each one with real content: headers, navigation bars, cards, tables, forms, buttons, icons, and proper Tailwind styling matching the specified mood.\n\n`
      if (brief.elevator_pitch) msg += `**What they're building:** ${brief.elevator_pitch}\n`
      if (brief.target_audience) msg += `**Target audience:** ${brief.target_audience}\n`
      if (brief.primary_goal) msg += `**Primary goal:** ${brief.primary_goal}\n`
      if (brief.brand_name) msg += `**Brand name:** ${brief.brand_name}\n`
      if (brief.mood?.length) msg += `**Mood / personality:** ${brief.mood.join(', ')}\n`
      if (brief.color_preferences) msg += `**Color preferences:** ${brief.color_preferences}\n`
      if (brief.reference_sites) msg += `**Reference sites:** ${brief.reference_sites}\n`
      if (brief.pages?.length) msg += `**Pages needed:** ${brief.pages.join(', ')}\n`
      if (brief.most_important_page) msg += `**Most important page (build this one with the MOST detail):** ${brief.most_important_page}\n`
      if (brief.must_have_features) msg += `**Must-have features (implement all of these):** ${brief.must_have_features}\n`
      if (brief.nice_to_have_features) msg += `**Nice-to-have features:** ${brief.nice_to_have_features}\n`
      if (brief.headline) msg += `**Headline / tagline:** ${brief.headline}\n`
      if (brief.key_messaging) msg += `**Key messaging:** ${brief.key_messaging}\n`
      if (brief.tone_of_voice) msg += `**Tone of voice:** ${brief.tone_of_voice}\n`
      if (brief.integrations) msg += `**Integrations needed:** ${brief.integrations}\n`
      if (brief.timeline) msg += `**Timeline:** ${brief.timeline}\n`
      if (brief.budget_tier) msg += `**Budget tier:** ${brief.budget_tier}\n`
      if (brief.things_to_avoid) msg += `**Things to avoid:** ${brief.things_to_avoid}\n`
    }
  }

  if (context.memory?.length) {
    // Score and select top memory entries by relevance to current conversation
    const MAX_MEMORY = 10
    const lastUserMsg = context.chat?.messages?.filter(m => m.role === 'user').pop()?.content || ''
    const queryWords = new Set(lastUserMsg.toLowerCase().split(/\W+/).filter(w => w.length > 2))

    const scored = context.memory.map(entry => {
      const text = `${entry.key} ${typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)}`.toLowerCase()
      const words = text.split(/\W+/).filter(w => w.length > 2)
      const overlap = words.filter(w => queryWords.has(w)).length
      return { entry, score: overlap }
    })

    scored.sort((a, b) => b.score - a.score)
    const selected = scored.slice(0, MAX_MEMORY)

    msg += `\n### Builder Memory\nThe following knowledge has been stored from previous interactions:\n`
    for (const { entry } of selected) {
      msg += `- **${entry.key}**: ${typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)}\n`
    }
  }

  if (context.files?.length) {
    msg += `\n### Existing Files\n`
    for (const file of context.files) {
      msg += `\n**${file.path}** (v${file.version}):\n\`\`\`\n${file.content}\n\`\`\`\n`
    }
  }

  return msg
}

function formatPlatformSystemMessage(context) {
  let msg = `You are MyMergent, the AI engine inside the MyMergent platform.

## Scope: PLATFORM
The user is asking about the MyMergent platform/application itself — its architecture, components, APIs, or internals. Do NOT reference the user's currently selected project files. Answer based on the platform documentation below.

${PLATFORM_KNOWLEDGE}
`

  // Still include chat history for conversational continuity
  if (context.chat?.messages?.length) {
    msg += `\n## Conversation History\nThis conversation has ${context.chat.messages.length} previous messages.\n`
  }

  return msg
}

function formatWorkspaceSystemMessage(context) {
  let msg = `You are MyMergent, an expert AI builder assistant.

## Scope: WORKSPACE
The user is searching or asking about content across ALL their projects. Provide answers based on the cross-project data provided below.

## Guidelines
1. Reference specific projects and files when answering
2. Compare and contrast across projects when relevant
3. Highlight patterns across the workspace

`

  if (context.workspaceProjects?.length) {
    msg += `\n### User's Projects (${context.workspaceProjects.length} total)\n`
    for (const p of context.workspaceProjects) {
      msg += `- **${p.name}** (${p.type}) — ${p.file_count || 0} files, created ${p.created_at?.slice(0, 10) || 'unknown'}\n`
    }
  }

  if (context.workspaceFiles?.length) {
    msg += `\n### Matching Files Across Projects\n`
    for (const f of context.workspaceFiles.slice(0, 15)) {
      msg += `- \`${f.path}\` in project "${f.project_name}" (v${f.version})\n`
    }
  }

  if (context.workspaceCanvas?.length) {
    msg += `\n### Canvas Entries Across Projects\n`
    for (const c of context.workspaceCanvas) {
      msg += `- **${c.project_name}**: ${c.overview || 'No overview'}\n`
    }
  }

  return msg
}
