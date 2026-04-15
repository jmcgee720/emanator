// ── Message Stream Helper Functions ──
// Extracted from message-stream.js for maintainability.

export function identifyTargetFile(text, targets) {
  const lower = text.toLowerCase()

  // Strategy 1: Exact path mention (e.g. "lib/api/routes/live-promote.js")
  for (const t of targets) {
    if (!t.path || t.path.endsWith('/')) continue
    if (lower.includes(t.path.toLowerCase())) return t
  }

  // Strategy 2: Filename mention (e.g. "live-promote.js", "Dashboard.jsx")
  for (const t of targets) {
    if (!t.path || t.path.endsWith('/')) continue
    const fileName = t.path.split('/').pop().toLowerCase()
    if (lower.includes(fileName)) return t
  }

  // Strategy 3: Keyword-to-file mapping based on task semantics
  // IMPORTANT: Route to SMALL files (<500 lines) whenever possible for reliable AI patching
  const keywordMap = [
    { keywords: ['endpoint', 'api route', '/api/', 'export-zip', 'export zip', 'promote', 'deploy', 'vercel', 'netlify'], target: 'live-promote.js' },
    { keywords: ['project grid', 'project card', 'project tile', 'project bin', 'select all', 'bulk delete', 'delete all', 'project listing', 'new project card', 'hero section', 'creative brief', 'project button'], target: 'ProjectGrid.jsx' },
    { keywords: ['chat input', 'chat composer', 'message input', 'send button', 'prompt input', 'text area', 'voice dictation', 'attachment'], target: 'ChatComposer.jsx' },
    { keywords: ['left panel', 'chat list', 'sidebar', 'chat history', 'conversation list'], target: 'LeftPanel.jsx' },
    { keywords: ['top bar', 'navigation bar', 'header', 'nav bar', 'credits display', 'import button', 'growth button'], target: 'TopBar.jsx' },
    { keywords: ['message render', 'chat bubble', 'message display', 'apply to live button', 'inline button'], target: 'MessageRenderer.jsx' },
    { keywords: ['diff view', 'diff review', 'diff panel', 'code review', 'approve changes', 'reject changes'], target: 'DiffReviewPanel.jsx' },
    { keywords: ['code tab', 'apply to live', 'rollback', 'patch history', 'file viewer'], target: 'CodeTab.jsx' },
    { keywords: ['preview tab', 'live preview', 'iframe', 'preview panel'], target: 'PreviewTab.jsx' },
    { keywords: ['right panel', 'tab switch', 'code panel', 'preview panel'], target: 'RightPanel.jsx' },
    { keywords: ['canvas', 'checklist', 'project management', 'markdown editor'], target: 'CoreCanvas.jsx' },
    { keywords: ['project hub', 'project workspace', 'file tree', 'media bin'], target: 'ProjectHub.jsx' },
    { keywords: ['model selector', 'ai model', 'gpt', 'provider switch'], target: 'ModelSelector.jsx' },
    { keywords: ['new project modal', 'create project', 'project template'], target: 'NewProjectModal.jsx' },
    { keywords: ['asset', 'assets tab', 'image gallery', 'uploaded images'], target: 'AssetsTab.jsx' },
    { keywords: ['deploy tab', 'deployment', 'publish', 'hosting'], target: 'DeployTab.jsx' },
    { keywords: ['export tab', 'download', 'zip export'], target: 'ExportTab.jsx' },
    { keywords: ['prompt', 'classify intent', 'intent class', 'system prompt build'], target: 'prompt-builder.js' },
    { keywords: ['design', 'color token', 'theme', 'layout pattern', 'component pattern', 'tailwind'], target: 'design-system.js' },
    { keywords: ['image', 'art direct', 'stock photo', 'visual', 'image prefetch'], target: 'image-prefetch.js' },
    { keywords: ['stream engine', 'sse event', 'tool routing', 'message stream', 'agent loop'], target: 'message-stream.js' },
    { keywords: ['tool definition', 'patch_files tool', 'update_canvas tool', 'create_files tool', 'read_files tool', 'verify_build tool'], target: 'tools.js' },
    { keywords: ['plan valid', 'plan reject'], target: 'plan-validator.js' },
    { keywords: ['constant', 'self edit target', 'chat type'], target: 'constants.js' },
    { keywords: ['ai service', 'provider', 'model select', 'fallback'], target: 'service.js' },
    { keywords: ['stream client', 'sse client', 'frontend stream'], target: 'stream-client.js' },
    // Dashboard.jsx is LAST — only match if nothing else does (it's 3300+ lines, hard to patch)
    { keywords: ['dashboard', 'csv export', 'workspace tab', 'stream handling', 'send message function'], target: 'Dashboard.jsx' },
  ]
  for (const { keywords, target } of keywordMap) {
    if (keywords.some(k => lower.includes(k))) {
      const match = targets.find(t => t.path && t.path.endsWith(target))
      if (match) return match
    }
  }

  return null
}



