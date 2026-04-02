/**
 * Developer Intent Classifier
 * Classifies user messages into actionable developer intents
 */

// ── Strong code/build signals that DISQUALIFY image/sprite classification ──
// These indicate the user wants runnable code, NOT an image asset
const CODE_BUILD_SIGNALS = [
  /\bplayable\b/i, /\bbrowser\s*game\b/i, /\bprototype\b/i,
  /\bgame\s*loop\b/i, /\bcanvas\s*render/i, /\brequestAnimationFrame\b/i,
  /\bcollision\s*detect/i, /\bplayer\s*movement/i, /\benemy\s*spawn/i,
  /\bscore\s*system/i, /\bgame\s*over\b/i, /\brestart\s*button/i,
  /\bkeyboard\s*(input|event|control|handler)/i, /\bhit\s*box/i,
  /\bfull\s*files?\b/i, /\bpreview\s*should/i, /\bin\s*HTML/i,
  /\bHTML.*CSS.*JS/i, /\bHTML.*JavaScript/i,
  /\bCSS.*animation/i, /\bCSS.*JavaScript/i,
  /\b(build|create|make|code|write|implement|develop)\b.{0,40}\b(game|app|prototype|application|page|site|website|dashboard)\b(?!.{0,10}\b(asset|icon|sprite|image|art|sheet|png|graphic|logo))/i,
  /\b(build|create|make)\b.{0,20}\b(arcade|platformer|shooter|puzzle|rpg|racing)\b/i,
  /\b(build|create|make)\b.{0,30}\b(playable|interactive|functional)\b/i,
  /\bgenerate\s*(the\s+)?(code|files?|project)\b/i,
  /\busing\s+(HTML|CSS|JS|JavaScript|TypeScript|Canvas|React|Vue|Angular)\b/i,
  /\bwith\s+(HTML|CSS|JS|JavaScript|TypeScript|Canvas)\b/i,
  // ── Code/architecture hard guard — presence of these blocks image routing ──
  /\.(js|jsx|ts|tsx|mjs)\b/i,
  /\b(route\.js|Dashboard\.jsx|server\.js|index\.js|package\.json|constants\.js|intents\.js|service\.js)\b/,
  /\b(lib|app|src|components|api|pages|hooks|services|models)\s*[/\\]/i,
  /\b(route|router|handler|validator|planner|changelog|file_actions|middleware)\b/i,
  /\b(diff|rollback|snapshot|sandbox|promote|apply|endpoint|pipeline)\b/i,
  /\b(function|const|let|var|import|export|class|interface|module)\s/i,
  /\b(component|hook|reducer|context|provider|controller)\b.{0,30}\b(for|to|in|from)\b/i,
  /\b(dashboard|sidebar|topbar|navbar|header|footer|layout|panel|modal|overlay|dialog)\b/i,
  /\b(architecture|backend|frontend|fullstack|codebase|refactor|migrate|schema)\b/i,
]

// ── Asset-object patterns: user is creating an ASSET, not code ──
// If the prompt's direct object is an asset type, skip code classification
const ASSET_OBJECT_PATTERNS = [
  /\b(create|make|generate|design|draw)\s+(a\s+|an\s+|the\s+)?(game\s+)?(asset|icon|icons?|sprite|image|logo|badge|sticker|avatar|emblem|mascot|artwork|graphic|illustration|banner|thumbnail)\b/i,
  /\b(icon|sprite|asset|image|logo)\s+(set|pack|sheet|collection|kit)\b/i,
]

// ── Game-specific build patterns (classified as 'build' intent) ──
const GAME_BUILD_PATTERNS = [
  /\bbuild\b.{0,50}\bgame\b/i, /\bcreate\b.{0,50}\bgame\b/i,
  /\bmake\b.{0,50}\bgame\b/i, /\bcode\b.{0,50}\bgame\b/i,
  /\bgame\b.{0,50}\b(build|create|make|code|write|implement|develop)\b/i,
  /\bplayable\s*(prototype|game|demo|version)/i,
  /\bbrowser\s*game\b/i, /\barcade\s*game\b/i,
  /\bplatformer\b/i, /\bshooter\s*game\b/i,
  /\bgame\s*loop\b/i, /\bgame\s*engine\b/i,
  /\bcanvas\s*game\b/i, /\b2d\s*game\b/i, /\b3d\s*game\b/i,
]

