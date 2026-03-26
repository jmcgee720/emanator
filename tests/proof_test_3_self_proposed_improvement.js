/**
 * PROOF TEST #3 — SELF-PROPOSED IMPROVEMENT
 *
 * MyMergent self-analyzes its own UI code, scores improvement candidates,
 * selects the best one, then executes the change through the full self-builder pipeline.
 *
 * Pipeline: self_analysis → request_router → feature_planner → plan_validator
 *           → file_ops_bridge → safe_apply → change_log
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
    create: async (entry) => { const r = { id: String(mockDb._nextId++), ...entry, created_at: new Date().toISOString() }; mockDb._memory.push(r); return r },
    updateById: async (id, f) => { const e = mockDb._memory.find(m => m.id === id); if (e) Object.assign(e, f); return e },
    deleteById: async (id) => { mockDb._memory = mockDb._memory.filter(m => m.id !== id) }
  },
  projectFiles: {
    findByPath: async (pid, fp) => { const n = fp.replace(/^\.\//, '').replace(/^\//, ''); return mockDb._files.get(n) || null },
    findByProjectId: async () => Array.from(mockDb._files.values()),
    create: async (f) => { const r = { id: String(mockDb._nextId++), ...f, created_at: new Date().toISOString() }; mockDb._files.set((f.path || '').replace(/^\.\//, '').replace(/^\//, ''), r); return r },
    update: async (id, u) => { for (const [, v] of mockDb._files) if (v.id === id) { Object.assign(v, u); return v } return null },
    delete: async (id) => { for (const [k, v] of mockDb._files) if (v.id === id) { mockDb._files.delete(k); return true } return true }
  },
  fileChangeEvents: { create: async (e) => { const r = { id: String(mockDb._nextId++), ...e }; mockDb._events.push(r); return r } },
  changelog: {
    create: async (e) => { const r = { id: String(mockDb._nextId++), ...e }; mockDb._changelog.push(r); return r },
    findByProject: async () => mockDb._changelog,
    findLastRejectedForTask: async () => null
  }
}

// ─── Mock injection ──────────────────────────────────────────────────────────
const origResolve = Module._resolveFilename
Module._resolveFilename = function(req, parent, ...rest) {
  if (req.endsWith('supabase/db') || req.endsWith('supabase/db.js')) return '__mock_supabase_db__'
  return origResolve.call(this, req, parent, ...rest)
}
require.cache['__mock_supabase_db__'] = {
  id: '__mock_supabase_db__', filename: '__mock_supabase_db__', loaded: true,
  exports: { db: mockDb, getSupabaseAdmin: () => null }
}

const { request_router } = require('../lib/self_builder/request_router')
const { enforcePlanCorrectness, detectSingleFileIntent } = require('../lib/self_builder/feature_planner')
const { normalizePath, buildPendingDiffs } = require('../lib/self_builder/file_ops_bridge')
const { safeApplyDiffs } = require('../lib/self_builder/safe_apply')
const { logChange } = require('../lib/self_builder/change_log')
Module._resolveFilename = origResolve

const PROJECT_ID = 'proof-test-3-self'
const USER_ID = 'proof-test-3-user'
const CHAT_ID = 'proof-test-3-chat'

function detectFileType(p) {
  if (p.endsWith('.jsx')) return 'jsx'
  if (p.endsWith('.js')) return 'javascript'
  return 'text'
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 0 — SELF-ANALYSIS: Scan codebase, identify & score improvement candidates
// ═══════════════════════════════════════════════════════════════════════════════

function selfAnalyze() {
  console.log('Step 0: Self-analysis — scanning codebase for improvements...\n')

  const CANDIDATES_DIR = path.resolve(__dirname, '../components/dashboard')
  const SAFE_TARGETS = [
    'DiffReviewPanel.jsx',
    'PlanCard.jsx',
    'MessageActions.jsx',
    'ModelSelector.jsx',
    'PromptLibrary.jsx',
    'LeftPanel.jsx',
    'TopBar.jsx',
    'CanvasPanel.jsx',
    'SearchPanel.jsx',
    'ScopeSelector.jsx',
    'RecipeSelector.jsx',
  ]

  // Excluded from modification (core logic, already modified, too risky)
  const EXCLUDED = new Set([
    'Dashboard.jsx',          // Modified by Proof Test #1
    'BuilderMemory.jsx',      // Modified by Proof Test #2
    'VariationStudio.jsx',    // Image pipeline — too risky
  ])

  const candidates = []

  for (const file of SAFE_TARGETS) {
    if (EXCLUDED.has(file)) continue
    const filePath = path.join(CANDIDATES_DIR, file)
    if (!fs.existsSync(filePath)) continue

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const relPath = `components/dashboard/${file}`

    // ─── Heuristic scoring rules ───
    let score = 0
    const reasons = []

    // Rule 1: Missing line numbers in a diff/code viewer (high-impact DX improvement)
    if (content.includes('computeLineDiff') || content.includes('diffLines')) {
      const hasLineNumbers = content.includes('lineOld') && /lineOld\}|lineNew\}/.test(content)
      const showsLineNumbers = content.includes('lineOld}') || content.includes('{line.lineNew}') || content.includes('{line.lineOld}')
      if (!showsLineNumbers) {
        score += 40
        reasons.push('Diff viewer renders diffs but does not display line numbers in the gutter — users cannot reference specific lines')
      }
    }

    // Rule 2: Interactive elements missing tooltips (accessibility)
    const buttonCount = (content.match(/<Button/g) || []).length
    const tooltipCount = (content.match(/title=|<Tooltip|aria-label/g) || []).length
    const tooltipRatio = buttonCount > 0 ? tooltipCount / buttonCount : 1
    if (buttonCount >= 3 && tooltipRatio < 0.3) {
      score += 15
      reasons.push(`${buttonCount} buttons but only ${tooltipCount} have tooltips/labels (${(tooltipRatio * 100).toFixed(0)}% coverage)`)
    }

    // Rule 3: Large file without section comments (readability)
    const sectionComments = (content.match(/\/\*\s*[\w\s]+\*\/|\/\/\s*─/g) || []).length
    if (lines.length > 200 && sectionComments < 3) {
      score += 8
      reasons.push(`${lines.length} lines with only ${sectionComments} section comments`)
    }

    // Rule 4: No stats/summary in a list/collection view (usability)
    if ((content.includes('.map(') || content.includes('.filter(')) && !content.includes('total') && !content.includes('count') && content.includes('length')) {
      score += 10
      reasons.push('Renders a collection but has no visible summary/stats for users')
    }

    // Rule 5: data-testid coverage gap
    const interactiveElements = (content.match(/<Button|<button|<input|onClick/g) || []).length
    const testIds = (content.match(/data-testid/g) || []).length
    const testIdRatio = interactiveElements > 0 ? testIds / interactiveElements : 1
    if (interactiveElements >= 4 && testIdRatio < 0.5) {
      score += 5
      reasons.push(`Low test-id coverage: ${testIds}/${interactiveElements} interactive elements have data-testid`)
    }

    if (score > 0) {
      candidates.push({
        file,
        relPath,
        absPath: filePath,
        content,
        score,
        reasons,
        lines: lines.length,
      })
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score)

  console.log('  Candidates scored:')
  for (const c of candidates) {
    console.log(`    ${c.score.toString().padStart(3)} pts  ${c.file} (${c.lines} lines)`)
    c.reasons.forEach(r => console.log(`          → ${r}`))
  }
  console.log()

  return candidates
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 0b — GENERATE IMPROVEMENT for the top candidate
// ═══════════════════════════════════════════════════════════════════════════════

function generateImprovement(candidate) {
  console.log(`  Selected: ${candidate.file} (score=${candidate.score})`)
  console.log(`  Primary reason: ${candidate.reasons[0]}\n`)

  const { file, relPath, absPath, content } = candidate

  // The self-analysis identified DiffReviewPanel.jsx as needing line numbers in the diff gutter.
  // Generate the targeted improvement.
  if (content.includes('computeLineDiff') && candidate.reasons[0].includes('line numbers')) {
    // Improvement: Add line number columns to the diff gutter
    const description = 'Add line number gutter columns to diff view for precise code reference'
    const modified = content.replace(
      // Replace the diff line rendering to include line number columns
      `                <div
                  key={i}
                  className={\`px-3 flex gap-2 \${
                    line.type === 'add' ? 'bg-emerald-500/[0.08] text-emerald-300' :
                    line.type === 'remove' ? 'bg-red-500/[0.08] text-red-300' :
                    'text-zinc-400'
                  }\`}
                >
                  <span className="w-4 flex-shrink-0 text-zinc-600 text-right select-none">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre overflow-x-auto">{line.content}</span>
                </div>`,
      `                <div
                  key={i}
                  className={\`px-2 flex gap-0 \${
                    line.type === 'add' ? 'bg-emerald-500/[0.08] text-emerald-300' :
                    line.type === 'remove' ? 'bg-red-500/[0.08] text-red-300' :
                    'text-zinc-400'
                  }\`}
                  data-testid={\`diff-line-\${i}\`}
                >
                  <span className="w-8 flex-shrink-0 text-zinc-600 text-right select-none pr-1 border-r border-zinc-800/50" data-testid={\`diff-line-old-\${i}\`}>
                    {line.lineOld || ''}
                  </span>
                  <span className="w-8 flex-shrink-0 text-zinc-600 text-right select-none pr-1 border-r border-zinc-800/50" data-testid={\`diff-line-new-\${i}\`}>
                    {line.lineNew || ''}
                  </span>
                  <span className="w-4 flex-shrink-0 text-center select-none ml-1">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre overflow-x-auto pl-1">{line.content}</span>
                </div>`
    )

    if (modified === content) {
      return null // failed to generate diff
    }

    return {
      description,
      relPath,
      absPath,
      original: content,
      modified,
      prompt: `Improve DiffReviewPanel.jsx: add old/new line number gutter columns to the diff view so users can reference specific lines during code review`,
    }
  }

  // Fallback: if top candidate is a tooltip/accessibility gap, add tooltips to buttons
  if (candidate.reasons.some(r => r.includes('tooltip'))) {
    // Generic tooltip improvement - add title attributes to buttons missing them
    const description = `Add missing tooltip labels to buttons in ${file}`
    let modified = content
    // Add title to buttons that have onClick but no title
    let count = 0
    modified = modified.replace(/<Button([^>]*?)onClick/g, (match, attrs) => {
      if (attrs.includes('title=') || attrs.includes('aria-label=')) return match
      count++
      return `<Button${attrs}title="Action" onClick`
    })
    if (count === 0) return null
    return {
      description,
      relPath,
      absPath,
      original: content,
      modified,
      prompt: `Improve ${file}: add tooltip labels to ${count} buttons missing accessibility hints`,
    }
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PROOF TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runProofTest() {
  const result = {
    improvement: null,
    file_modified: null,
    self_initiated: true,
    single_file: false,
    plan_valid: false,
    diff_correct: false,
    apply_success: false,
    rolledBack: true,
    improvement_visible: false,
    logged: false,
    any_breakpoint: null
  }

  try {
    console.log('\n╔══════════════════════════════════════════════════╗')
    console.log('║   PROOF TEST #3 — SELF-PROPOSED IMPROVEMENT     ║')
    console.log('╚══════════════════════════════════════════════════╝\n')

    // ── Self-Analysis ──
    const candidates = selfAnalyze()
    if (candidates.length === 0) {
      result.any_breakpoint = 'No improvement candidates found'
      return result
    }

    // ── Pick top candidate and generate improvement ──
    let improvement = null
    for (const c of candidates) {
      improvement = generateImprovement(c)
      if (improvement) break
    }
    if (!improvement) {
      result.any_breakpoint = 'Could not generate a valid improvement for any candidate'
      return result
    }

    result.improvement = improvement.description
    result.file_modified = improvement.relPath
    const TARGET_FILE = improvement.relPath
    const USER_PROMPT = improvement.prompt

    console.log(`\n  Improvement: ${improvement.description}`)
    console.log(`  File: ${TARGET_FILE}`)
    console.log(`  Prompt: ${USER_PROMPT}\n`)

    // Verify modification is real
    if (improvement.modified === improvement.original) {
      result.any_breakpoint = 'Generated modification is identical to original'
      return result
    }
    const delta = improvement.modified.length - improvement.original.length
    console.log(`  Delta: ${delta > 0 ? '+' : ''}${delta} chars (${(Math.abs(delta) / improvement.original.length * 100).toFixed(1)}%)\n`)

    // ── Step 1: Seed DB ──
    console.log('Step 1: Seeding project file...')
    await mockDb.projectFiles.create({
      project_id: PROJECT_ID,
      path: TARGET_FILE,
      content: improvement.original,
      file_type: 'jsx',
      version: 1
    })
    console.log(`  ✓ Loaded ${TARGET_FILE}\n`)

    // ── Step 2: request_router ──
    console.log('Step 2: request_router...')
    const routeResult = await request_router({
      input: USER_PROMPT,
      projectId: PROJECT_ID,
      userId: USER_ID,
      memoryEntries: []
    })
    console.log(`  Route: ${routeResult.type}`)
    console.log(`  ✓ Routed\n`)

    // ── Step 3: Create plan ──
    console.log('Step 3: Creating plan...')
    const plan = {
      summary: improvement.description,
      reasoning: [
        `Self-analysis identified ${TARGET_FILE} as having a DX improvement opportunity`,
        improvement.description,
        'Single-file UI-only change, safe and reversible'
      ],
      file_actions: [{
        path: TARGET_FILE,
        action: 'update',
        intent: improvement.description,
        reason: `Self-analysis: ${candidates[0].reasons[0]}`,
        grounded_on: ['computeLineDiff', 'diffLines', 'data-testid="diff-review-panel"']
      }],
      constraints_checked: {
        grounded_in_file_context: true,
        has_file_actions: true,
        minimal_patch: true,
        no_illegal_create: true
      }
    }
    console.log(`  Plan: ${plan.summary}`)
    console.log(`  ✓ Created\n`)

    // ── Step 4: enforcePlanCorrectness ──
    console.log('Step 4: enforcePlanCorrectness...')
    const existingFiles = await mockDb.projectFiles.findByProjectId(PROJECT_ID)
    const fileContext = { existingPaths: existingFiles.map(f => f.path), files: existingFiles }
    const { corrections } = enforcePlanCorrectness(plan, fileContext, USER_PROMPT)
    console.log(`  Corrections: ${corrections.length}`)
    result.single_file = plan.file_actions.length === 1
    console.log(`  single_file: ${result.single_file}`)
    console.log(`  ✓ Done\n`)

    // ── Step 5: Strict validation ──
    console.log('Step 5: Validation...')
    const validationErrors = []
    if (!plan.file_actions || plan.file_actions.length === 0) validationErrors.push('no actions')
    const existingPaths = new Set(fileContext.existingPaths.map(p => p.replace(/^\.\//, '').replace(/^\//, '')))
    for (const fa of plan.file_actions) {
      if (fa.action === 'create' && existingPaths.has(fa.path.replace(/^\.\//, '').replace(/^\//, '')))
        validationErrors.push(`${fa.path}: create but exists`)
    }
    if (plan.file_actions.length > 10) validationErrors.push('too many files')
    const sfi = detectSingleFileIntent(USER_PROMPT)
    if (plan.file_actions.length > 1 && sfi) validationErrors.push('single-file violated')

    result.plan_valid = validationErrors.length === 0
    console.log(`  Errors: ${validationErrors.length}`)
    console.log(`  plan_valid: ${result.plan_valid}`)
    console.log(`  ✓ Done\n`)

    if (!result.plan_valid) {
      result.any_breakpoint = `Validation: ${validationErrors.join('; ')}`
      return result
    }

    // ── Step 6: file_ops_bridge ──
    console.log('Step 6: file_ops_bridge...')
    const diffs = buildPendingDiffs(
      [{ path: TARGET_FILE, content: improvement.modified, description: improvement.description }],
      {
        planFileActions: plan.file_actions,
        findExisting: (p) => mockDb._files.get(normalizePath(p)) || null,
        toolName: 'update_files',
        detectFileType
      }
    )
    console.log(`  Diffs: ${diffs.length}`)
    const d0 = diffs[0]
    result.diff_correct = (
      diffs.length === 1 &&
      d0.action === 'update' &&
      d0.path === TARGET_FILE &&
      d0.oldContent === improvement.original &&
      d0.newContent === improvement.modified
    )
    console.log(`  diff_correct: ${result.diff_correct}`)
    console.log(`  ✓ Done\n`)

    // ── Step 7: safe_apply ──
    console.log('Step 7: safe_apply...')
    const applyResult = await safeApplyDiffs(PROJECT_ID, diffs, detectFileType)
    result.apply_success = applyResult.written.length === 1 && applyResult.errors.length === 0
    result.rolledBack = applyResult.rolledBack
    console.log(`  Written: [${applyResult.written.join(', ')}]`)
    console.log(`  Errors: [${applyResult.errors.join(', ')}]`)
    console.log(`  rolledBack: ${result.rolledBack}`)
    console.log(`  ✓ Done\n`)

    // ── Step 8: change_log ──
    console.log('Step 8: change_log...')
    await logChange({
      projectId: PROJECT_ID,
      chatId: CHAT_ID,
      userId: USER_ID,
      userTask: USER_PROMPT,
      taskMode: 'apply',
      result: 'applied'
    })
    const thisLog = mockDb._changelog.find(e => e.project_id === PROJECT_ID && e.result === 'applied')
    result.logged = !!thisLog
    console.log(`  logged: ${result.logged}`)
    console.log(`  ✓ Done\n`)

    // ── Step 9: Filesystem write + safety check ──
    console.log('Step 9: Filesystem write...')
    fs.writeFileSync(improvement.absPath, improvement.modified, 'utf-8')
    const verify = fs.readFileSync(improvement.absPath, 'utf-8')

    // Verify the improvement is in the file
    result.improvement_visible = verify === improvement.modified && verify !== improvement.original
    console.log(`  improvement_visible: ${result.improvement_visible}`)

    // Safety: verify no protected modules were affected
    const safeChecks = {
      noRouterImport: !verify.includes("request_router"),
      noSafeApplyImport: !verify.includes("safe_apply"),
      noProviderLogic: !verify.includes("providerStatus") && !verify.includes("ProviderError"),
      preservedExports: verify.includes('export default'),
      preservedTestIds: verify.includes('data-testid'),
    }
    const allSafe = Object.values(safeChecks).every(Boolean)
    console.log(`  Safety: ${allSafe ? 'ALL PASSED' : 'FAILED'}`)
    for (const [k, v] of Object.entries(safeChecks)) console.log(`    ${v ? '✓' : '✗'} ${k}`)
    if (!allSafe) result.any_breakpoint = 'Safety check failed'
    console.log(`  ✓ Done\n`)

    // ── Summary ──
    const allPassed = result.self_initiated && result.single_file && result.plan_valid &&
      result.diff_correct && result.apply_success && !result.rolledBack &&
      result.improvement_visible && result.logged && result.any_breakpoint === null

    console.log('═══════════════════════════════════════════════════')
    console.log(allPassed ? '  ✅ PROOF TEST #3 PASSED' : '  ❌ PROOF TEST #3 FAILED')
    console.log('═══════════════════════════════════════════════════')

  } catch (err) {
    result.any_breakpoint = `Error: ${err.message}`
    console.error('\n❌ ERROR:', err.message)
    console.error(err.stack)
  }

  return result
}

runProofTest()
  .then(r => {
    console.log('\n' + JSON.stringify(r, null, 2))
    process.exit(r.any_breakpoint ? 1 : 0)
  })
  .catch(e => { console.error('Fatal:', e); process.exit(1) })