/**
 * Apply <<<PATCHES>>> format to an original file.
 * Returns the patched content, or null if parsing fails.
 */
export function applyPatchContent(originalContent, patchContent) {
  if (!patchContent.trim().startsWith('<<<PATCHES>>>')) return null
  
  const blocks = patchContent.split('<<<END>>>').filter(b => b.includes('<<<SEARCH>>>'))
  if (blocks.length === 0) return null
  
  let result = originalContent
  let applied = 0
  let failed = 0
  
  for (const block of blocks) {
    const searchMatch = block.match(/<<<SEARCH>>>\n?([\s\S]*?)<<<REPLACE>>>\n?([\s\S]*?)$/)
    if (!searchMatch) { failed++; continue }
    
    const search = searchMatch[1].trimEnd()
    const replace = searchMatch[2].trimEnd()
    
    if (result.includes(search)) {
      result = result.replace(search, replace)
      applied++
    } else {
      // Try fuzzy match: trim each line and compare
      const searchLines = search.split('\n').map(l => l.trim()).join('\n')
      const resultLines = result.split('\n')
      let found = false
      for (let i = 0; i <= resultLines.length - search.split('\n').length; i++) {
        const window = resultLines.slice(i, i + search.split('\n').length).map(l => l.trim()).join('\n')
        if (window === searchLines) {
          const originalSlice = resultLines.slice(i, i + search.split('\n').length).join('\n')
          result = result.replace(originalSlice, replace)
          applied++
          found = true
          break
        }
      }
      if (!found) {
        // Level 3: normalize whitespace and compare
        const normalizeForMatch = (s) => s.split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(l => l.length > 0).join('\n')
        const searchNorm = normalizeForMatch(search)
        const searchNormLineCount = searchNorm.split('\n').length
        for (let i = 0; i <= resultLines.length - searchNormLineCount; i++) {
          const windowLines = resultLines.slice(i, i + searchNormLineCount + 2)
          const windowNorm = normalizeForMatch(windowLines.join('\n'))
          if (windowNorm.includes(searchNorm) || searchNorm.split('\n').every(sl => windowNorm.includes(sl))) {
            const matchLen = Math.min(searchNormLineCount + 2, windowLines.length)
            const originalSlice = resultLines.slice(i, i + matchLen).join('\n')
            result = result.replace(originalSlice, replace)
            applied++
            found = true
            break
          }
        }
      }
      if (!found) failed++
    }
  }
  
  console.log(`[SelfEdit-Patch] Applied ${applied}/${applied + failed} patches`)
  return applied > 0 ? result : null
}

/**
 * Validate that a modified file preserves all exports from the original.
 * Returns { valid: true } or { valid: false, missing: [...] }
 */
export function validateExportsPreserved(originalContent, newContent) {
  const exportRegex = /export\s+(?:default\s+)?(?:function|const|let|var|class|async\s+function)\s+(\w+)/g
  const originalExports = new Set()
  let match
  while ((match = exportRegex.exec(originalContent)) !== null) {
    originalExports.add(match[1])
  }
  
  const missing = []
  for (const name of originalExports) {
    if (!newContent.includes(name)) {
      missing.push(name)
    }
  }
  
  return missing.length === 0 
    ? { valid: true, exports: [...originalExports] } 
    : { valid: false, missing, exports: [...originalExports] }
}


/**
 * Build verified response with runtime test data.
 * Returns { text, runtimeEvent } — caller yields the runtimeEvent if present.
 */