const INTENT_PATTERNS = {
  image_generation: [
    // Tight patterns
    /generate\s*(an?\s+)?image/i, /create\s*(an?\s+)?image/i, /make\s*(an?\s+)?image/i,
    /draw/i, /illustrat/i, /paint/i, /render\s*(an?\s+)?image/i,
    /generate\s*(a\s+)?picture/i, /create\s*(a\s+)?picture/i,
    /generate\s*(a\s+)?photo/i, /image\s*of/i,
    /generate\s*(a\s+)?visual/i, /concept\s*art/i,
    // Broad patterns — catch "generate ... image" with words in between
    /\bgenerate\b.{0,40}\bimage\b/i,
    /\bcreate\b.{0,40}\bimage\b/i,
    /\bimage\s*asset/i,
    /\btransparent\s*(PNG|image)/i,
    /\bPNG\s+(sprite|icon|asset|image|character)/i,
    // Catch "generate/create/make/design + visual output noun" with words in between
    /\b(generate|create|make|design)\b.{0,50}\b(graphic|artwork|poster|wallpaper|portrait|scene|landscape|mural|infographic|mockup)\b/i,
    // Follow-up / variation
    /\bvariation\b/i, /\bsame\s+style\b/i, /\blike\s+(the\s+)?last\b/i,
    /use\s+the\s+(last|previous)\s+(generated\s+)?image/i,
    /different\s+pose/i, /different\s+color/i,
  ],
  sprite_generation: [
    // Any mention of "sprite" is a sprite intent
    /\bsprite\b/i,
    /sprite\s*sheet/i, /sprite\s*map/i, /pixel\s*art/i, /game\s*sprite/i,
    /character\s*sprite/i, /animation\s*frame/i, /sprite\s*atlas/i,
    /tileset/i, /tile\s*map/i,
  ],
  asset_generation: [
    /game\s*asset/i, /icon\s*set/i, /game\s*icons?/i, /ui\s*kit/i, /design\s*system/i, /illustration/i,
    /logo\s*design/i, /banner/i, /thumbnail/i,
    // Broad: "generate/create/make ... asset" with words in between
    /\b(generate|create|make)\b.{0,30}\basset\b/i,
    // Catch "generate/create/make/design/draw + icon/logo/avatar/badge/etc." with words in between
    /\b(generate|create|make|design|draw)\b.{0,50}\b(icons?|logos?|avatars?|badges?|stickers?|emojis?|mascots?|emblems?)\b/i,
    // Reverse: "icon/logo + generate/create/make/design/draw"
    /\b(icons?|logos?|avatars?|badges?|stickers?|emojis?|mascots?|emblems?)\b.{0,30}\b(generate|create|make|design|draw)\b/i,
  ],
  deployment: [
    /deploy/i, /publish/i, /go\s*live/i, /push\s*to\s*production/i,
    /host(ing)?/i, /vercel/i, /netlify/i, /ship\s*it/i,
  ],
  export: [
    /export/i, /download/i, /zip/i, /package/i, /bundle/i,
    /manifest/i, /snapshot/i, /backup/i,
  ],
  bug_fix: [
    /bug/i, /error/i, /fix/i, /broken/i, /crash/i, /fail/i,
    /not\s*working/i, /doesn.t\s*work/i, /issue/i, /wrong/i,
    /stack\s*trace/i, /exception/i, /debug/i, /troubleshoot/i,
    /console\s*error/i, /500\s*error/i, /404/i, /undefined/i, /null/i,
  ],
  refactor: [
    /refactor/i, /restructure/i, /reorganize/i, /clean\s*up/i,
    /simplify/i, /optimize/i, /deduplicate/i, /dedup/i,
    /split\s*(this|the|into)/i, /extract\s*(this|the|a|into)/i,
    /move\s*(this|the)\s*(to|into)/i, /rename/i, /consolidate/i,
  ],
  architecture_analysis: [
    /\barchitecture\b/i, /how\s*(does|is)\s*(this|the|it)\s*(work|built|structured)/i,
    /describe\s*(the|this)\s*(architecture|structure|system|codebase)/i,
    /under\s*the\s*hood/i,
    /walkthrough\s*(of|the)/i, /code\s*(review|audit)/i,
    /system\s*overview/i, /technical\s*overview/i,
  ],
  explain: [
    /explain/i, /what\s+does/i, /how\s+does/i, /why\s+does/i,
    /what\s+is/i, /tell\s+me\s+about/i, /help\s+me\s+understand/i,
    /can\s+you\s+explain/i, /walk\s+me\s+through/i,
  ],
  research: [
    /research/i, /compare/i, /alternatives/i, /best\s*practice/i,
    /pros?\s*and\s*cons/i, /should\s*(i|we)/i, /recommendation/i,
    /which\s*(is|one)/i, /trade.?off/i,
  ],
  edit: [
    /update/i, /edit/i, /modify/i, /change/i, /adjust/i, /tweak/i,
    /add\s*(a|an|the|to)/i, /remove/i, /delete/i, /replace/i,
    /swap/i, /move/i, /insert/i, /append/i,
  ],
  build: [
    /build/i, /create/i, /generate/i, /make/i, /scaffold/i,
    /set\s*up/i, /implement/i, /develop/i, /code/i, /write/i,
    /new\s*(page|component|feature|module|api|endpoint|route)/i,
  ],
}

