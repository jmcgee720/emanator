/**
 * Deterministic verification of Request-Mode Gate
 * Tests classifyRequestMode + validateRequestModeOutput
 */

// ── Inline classifyRequestMode from intents.js ──
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

function classifyRequestMode(userMessage, { hasPendingDiff = false } = {}) {
  const text = (userMessage || '').trim()
  if (!text) return 'plan_patch'
  if (hasPendingDiff) {
    const isApply = APPLY_PENDING_PATTERNS.some(p => p.test(text))
    const isDiscard = DISCARD_PENDING_PATTERNS.some(p => p.test(text))
    if (isDiscard) return 'discard_pending_diff'
    if (isApply) return 'apply_pending_diff'
  }
  const hasCodeChange = CODE_CHANGE_PATTERNS.some(p => p.test(text))
  if (hasCodeChange) return 'plan_patch'
  const hasReadOnly = READ_ONLY_PATTERNS.some(p => p.test(text))
  if (hasReadOnly) return 'read_only_report'
  return 'plan_patch'
}

// ── Inline validateRequestModeOutput from plan-validator.js ──
function validateRequestModeOutput(requestMode, { hasProposedPlan, hasFileActions, hasFileContent, hasDiffFiles }) {
  const errors = []
  if (requestMode === 'read_only_report') {
    if (hasProposedPlan) errors.push('read_only_report must not produce Proposed Plan')
    if (hasFileActions) errors.push('read_only_report must not produce file_actions')
    if (hasFileContent) errors.push('read_only_report must not produce file contents')
    if (hasDiffFiles) errors.push('read_only_report must not produce diff files')
  }
  if (requestMode === 'apply_pending_diff') {
    if (hasProposedPlan) errors.push('apply_pending_diff must not produce Proposed Plan')
    if (hasFileActions) errors.push('apply_pending_diff must not produce file_actions')
  }
  if (requestMode === 'discard_pending_diff') {
    if (hasProposedPlan) errors.push('discard_pending_diff must not produce Proposed Plan')
    if (hasFileActions) errors.push('discard_pending_diff must not produce file_actions')
  }
  return { valid: errors.length === 0, errors, mode: 'request_mode_rejected' }
}

// ── Test harness ──
let passed = 0, failed = 0
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++ }
  else { console.error(`  ✗ FAIL: ${label}`); failed++ }
}

// ═══════════════════════════════════════════════
// PART A: classifyRequestMode
// ═══════════════════════════════════════════════

console.log('\n── A1: read_only_report classification ──')
assert(classifyRequestMode('Show me all the files in src/') === 'read_only_report', '"Show me all files" → read_only_report')
assert(classifyRequestMode('What does the auth module do?') === 'read_only_report', '"What does the auth module do?" → read_only_report')
assert(classifyRequestMode('Locate all usages of useState') === 'read_only_report', '"Locate all usages" → read_only_report')
assert(classifyRequestMode('Report on the project structure') === 'read_only_report', '"Report on project structure" → read_only_report')
assert(classifyRequestMode('Investigate why the tests fail') === 'read_only_report', '"Investigate why" → read_only_report')
assert(classifyRequestMode('How does the routing work?') === 'read_only_report', '"How does routing work?" → read_only_report')
assert(classifyRequestMode('Where is the database connection?') === 'read_only_report', '"Where is the db connection?" → read_only_report')
assert(classifyRequestMode('Describe the API endpoints') === 'read_only_report', '"Describe API endpoints" → read_only_report')
assert(classifyRequestMode('Explain the middleware chain') === 'read_only_report', '"Explain middleware" → read_only_report')
assert(classifyRequestMode('List all components') === 'read_only_report', '"List all components" → read_only_report')

console.log('\n── A2: plan_patch classification ──')
assert(classifyRequestMode('Fix the login bug') === 'plan_patch', '"Fix the login bug" → plan_patch')
assert(classifyRequestMode('Build a new dashboard page') === 'plan_patch', '"Build a new dashboard" → plan_patch')
assert(classifyRequestMode('Add a logout button') === 'plan_patch', '"Add a logout button" → plan_patch')
assert(classifyRequestMode('Refactor the auth module') === 'plan_patch', '"Refactor auth" → plan_patch')
assert(classifyRequestMode('Delete the old config file') === 'plan_patch', '"Delete old config" → plan_patch')
assert(classifyRequestMode('Update the header component') === 'plan_patch', '"Update header" → plan_patch')
assert(classifyRequestMode('Create a new API endpoint for users') === 'plan_patch', '"Create new endpoint" → plan_patch')
assert(classifyRequestMode('Replace the old logger with winston') === 'plan_patch', '"Replace old logger" → plan_patch')

console.log('\n── A3: apply_pending_diff (requires hasPendingDiff) ──')
assert(classifyRequestMode('Apply the changes', { hasPendingDiff: true }) === 'apply_pending_diff', '"Apply the changes" + pending → apply')
assert(classifyRequestMode('Looks good, go ahead', { hasPendingDiff: true }) === 'apply_pending_diff', '"Looks good, go ahead" + pending → apply')
assert(classifyRequestMode('Yes', { hasPendingDiff: true }) === 'apply_pending_diff', '"Yes" + pending → apply')
assert(classifyRequestMode('LGTM', { hasPendingDiff: true }) === 'apply_pending_diff', '"LGTM" + pending → apply')
assert(classifyRequestMode('Ship it', { hasPendingDiff: true }) === 'apply_pending_diff', '"Ship it" + pending → apply')
// Without pending diff, same text should NOT route to apply
assert(classifyRequestMode('Apply the changes', { hasPendingDiff: false }) === 'plan_patch', '"Apply" without pending → plan_patch')

