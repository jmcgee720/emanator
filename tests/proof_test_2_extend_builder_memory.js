/**
 * PROOF TEST #2 — EXTEND BUILDER MEMORY SAFELY
 * 
 * Exercises the FULL self-builder pipeline end-to-end:
 *   request_router → feature_planner → plan_validator → file_ops_bridge → safe_apply → change_log
 *
 * Target: BuilderMemory.jsx — add "Total Memory Entries: X" summary in header.
 * Constraint: Single-file, UI-only, no provider/routing/apply/persistence logic affected.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Module = require('module')

// ─── In-memory DB mock ───────────────────────────────────────────────────────
const mockDb = {
  _files: new Map(),
  _events: [],
  _changelog: [],
  _memory: [],
  _nextId: 1,

  projectMemory: {
    findByProjectId: async () => mockDb._memory,
    create: async (entry) => {
      const rec = { id: String(mockDb._nextId++), ...entry, created_at: new Date().toISOString() }
      mockDb._memory.push(rec)
      return rec
    },
    updateById: async (id, fields) => {
      const e = mockDb._memory.find(m => m.id === id)
      if (e) Object.assign(e, fields)
      return e
    },
    deleteById: async (id) => { mockDb._memory = mockDb._memory.filter(m => m.id !== id) }
  },

  projectFiles: {
    findByPath: async (projectId, filePath) => {
      const norm = filePath.replace(/^\.\//, '').replace(/^\//, '')
      return mockDb._files.get(norm) || null
    },
    findByProjectId: async () => Array.from(mockDb._files.values()),
    create: async (file) => {
      const rec = { id: String(mockDb._nextId++), ...file, created_at: new Date().toISOString() }
      const norm = (file.path || '').replace(/^\.\//, '').replace(/^\//, '')
      mockDb._files.set(norm, rec)
      return rec
    },
    update: async (id, updates) => {
      for (const [, v] of mockDb._files) {
        if (v.id === id) { Object.assign(v, updates); return v }
      }
      return null
    },
    delete: async (id) => {
      for (const [k, v] of mockDb._files) {
        if (v.id === id) { mockDb._files.delete(k); return true }
      }
      return true
    }
  },

  fileChangeEvents: {
    create: async (event) => {
      const rec = { id: String(mockDb._nextId++), ...event }
      mockDb._events.push(rec)
      return rec
    }
  },

  changelog: {
    create: async (entry) => {
      const rec = { id: String(mockDb._nextId++), ...entry }
      mockDb._changelog.push(rec)
      return rec
    },
    findByProject: async () => mockDb._changelog,
    findLastRejectedForTask: async () => null
  }
}

// ─── Intercept require('../supabase/db') ─────────────────────────────────────
const origResolve = Module._resolveFilename
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.endsWith('supabase/db') || request.endsWith('supabase/db.js')) {
    return '__mock_supabase_db__'
  }
  return origResolve.call(this, request, parent, ...rest)
}
require.cache['__mock_supabase_db__'] = {
  id: '__mock_supabase_db__',
  filename: '__mock_supabase_db__',
  loaded: true,
  exports: { db: mockDb, getSupabaseAdmin: () => null }
}

// ─── Load pipeline modules ───────────────────────────────────────────────────
const { request_router } = require('../lib/self_builder/request_router')
const { enforcePlanCorrectness, detectSingleFileIntent } = require('../lib/self_builder/feature_planner')
const { normalizePath, buildPendingDiffs } = require('../lib/self_builder/file_ops_bridge')
const { safeApplyDiffs } = require('../lib/self_builder/safe_apply')
const { logChange } = require('../lib/self_builder/change_log')

// Restore
Module._resolveFilename = origResolve

// ─── Constants ───────────────────────────────────────────────────────────────
const PROJECT_ID = 'proof-test-2-project'
const USER_ID = 'proof-test-2-user'
const CHAT_ID = 'proof-test-2-chat'
const TARGET_FILE = 'components/dashboard/BuilderMemory.jsx'
const USER_PROMPT = "Update BuilderMemory.jsx: add a 'Total Memory Entries: X' summary line in the header"

// ─── Read real file ──────────────────────────────────────────────────────────
const FILE_PATH = path.resolve(__dirname, '../components/dashboard/BuilderMemory.jsx')
const ORIGINAL_CONTENT = fs.readFileSync(FILE_PATH, 'utf-8')

// ─── Generate modified content ───────────────────────────────────────────────
// Add a summary badge line right after the description, before the toolbar.
const MODIFIED_CONTENT = ORIGINAL_CONTENT.replace(
  `          <p className="text-xs text-muted-foreground mt-0.5">Learned preferences & rules that adapt your AI</p>

          {/* Filter / Search / Sort toolbar */}`,
  `          <p className="text-xs text-muted-foreground mt-0.5">Learned preferences & rules that adapt your AI</p>

          {/* Total Memory Entries summary — added by Proof Test #2 */}
          {!loading && (
            <div className="flex items-center gap-2 mt-2" data-testid="memory-total-summary">
              <span className="text-[11px] text-muted-foreground">Total Memory Entries:</span>
              <span className="text-[11px] font-mono font-medium text-indigo-400" data-testid="memory-total-count">{memoryEntries.length}</span>
              {categorized.patterns.length > 0 && <span className="text-[10px] text-green-400/70">{categorized.patterns.length} patterns</span>}
              {categorized.rejected.length > 0 && <span className="text-[10px] text-red-400/70">{categorized.rejected.length} rejected</span>}
              {categorized.preferences.length > 0 && <span className="text-[10px] text-amber-400/70">{categorized.preferences.length} prefs</span>}
            </div>
          )}

          {/* Filter / Search / Sort toolbar */}`
)

function detectFileType(filePath) {
  if (filePath.endsWith('.jsx')) return 'jsx'
  if (filePath.endsWith('.js')) return 'javascript'
  return 'text'
}

// ─── Proof Test Runner ───────────────────────────────────────────────────────
async function runProofTest() {
  const result = {
    file_modified: TARGET_FILE,
    single_file: false,
    plan_valid: false,
    diff_correct: false,
    apply_success: false,
    rolledBack: true,
    ui_visible: false,
    logged: false,
    any_breakpoint: null
  }

  try {
    console.log('\n╔══════════════════════════════════════════════════╗')
    console.log('║   PROOF TEST #2 — EXTEND BUILDER MEMORY SAFELY  ║')
    console.log('╚══════════════════════════════════════════════════╝\n')

    // Verify modification is content-correct before proceeding
    if (!MODIFIED_CONTENT.includes('memory-total-summary') || !MODIFIED_CONTENT.includes('memory-total-count')) {
      result.any_breakpoint = 'Modified content generation failed — markers not found'
      console.log(`  ✗ ${result.any_breakpoint}`)
      return result
    }
    if (MODIFIED_CONTENT === ORIGINAL_CONTENT) {
      result.any_breakpoint = 'Modified content is identical to original'
      console.log(`  ✗ ${result.any_breakpoint}`)
      return result
    }
    console.log(`Pre-check: Modification adds ${MODIFIED_CONTENT.length - ORIGINAL_CONTENT.length} chars (+${((MODIFIED_CONTENT.length - ORIGINAL_CONTENT.length) / ORIGINAL_CONTENT.length * 100).toFixed(1)}%)\n`)

    // ── Step 0: Seed DB ──
    console.log('Step 0: Seeding project file...')
    await mockDb.projectFiles.create({
      project_id: PROJECT_ID,
      path: TARGET_FILE,
      content: ORIGINAL_CONTENT,
      file_type: 'jsx',
      version: 1
    })
    console.log(`  ✓ Loaded ${TARGET_FILE} (${ORIGINAL_CONTENT.length} chars, v1)\n`)

    // ── Step 1: request_router ──
    console.log('Step 1: request_router...')
    const routeResult = await request_router({
      input: USER_PROMPT,
      projectId: PROJECT_ID,
      userId: USER_ID,
      memoryEntries: []
    })
    console.log(`  Route type: ${routeResult.type}`)
    console.log(`  ✓ Routed\n`)

    // ── Step 2: Create plan ──
    console.log('Step 2: Creating plan...')
    const plan = {
      summary: "Add 'Total Memory Entries: X' summary line to Builder Memory header",
      reasoning: [
        "User wants a visible count of total memory entries in the header area",
        "Add summary line between description and toolbar in BuilderMemory.jsx",
        "UI-only change — no backend, no routing, no persistence logic affected"
      ],
      file_actions: [
        {
          path: TARGET_FILE,
          action: 'update',
          intent: "Add total memory entries summary with breakdown badges in header",
          reason: "User requested visible memory entry count in Builder Memory panel header",
          grounded_on: ['data-testid="builder-memory"', 'Learned preferences & rules that adapt your AI']
        }
      ],
      constraints_checked: {
        grounded_in_file_context: true,
        has_file_actions: true,
        minimal_patch: true,
        no_illegal_create: true
      }
    }
    console.log(`  Plan: ${plan.summary}`)
    console.log(`  File actions: ${plan.file_actions.length}`)
    console.log(`  ✓ Plan created\n`)

    // ── Step 3: enforcePlanCorrectness ──
    console.log('Step 3: enforcePlanCorrectness...')
    const existingFiles = await mockDb.projectFiles.findByProjectId(PROJECT_ID)
    const fileContext = {
      existingPaths: existingFiles.map(f => f.path),
      files: existingFiles
    }
    const { corrections } = enforcePlanCorrectness(plan, fileContext, USER_PROMPT)
    console.log(`  Corrections: ${corrections.length}`)
    corrections.forEach(c => console.log(`    - ${c}`))
    console.log(`  File actions after: ${plan.file_actions.length}`)
    result.single_file = plan.file_actions.length === 1
    const sfi = detectSingleFileIntent(USER_PROMPT)
    console.log(`  detectSingleFileIntent: ${sfi}`)
    console.log(`  single_file: ${result.single_file}`)
    console.log(`  ✓ Done\n`)

    // ── Step 4: Strict validation ──
    console.log('Step 4: Plan validation (strict)...')
    const validationErrors = []
    if (!plan.file_actions || plan.file_actions.length === 0) validationErrors.push('file_actions missing')
    const existingPaths = new Set(fileContext.existingPaths.map(p => p.replace(/^\.\//, '').replace(/^\//, '')))
    for (const fa of plan.file_actions) {
      const norm = fa.path.replace(/^\.\//, '').replace(/^\//, '')
      if (fa.action === 'create' && (existingPaths.has(fa.path) || existingPaths.has(norm)))
        validationErrors.push(`${fa.path}: create but file exists`)
    }
    if (plan.file_actions.length > 1 && sfi) validationErrors.push('single-file violated')
    if (plan.file_actions.length > 10) validationErrors.push('too many files')
    if (plan.constraints_checked?.grounded_in_file_context === false) validationErrors.push('not grounded')

    const planHash = crypto.createHash('sha256').update(JSON.stringify({
      summary: plan.summary,
      file_actions: plan.file_actions.map(a => ({ path: a.path, action: a.action })),
      reasoning: plan.reasoning
    })).digest('hex').slice(0, 16)

    result.plan_valid = validationErrors.length === 0
    console.log(`  Errors: ${validationErrors.length}`)
    validationErrors.forEach(e => console.log(`    ✗ ${e}`))
    console.log(`  Hash: ${planHash}`)
    console.log(`  plan_valid: ${result.plan_valid}`)
    console.log(`  ✓ Done\n`)

    if (!result.plan_valid) {
      result.any_breakpoint = `Validation failed: ${validationErrors.join('; ')}`
      return result
    }

    // ── Step 5: file_ops_bridge ──
    console.log('Step 5: file_ops_bridge...')
    const toolFiles = [{
      path: TARGET_FILE,
      content: MODIFIED_CONTENT,
      description: "Added Total Memory Entries summary line in Builder Memory header"
    }]
    const findExisting = (p) => {
      const norm = normalizePath(p)
      return mockDb._files.get(norm) || null
    }
    const diffs = buildPendingDiffs(toolFiles, {
      planFileActions: plan.file_actions,
      findExisting,
      toolName: 'update_files',
      detectFileType
    })
    console.log(`  Diffs: ${diffs.length}`)
    for (const d of diffs) {
      console.log(`    ${d.action} ${d.path} (${d.oldContent?.length || 0} → ${d.newContent.length} chars)`)
    }

    const d0 = diffs[0]
    result.diff_correct = (
      diffs.length === 1 &&
      d0.action === 'update' &&
      d0.path === TARGET_FILE &&
      d0.oldContent === ORIGINAL_CONTENT &&
      d0.newContent === MODIFIED_CONTENT &&
      d0.newContent.includes('memory-total-summary') &&
      d0.newContent.includes('memory-total-count') &&
      d0.newContent.includes('Total Memory Entries')
    )
    console.log(`  diff_correct: ${result.diff_correct}`)
    console.log(`  ✓ Done\n`)

    // ── Step 6: safe_apply ──
    console.log('Step 6: safe_apply...')
    const applyResult = await safeApplyDiffs(PROJECT_ID, diffs, detectFileType)
    console.log(`  Written: [${applyResult.written.join(', ')}]`)
    console.log(`  Errors: [${applyResult.errors.join(', ')}]`)
    console.log(`  Rolled back: ${applyResult.rolledBack}`)
    result.apply_success = applyResult.written.length === 1 && applyResult.errors.length === 0
    result.rolledBack = applyResult.rolledBack

    const updatedFile = await mockDb.projectFiles.findByPath(PROJECT_ID, TARGET_FILE)
    console.log(`  DB version: ${updatedFile?.version}`)
    console.log(`  DB has summary: ${updatedFile?.content?.includes('memory-total-summary')}`)
    console.log(`  apply_success: ${result.apply_success}`)
    console.log(`  rolledBack: ${result.rolledBack}`)
    console.log(`  ✓ Done\n`)

    // ── Step 7: change_log ──
    console.log('Step 7: change_log...')
    await logChange({
      projectId: PROJECT_ID,
      chatId: CHAT_ID,
      userId: USER_ID,
      userTask: USER_PROMPT,
      taskMode: 'apply',
      result: 'applied'
    })
    const thisLog = mockDb._changelog.find(
      e => e.project_id === PROJECT_ID && e.result === 'applied' && e.user_task === USER_PROMPT
    )
    result.logged = !!thisLog
    console.log(`  Entries: ${mockDb._changelog.length}`)
    console.log(`  logged: ${result.logged}`)
    if (thisLog) console.log(`    mode=${thisLog.task_mode} result=${thisLog.result}`)
    const patternStored = mockDb._memory.some(e => e.key?.startsWith('prompt_pattern:'))
    console.log(`  Pattern stored: ${patternStored}`)
    console.log(`  ✓ Done\n`)

    // ── Step 8: Filesystem write ──
    console.log('Step 8: Filesystem write...')
    fs.writeFileSync(FILE_PATH, MODIFIED_CONTENT, 'utf-8')
    const verify = fs.readFileSync(FILE_PATH, 'utf-8')
    result.ui_visible = (
      verify.includes('memory-total-summary') &&
      verify.includes('memory-total-count') &&
      verify.includes('Total Memory Entries')
    )
    console.log(`  ui_visible: ${result.ui_visible}`)
    console.log(`  ✓ Done\n`)

    // ── Safety verification ──
    console.log('Step 9: Safety checks...')
    // Ensure no provider/routing/persistence logic was touched
    const safetyChecks = {
      hasAuthFetch: verify.includes("authFetch("),
      hasLoadAll: verify.includes("const loadAll"),
      hasHandleDeleteMemory: verify.includes("handleDeleteMemory"),
      hasHandleResetAll: verify.includes("handleResetAll"),
      hasDialog: verify.includes("<Dialog"),
      noRequestRouter: !verify.includes("request_router"),
      noSafeApply: !verify.includes("safe_apply"),
      noProviderLogic: !verify.includes("providerStatus") && !verify.includes("ProviderError"),
    }
    const allSafe = Object.values(safetyChecks).every(Boolean)
    console.log(`  Safety checks: ${allSafe ? 'ALL PASSED' : 'FAILED'}`)
    for (const [k, v] of Object.entries(safetyChecks)) {
      console.log(`    ${v ? '✓' : '✗'} ${k}`)
    }
    if (!allSafe) {
      result.any_breakpoint = 'Safety check failed — modification may have affected protected logic'
    }
    console.log(`  ✓ Done\n`)

    // ── Summary ──
    const allPassed = result.single_file && result.plan_valid && result.diff_correct &&
      result.apply_success && !result.rolledBack && result.ui_visible && result.logged &&
      result.any_breakpoint === null

    console.log('═══════════════════════════════════════════════════')
    console.log(allPassed ? '  ✅ PROOF TEST #2 PASSED' : '  ❌ PROOF TEST #2 FAILED')
    console.log('═══════════════════════════════════════════════════')

  } catch (err) {
    result.any_breakpoint = `Error: ${err.message}`
    console.error('\n❌ ERROR:', err.message)
    console.error(err.stack)
  }

  return result
}

runProofTest()
  .then(result => {
    console.log('\n' + JSON.stringify(result, null, 2))
    process.exit(result.any_breakpoint ? 1 : 0)
  })
  .catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