// Priority order — first match wins
// Sprite/asset before image (more specific), all image intents before build/edit (which have broad /generate/i, /create/i)
const INTENT_PRIORITY = [
  'sprite_generation',
  'asset_generation',
  'image_generation',
  'deployment',
  'export',
  'bug_fix',
  'refactor',
  'build',
  'edit',
  'architecture_analysis',
  'explain',
  'research',
]

/**
 * Classify user message into a developer intent.
 */
export function classifyIntent(message) {
  const text = message.trim()
  if (!text) return 'chat'

  // ── HARD GUARD: Explicit BUILD intent takes absolute priority ──
  if (/\bINTENT:\s*BUILD\b/i.test(text)) {
    return 'build'
  }

  // ── Strip negated phrases so "Do NOT generate an image" doesn't trigger image intent ──
  const cleanedText = text
    .replace(/\b(do\s+not|don'?t|never|no)\s+(generate|create|make|use|produce|render|draw)\b[^.!?\n]*/gi, '')
    .trim()

  // ── Phase 1: ASSET OBJECT CHECK on cleaned text ──
  // If the user's affirmative action is creating an asset (icon, sprite, image), skip game-build override
  const isAssetObject = ASSET_OBJECT_PATTERNS.some(p => p.test(cleanedText))

  // ── Phase 2: GAME BUILD — wins unconditionally UNLESS user is creating an asset ──
  if (!isAssetObject) {
    for (const pattern of GAME_BUILD_PATTERNS) {
      if (pattern.test(text)) return 'build'
    }
  }

  // ── Phase 3: CODE BUILD SIGNALS — check on original text, skip if creating an asset ──
  // Strong code signals override asset object detection
  const hasStrongCodeSignal = CODE_BUILD_SIGNALS.some(p => p.test(text))
  const hasCodeSignal = hasStrongCodeSignal && !isAssetObject
  // Even if isAssetObject, strong code file/architecture signals override it
  const codeOverridesAsset = isAssetObject && /\.(js|jsx|ts|tsx|mjs)\b|\b(route\.js|Dashboard\.jsx|constants\.js|service\.js)\b|\b(lib|app|src|components|api)\s*[/\\]|\b(route|router|handler|validator|planner|changelog|file_actions|middleware|endpoint|pipeline|rollback|snapshot|sandbox|promote|diff|architecture|backend|frontend|codebase|refactor|dashboard|sidebar|topbar|navbar|panel)\b/i.test(text)
  if (hasCodeSignal || codeOverridesAsset) {
    // Code signals present — skip image/sprite/asset intents entirely
    for (const intent of INTENT_PRIORITY) {
      if (intent === 'sprite_generation' || intent === 'asset_generation' || intent === 'image_generation') continue
      const patterns = INTENT_PATTERNS[intent]
      for (const pattern of patterns) {
        if (pattern.test(text)) return intent
      }
    }
    return 'build'
  }

  // ── Phase 3: Normal priority walk on CLEANED text (negations stripped) ──
  for (const intent of INTENT_PRIORITY) {
    const patterns = INTENT_PATTERNS[intent]
    for (const pattern of patterns) {
      if (pattern.test(cleanedText)) return intent
    }
  }

  return 'chat'
}

/**
 * Check if an intent should use plan-first mode.
 * Plan mode proposes a plan before writing files.
 */
export function shouldUsePlanMode(intent) {
  return ['build', 'edit', 'refactor', 'bug_fix'].includes(intent)
}

/**
 * Resolve the explicit task mode for a request.
 */
export function resolveTaskMode(intent, { isExecutingPlan } = {}) {
  if (isExecutingPlan) return 'patch'
  if (shouldUsePlanMode(intent)) return 'plan'
  return 'inspect'
}

// ── Request-Mode Gate ──
// Deterministic classification before planner execution.

const APPLY_PENDING_PATTERNS = [
  /\bapply\b/i, /\baccept\b/i, /\bapprove\b/i, /\bconfirm\b/i,
  /\bgo\s+ahead\b/i, /\blooks?\s*good\b/i, /\bship\s*it\b/i,
  /\blgtm\b/i, /\bmerge\b/i, /\bcommit\b/i, /\byes\b/i,
]

const DISCARD_PENDING_PATTERNS = [
  /\bdiscard\b/i, /\bcancel\b/i, /\breject\b/i, /\bdismiss\b/i,
  /\bdrop\b/i, /\brevert\b/i, /\bnever\s*mind\b/i,
  /\bscratch\s*that\b/i, /\bforget\s*it\b/i, /\bdon'?t\s*apply\b/i,
  /\bundo\b/i, /\bno\b/i,
]

const CODE_CHANGE_PATTERNS = [
  /\b(fix|build|create|implement|add|remove|delete|update|change|modify|edit|refactor|replace|move|rename|swap|insert|append|rewrite|migrate|convert|upgrade|patch|install|configure|set\s*up|scaffold|wire|connect|hook\s*up)\b/i,
]

const READ_ONLY_PATTERNS = [
  /\b(locate|find|show|report|investigate|inspect|audit|list|scan|search|check|verify|review|analyze|describe|explain|summarize|overview|status|detail|count|read|trace|walk\s*through|diagram|map|outline)\b/i,
  /^(what|where|how|why|which|who|does|is|are|can|could|should|would)\b/i,
]

/**
 * Classify request mode before planner execution.
 * Returns: 'read_only_report' | 'plan_patch' | 'apply_pending_diff' | 'discard_pending_diff'
 */
export function classifyRequestMode(userMessage, { hasPendingDiff = false } = {}) {
  const text = (userMessage || '').trim()
  if (!text) return 'plan_patch'

  if (/^(GET|POST|PUT|DELETE|PATCH)\s+\/api\//i.test(text)) {
    return 'internal_api_exec'
  }

  // Priority 1: pending-diff actions (only when diff exists)
  if (hasPendingDiff) {
    const isApply = APPLY_PENDING_PATTERNS.some(p => p.test(text))
    const isDiscard = DISCARD_PENDING_PATTERNS.some(p => p.test(text))
    // If both match, prefer discard (explicit rejection > implicit approval)
    if (isDiscard) return 'discard_pending_diff'
    if (isApply) return 'apply_pending_diff'
  }

  // Priority 1b: internal API execution
  if (/\bINTERNAL\s+API\s+EXECUTION\b/i.test(text)) return 'internal_api_exec'

  // Priority 2: explicit read-only directives override everything
  // Phrases like "READ-ONLY", "do not propose a plan", "do not generate file_actions"
  // are unambiguous — the user explicitly forbids code changes.
  const EXPLICIT_READ_ONLY = [
    /\bread[\s-]*only\b/i,
    /\bdo\s+not\s+propose\s+a?\s*plan\b/i,
    /\bdo\s+not\s+generate\s+file.?actions\b/i,
    /\bplain\s+report\s+only\b/i,
    /\bno\s+file.?actions\b/i,
    /\bdo\s+not\s+modify\b/i,
    /\bdo\s+not\s+change\b/i,
    /\binspection\b/i,
  ]
  const hasExplicitReadOnly = EXPLICIT_READ_ONLY.some(p => p.test(text))
  if (hasExplicitReadOnly) return 'read_only_report'

  // Priority 3: sub-classify code-change intent into plan_only / patch_only / plan_patch
  const hasCodeChange = CODE_CHANGE_PATTERNS.some(p => p.test(text))
  const PLAN_ONLY_PATTERNS = [
    /\b(plan|propose|outline|architect|design|draft|scope|break\s*down|sketch)\b/i,
  ]
  const EXEC_ONLY_PATTERNS = [
    /\bjust\s+do\s+it\b/i,
    /\bgo\s+ahead\s+and\s+(build|implement|write)\b/i,
    /\b(implement|execute|ship)\s+(this|it|that|now)\b/i,
    /\bjust\s+(implement|build|write|execute|ship)\b/i,
  ]
  const hasPlanSignal = PLAN_ONLY_PATTERNS.some(p => p.test(text))
  const hasExecSignal = EXEC_ONLY_PATTERNS.some(p => p.test(text))

  if (hasPlanSignal && !hasExecSignal && !hasCodeChange) return 'plan_only'
  if (hasExecSignal && !hasPlanSignal) return 'patch_only'
  if (hasCodeChange) {
    if (hasPlanSignal && !hasExecSignal && !/\b(implement|build|write|apply|execute)\b/i.test(text)) return 'plan_only'
    return 'plan_patch'
  }

  // Priority 4: read-only signal → read_only_report
  const hasReadOnly = READ_ONLY_PATTERNS.some(p => p.test(text))
  if (hasReadOnly) return 'read_only_report'

  // Default: plan_patch (safer — don't accidentally block code changes)
  return 'plan_patch'
}


// ── Simple frontend direct-edit detection ──
// Matches requests that are simple single-page UI generation (landing page, homepage, etc.)
// and can be fulfilled by editing ONE existing page file without planner/diff overhead.

const SIMPLE_FRONTEND_PATTERNS = [
  /\b(build|create|make|design|generate|write)\b.{0,40}\b(landing\s*page|homepage|home\s*page|hero\s*page|web\s*page|single[- ]page|one[- ]?page|front\s*page|splash\s*page|welcome\s*page|about\s*page|portfolio\s*page|pricing\s*page|contact\s*page)\b/i,
  /\b(landing\s*page|homepage|home\s*page)\b.{0,40}\b(for|about|of|called|named)\b/i,
  /\b(build|create|make)\b.{0,30}\b(a|an|the)\s+(simple|basic|clean|minimal|modern|beautiful|sleek|stunning|professional|responsive)\b.{0,30}\b(page|site|website|ui|interface)\b/i,
  /\b(build|create|make|design)\b.{0,20}\b(a|the|my)\s+(page|website|site)\b.{0,30}\b(for|about|called)\b/i,
]

const COMPLEX_DISQUALIFIERS = [
  /\b(backend|api|database|server|routing|auth(entication)?|multiple\s*files|multi[- ]?file|architecture|microservice)\b/i,
  /\b(install|package\.json|npm|pnpm|yarn|node_modules|deploy|docker|kubernetes)\b/i,
  /\b(mongodb|postgres|mysql|redis|supabase|firebase|prisma)\b/i,
  /\b(express|fastapi|django|flask|nest\.?js|next\.?js\s+api)\b/i,
  /\b(multiple\s*(pages|routes|screens|components)|multi[- ]?page|routing)\b/i,
  /\b(stripe|payment|checkout|subscription)\b/i,
]

/**
 * Detect if a user request is a simple single-page frontend edit
 * that can bypass the planner/diff pipeline entirely.
 */
export function isSimpleFrontendEdit(message) {
  const text = (message || '').trim()
  if (!text) return false
  if (!SIMPLE_FRONTEND_PATTERNS.some(p => p.test(text))) return false
  if (COMPLEX_DISQUALIFIERS.some(p => p.test(text))) return false
  return true
}

/**
 * Find the main page file path from existing project files,
 * or return a sensible default for new projects.
 */
export function findMainPagePath(existingPaths) {
  const candidates = [
    'app/page.jsx', 'app/page.tsx', 'app/page.js',
    'pages/index.jsx', 'pages/index.tsx', 'pages/index.js',
    'src/App.jsx', 'src/App.tsx', 'src/App.js',
    'src/pages/index.jsx', 'src/pages/index.tsx',
    'index.html',
  ]
  for (const c of candidates) {
    if (existingPaths.includes(c)) return c
  }
  return 'app/page.jsx'
}

// ── Proceed signals: user explicitly wants the AI to start building now ──
// These indicate the user has discussed enough and wants code/plan execution.
const PROCEED_SIGNALS = [
  /\b(go ahead|proceed|start (building|coding|implementing)|execute|do it|build it|let'?s (build|do|go|start)|ship it|make it happen|begin|kick it off|get (to work|started|building|coding))\b/i,
  /\bINTENT:\s*BUILD\b/i,
  /\b(run|apply|execute)\s*(the|this)?\s*plan\b/i,
  /\bjust\s*(build|code|make|create|do)\s*(it|this|that)\b/i,
  /\b(yes|yep|yeah|yup|ok|okay|sure|sounds good|looks good|perfect|approved?|confirmed?|lgtm)\b.*\b(build|proceed|go|start|do)\b/i,
  /^(yes|yep|yeah|yup|ok|okay|sure|go|do it|build it|sounds good|looks good|perfect|lgtm)[\s!.]*$/i,
]

/**
 * Check if the user message is an explicit "go ahead and build" signal.
 * Only these messages should trigger plan/execution mode.
 */
export function isProceedSignal(message) {
  const text = (message || '').trim()
  if (!text) return false
  return PROCEED_SIGNALS.some(p => p.test(text))
}

/**
 * Map intent to workflow configuration
 */
export function getIntentWorkflow(intent) {
  const workflows = {
    build: {
      toolMode: 'create_files',
      useProjectFiles: true,
      useCanvas: true,
      scanExistingFirst: true,
      planFirst: true,
      description: 'Building new functionality',
    },
    edit: {
      toolMode: 'update_files',
      useProjectFiles: true,
      useCanvas: true,
      scanExistingFirst: true,
      planFirst: true,
      description: 'Editing existing code',
    },
    refactor: {
      toolMode: 'update_files',
      useProjectFiles: true,
      useCanvas: true,
      scanExistingFirst: true,
      scanImports: true,
      preferReuse: true,
      planFirst: true,
      description: 'Refactoring project structure',
    },
    bug_fix: {
      toolMode: 'update_files',
      useProjectFiles: true,
      useCanvas: true,
      scanExistingFirst: true,
      prioritizeLogs: true,
      scanRecentChanges: true,
      planFirst: true,
      description: 'Investigating and fixing a bug',
    },
    architecture_analysis: {
      toolMode: 'chat_only',
      preferPlatformScope: true,
      description: 'Analyzing architecture',
    },
    explain: {
      toolMode: 'chat_only',
      useProjectFiles: true,
      useCanvas: true,
      description: 'Explaining code or concepts',
    },
    sprite_generation: {
      toolMode: 'image_gen',
      useCanvas: true,
      spriteConstraints: true,
      imageMode: 'sprite',
      description: 'Generating sprite assets',
    },
    asset_generation: {
      toolMode: 'image_gen',
      useCanvas: true,
      assetMetadata: true,
      imageMode: 'image',
      description: 'Generating design assets',
    },
    image_generation: {
      toolMode: 'image_gen',
      useCanvas: true,
      imageMode: 'image',
      description: 'Generating an image',
    },
    deployment: {
      toolMode: 'chat_only',
      useProjectFiles: true,
      validateReadiness: true,
      description: 'Preparing for deployment',
    },
    export: {
      toolMode: 'chat_only',
      useProjectFiles: true,
      validateReadiness: true,
      description: 'Exporting project',
    },
    research: {
      toolMode: 'chat_only',
      description: 'Researching options',
    },
    chat: {
      toolMode: 'chat_only',
      description: 'General conversation',
    },
  }
  return workflows[intent] || workflows.chat
}

/**
 * Build intent-specific system message addendum.
 * Now uses the full fsContext with relevantFiles and graph data.
 */
export function getIntentSystemAddendum(intent, workflow, fsContext) {
  const parts = []

  if (intent === 'bug_fix') {
    parts.push(`## Intent: Bug Fix
You are investigating a bug. Follow this approach:
1. Analyze the error description and any stack traces
2. Review the relevant source files provided below
3. Check recent file changes for potential regression causes
4. Propose a root cause and fix
5. Show the exact code changes needed using the update_files tool`)
    if (fsContext?.recentChanges?.length) {
      parts.push(`### Recent File Changes (possible regression sources)\n${fsContext.recentChanges.map(c => `- ${c.file_path}: ${c.action} (${c.changes || 'no description'})`).join('\n')}`)
    }
  }

  if (intent === 'refactor') {
    parts.push(`## Intent: Refactor
You are refactoring existing code. Rules:
1. Scan existing files before creating new ones
2. Prefer editing existing files over creating duplicates
3. Track import/export dependencies — update ALL affected files
4. Return a multi-file change set: create, update, or delete files as needed
5. Check the import map below — if you rename a file, update every file that imports it`)
    if (fsContext?.importMap) {
      parts.push(`### Import/Dependency Map\n${Object.entries(fsContext.importMap).map(([f, deps]) => `- ${f} → imports: ${deps.join(', ')}`).join('\n')}`)
    }
  }

  if (intent === 'build' || intent === 'edit') {
    parts.push(`## Intent: ${intent === 'build' ? 'Build' : 'Edit'}
Rules:
1. Check existing files before creating new ones — REUSE where possible
2. Match the existing project structure and naming conventions
3. If you need to import shared components, check what already exists`)
  }

  if (intent === 'sprite_generation') {
    parts.push(`## Intent: Sprite Generation
Enforce these sprite constraints:
- Transparent background (PNG)
- Safe margins (minimum 2px padding)
- No bleed between frames
- Include state list (idle, walk, run, jump, attack, etc.)
- Specify frame count per state
- Use consistent pixel scale`)
  }

  if (intent === 'asset_generation') {
    parts.push(`## Intent: Asset Generation
Include asset metadata:
- Asset type, dimensions, format
- Color palette / style guide adherence
- Export-ready naming convention`)
  }

  if (intent === 'deployment' || intent === 'export') {
    parts.push(`## Intent: ${intent === 'deployment' ? 'Deployment' : 'Export'}
Before proceeding:
1. Validate project readiness — check for missing files, configs, dependencies
2. Identify any blocking issues
3. Then propose a step-by-step plan`)
  }

  return parts.join('\n\n')
}