export function buildVerifiedResponseWithRuntime(savedFiles, userMessage, isRefinement, isSelfEdit = false) {
  const vResult = verifyPatchResult(savedFiles, userMessage)
  const interactionTests = generateInteractionTests(savedFiles, userMessage)
  const runtimeScript = generateRuntimeTestScript(vResult.checks || [], { interactionTests })
  // If runtime tests exist and code passed, mark as CODE_VERIFIED_ONLY
  if (runtimeScript && vResult.status === 'VERIFIED') {
    vResult.runtimeStatus = 'CODE_VERIFIED_ONLY'
  }
  const text = buildVerifiedPatchResponse(vResult, isRefinement, isSelfEdit, userMessage)
  const runtimeEvent = runtimeScript
    ? { event: 'runtime_tests', data: { script: runtimeScript, checks: (vResult.checks || []).map(c => ({ type: c.type, value: c.value })) } }
    : null
  return { text, runtimeEvent }
}

/**
 * Generate context-aware enhancement suggestions after a self-edit.
 * Uses the edited file's role + what the user just changed to suggest relevant next steps.
 */
export function generateSelfEditSuggestions(savedFiles, userMessage) {
  const paths = savedFiles.map(f => f.path || '').join(' ')
  const msgLower = (userMessage || '').toLowerCase()

  // Build a pool of suggestions per file type, excluding what the user just worked on
  const pool = []

  if (paths.includes('prompt-builder')) {
    const all = [
      { kw: ['accessibility', 'aria', 'a11y'], text: 'Add accessibility guidelines — enforce ARIA labels, heading hierarchy, and color contrast ratios in generated sites' },
      { kw: ['seo', 'meta tag', 'structured data'], text: 'Add SEO rules — auto-inject meta tags, Open Graph properties, and semantic HTML structure' },
      { kw: ['performance', 'lazy', 'code split'], text: 'Add performance patterns — lazy loading images, code splitting, and critical CSS inlining' },
      { kw: ['mobile', 'responsive', 'touch'], text: 'Strengthen mobile-first enforcement — minimum touch targets, viewport-aware breakpoints, swipe gestures' },
      { kw: ['error', 'fallback', 'empty state'], text: 'Add empty state and error boundary patterns — ensure generated apps handle missing data gracefully' },
      { kw: ['animation', 'transition', 'motion'], text: 'Define animation standards — entrance sequences, scroll-triggered reveals, and reduced-motion support' },
      { kw: ['typography', 'font', 'heading'], text: 'Refine typography rules — enforce a type scale, line-height ratios, and reading-width constraints' },
      { kw: ['form', 'input', 'validation'], text: 'Add form UX patterns — inline validation, autofocus, error messaging, and submit state feedback' },
    ]
    for (const s of all) {
      if (!s.kw.some(k => msgLower.includes(k))) pool.push(s.text)
    }
  }

  if (paths.includes('design-system')) {
    const all = [
      { kw: ['color', 'palette', 'token'], text: 'Add a contrast-checked color palette — auto-validate text/background pairs meet WCAG AA standards' },
      { kw: ['spacing', 'gap', 'margin', 'padding'], text: 'Define a spacing scale with golden-ratio increments for consistent vertical rhythm' },
      { kw: ['shadow', 'elevation', 'depth'], text: 'Add elevation tokens — shadow presets for cards, modals, popovers, and floating elements' },
      { kw: ['breakpoint', 'responsive', 'mobile'], text: 'Add container query breakpoints alongside viewport breakpoints for component-level responsiveness' },
      { kw: ['border', 'radius', 'corner'], text: 'Define border radius tokens — pill, rounded, subtle, and sharp presets per component type' },
      { kw: ['font', 'typography', 'type'], text: 'Add a fluid typography system — font sizes that scale smoothly between mobile and desktop viewports' },
      { kw: ['animation', 'motion', 'transition'], text: 'Add micro-interaction timing presets — hover (150ms), entrance (300ms), page transition (500ms)' },
      { kw: ['gradient', 'mesh', 'blend'], text: 'Add gradient presets — hero backgrounds, card overlays, and text gradient effects' },
    ]
    for (const s of all) {
      if (!s.kw.some(k => msgLower.includes(k))) pool.push(s.text)
    }
  }

  if (paths.includes('image-prefetch') || paths.includes('image')) {
    const all = [
      { kw: ['aspect', 'ratio', 'crop'], text: 'Add smart aspect ratio selection — landscape for hero, portrait for team, square for features' },
      { kw: ['fallback', 'error', 'fail'], text: 'Add tiered fallback — AI image → stock photo → gradient placeholder → solid color' },
      { kw: ['style', 'vibe', 'mood'], text: 'Expand the vibe lexicon — add industry-specific art direction (tech=minimal, food=warm, finance=trust)' },
      { kw: ['compress', 'optimize', 'size'], text: 'Add image optimization pipeline — auto-compress, resize to container, generate srcset for responsive loading' },
    ]
    for (const s of all) {
      if (!s.kw.some(k => msgLower.includes(k))) pool.push(s.text)
    }
  }

  if (paths.includes('plan-validator')) {
    const all = [
      { kw: ['dependency', 'import', 'resolve'], text: 'Add file dependency graph validation — ensure imports are resolved before files that use them' },
      { kw: ['complexity', 'ceiling', 'limit', 'too many'], text: 'Add a complexity ceiling — reject plans with >8 simultaneous file changes and suggest breaking into phases' },
      { kw: ['rollback', 'safety', 'score'], text: 'Add rollback safety scoring — flag plans that modify >50% of a file without clear search/replace anchors' },
    ]
    for (const s of all) {
      if (!s.kw.some(k => msgLower.includes(k))) pool.push(s.text)
    }
  }

  if (paths.includes('service') || paths.includes('request_router')) {
    const all = [
      { kw: ['confidence', 'threshold', 'clarif'], text: 'Add intent confidence routing — send to clarification dialog when confidence < 0.6' },
      { kw: ['cache', 'pattern', 'repeat'], text: 'Cache successful prompt→action patterns for instant routing on repeat requests' },
      { kw: ['memory', 'remember', 'earlier', 'previous'], text: 'Add conversation memory — detect when user references "the thing I asked about earlier"' },
    ]
    for (const s of all) {
      if (!s.kw.some(k => msgLower.includes(k))) pool.push(s.text)
    }
  }

  if (paths.includes('feature_planner') || paths.includes('safe_apply')) {
    const all = [
      { kw: ['pre-flight', 'preflight', 'validate', 'validation'], text: 'Add pre-flight checks — validate that plan file paths exist and imports resolve before execution' },
      { kw: ['incremental', 'rollback', 'one at a time'], text: 'Add incremental apply — write files one at a time with rollback on first failure' },
      { kw: ['time', 'estimation', 'duration', '10s', '30s'], text: 'Add execution time estimation — show "~10s" or "~30s" based on file count and complexity' },
      { kw: ['priority', 'order', 'dependency'], text: 'Add task priority ordering — execute critical path files first, defer cosmetic changes' },
      { kw: ['dry run', 'simulate', 'preview'], text: 'Add dry-run mode — simulate the plan execution and show what would change without writing files' },
      { kw: ['progress', 'status', 'indicator'], text: 'Add granular progress tracking — emit per-file status updates during plan execution' },
    ]
    for (const s of all) {
      if (!s.kw.some(k => msgLower.includes(k))) pool.push(s.text)
    }
  }

  // Universal filter: remove any suggestion that overlaps significantly with what the user just asked for
  const filteredPool = pool.filter(suggestion => {
    const sugWords = suggestion.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    const matchCount = sugWords.filter(w => msgLower.includes(w)).length
    return matchCount < 3 // Remove if 3+ significant words match the user's message
  })

  // If filtering removed everything, use generic suggestions
  const finalPool = filteredPool.length > 0 ? filteredPool : [
    'Add unit tests for the functions you just modified',
    'Add input validation to exported functions — guard against undefined/null parameters',
    'Add structured logging (console.log with [Tag]) for easier debugging of this module',
  ]

  // Shuffle and pick 3
  for (let i = finalPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[finalPool[i], finalPool[j]] = [finalPool[j], finalPool[i]]
  }

  return finalPool.slice(0, 3)
}