console.log('\n── A4: discard_pending_diff (requires hasPendingDiff) ──')
assert(classifyRequestMode('Discard these changes', { hasPendingDiff: true }) === 'discard_pending_diff', '"Discard" + pending → discard')
assert(classifyRequestMode('Cancel', { hasPendingDiff: true }) === 'discard_pending_diff', '"Cancel" + pending → discard')
assert(classifyRequestMode('Never mind', { hasPendingDiff: true }) === 'discard_pending_diff', '"Never mind" + pending → discard')
assert(classifyRequestMode("Don't apply that", { hasPendingDiff: true }) === 'discard_pending_diff', '"Don\'t apply" + pending → discard')
assert(classifyRequestMode('No', { hasPendingDiff: true }) === 'discard_pending_diff', '"No" + pending → discard')
// Discard wins over apply when both match
assert(classifyRequestMode("No, don't apply", { hasPendingDiff: true }) === 'discard_pending_diff', '"No don\'t apply" → discard (discard wins)')

console.log('\n── A5: edge cases ──')
assert(classifyRequestMode('') === 'plan_patch', 'empty → plan_patch (default)')
assert(classifyRequestMode('hello') === 'plan_patch', '"hello" → plan_patch (no signal)')
// "find and fix" has both read-only and code-change — code-change wins
assert(classifyRequestMode('Find and fix the memory leak') === 'plan_patch', '"Find and fix" → plan_patch (code-change priority)')

// ═══════════════════════════════════════════════
// PART B: validateRequestModeOutput
// ═══════════════════════════════════════════════

console.log('\n── B1: read_only_report output validation ──')
{
  const clean = { hasProposedPlan: false, hasFileActions: false, hasFileContent: false, hasDiffFiles: false }
  assert(validateRequestModeOutput('read_only_report', clean).valid, 'clean text → valid')

  const withPlan = { ...clean, hasProposedPlan: true }
  const r1 = validateRequestModeOutput('read_only_report', withPlan)
  assert(!r1.valid, 'with plan → rejected')
  assert(r1.errors[0].includes('Proposed Plan'), 'correct error')

  const withFiles = { ...clean, hasDiffFiles: true }
  const r2 = validateRequestModeOutput('read_only_report', withFiles)
  assert(!r2.valid, 'with diffs → rejected')

  const withContent = { ...clean, hasFileContent: true }
  const r3 = validateRequestModeOutput('read_only_report', withContent)
  assert(!r3.valid, 'with file content → rejected')

  const withActions = { ...clean, hasFileActions: true }
  const r4 = validateRequestModeOutput('read_only_report', withActions)
  assert(!r4.valid, 'with file_actions → rejected')
}

console.log('\n── B2: plan_patch output validation ──')
{
  const all = { hasProposedPlan: true, hasFileActions: true, hasFileContent: true, hasDiffFiles: true }
  assert(validateRequestModeOutput('plan_patch', all).valid, 'plan_patch always valid')
}

console.log('\n── B3: apply_pending_diff output validation ──')
{
  const clean = { hasProposedPlan: false, hasFileActions: false, hasFileContent: false, hasDiffFiles: false }
  assert(validateRequestModeOutput('apply_pending_diff', clean).valid, 'clean → valid')

  const withPlan = { ...clean, hasProposedPlan: true }
  assert(!validateRequestModeOutput('apply_pending_diff', withPlan).valid, 'with plan → rejected')
}

console.log('\n── B4: discard_pending_diff output validation ──')
{
  const clean = { hasProposedPlan: false, hasFileActions: false, hasFileContent: false, hasDiffFiles: false }
  assert(validateRequestModeOutput('discard_pending_diff', clean).valid, 'clean → valid')

  const withActions = { ...clean, hasFileActions: true }
  assert(!validateRequestModeOutput('discard_pending_diff', withActions).valid, 'with file_actions → rejected')
}

// ═══════════════════════════════════════════════
// PART C: Integration scenarios
// ═══════════════════════════════════════════════

console.log('\n── C1: Full flow — read_only_report produces clean text ──')
{
  const mode = classifyRequestMode('What files exist in the project?')
  assert(mode === 'read_only_report', 'classified correctly')
  const r = validateRequestModeOutput(mode, { hasProposedPlan: false, hasFileActions: false, hasFileContent: false, hasDiffFiles: false })
  assert(r.valid, 'output is valid')
}

console.log('\n── C2: Full flow — plan_patch with plan output ──')
{
  const mode = classifyRequestMode('Build a login page')
  assert(mode === 'plan_patch', 'classified correctly')
  const r = validateRequestModeOutput(mode, { hasProposedPlan: true, hasFileActions: true, hasFileContent: false, hasDiffFiles: false })
  assert(r.valid, 'plan_patch with plan is valid')
}

console.log('\n── C3: Full flow — apply bypass ──')
{
  const mode = classifyRequestMode('Go ahead', { hasPendingDiff: true })
  assert(mode === 'apply_pending_diff', 'classified correctly')
}

console.log('\n── C4: Full flow — discard bypass ──')
{
  const mode = classifyRequestMode('Scratch that', { hasPendingDiff: true })
  assert(mode === 'discard_pending_diff', 'classified correctly')
}

// Summary
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
process.exit(failed > 0 ? 1 : 0)
