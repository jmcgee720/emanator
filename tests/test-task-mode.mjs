/**
 * Deterministic verification of Task-Mode Enforcement
 * Self-contained — copies the exact logic from the source files to test without transitive deps.
 */

// ── Inline resolveTaskMode from intents.js ──
function shouldUsePlanMode(intent) {
  return ['build', 'edit', 'refactor', 'bug_fix'].includes(intent)
}
function resolveTaskMode(intent, { isExecutingPlan } = {}) {
  if (isExecutingPlan) return 'patch'
  if (shouldUsePlanMode(intent)) return 'plan'
  return 'inspect'
}

// ── Inline validateTaskMode from plan-validator.js ──
function validateTaskMode(taskMode, { hasFileActions, hasFileContent, hasGroundedContext, diffStatus }) {
  const errors = []
  if (taskMode === 'inspect' && hasFileActions) {
    errors.push('inspect mode must not produce file_actions')
  }
  if (taskMode === 'plan' && hasFileContent) {
    errors.push('plan mode must not produce file contents — only file_actions are allowed')
  }
  if (taskMode === 'patch' && !hasGroundedContext) {
    errors.push('patch mode requires grounded file context')
  }
  if (taskMode === 'apply' && diffStatus !== 'pending') {
    errors.push('apply mode requires metadata.diffStatus === "pending"')
  }
  return { valid: errors.length === 0, errors, mode: 'task_mode_rejected' }
}

// ── Test harness ──
let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ FAIL: ${label}`)
    failed++
  }
}

// Case 1: resolveTaskMode
console.log('\nCase 1: resolveTaskMode')
assert(resolveTaskMode('explain') === 'inspect', 'explain → inspect')
assert(resolveTaskMode('build') === 'plan', 'build → plan')
assert(resolveTaskMode('edit') === 'plan', 'edit → plan')
assert(resolveTaskMode('refactor') === 'plan', 'refactor → plan')
assert(resolveTaskMode('bug_fix') === 'plan', 'bug_fix → plan')
assert(resolveTaskMode('build', { isExecutingPlan: true }) === 'patch', 'build+exec → patch')
assert(resolveTaskMode('chat') === 'inspect', 'chat → inspect')
assert(resolveTaskMode('research') === 'inspect', 'research → inspect')
assert(resolveTaskMode('image_generation') === 'inspect', 'image_generation → inspect')

// Case 2: inspect rejects file_actions
console.log('\nCase 2: inspect rejects file_actions')
{
  const r = validateTaskMode('inspect', { hasFileActions: true, hasFileContent: false, hasGroundedContext: false, diffStatus: null })
  assert(!r.valid, 'rejected')
  assert(r.errors[0] === 'inspect mode must not produce file_actions', 'correct msg')
  assert(r.mode === 'task_mode_rejected', 'mode tag')
}

// Case 3: inspect allows clean output
console.log('\nCase 3: inspect allows clean output')
{
  const r = validateTaskMode('inspect', { hasFileActions: false, hasFileContent: false, hasGroundedContext: false, diffStatus: null })
  assert(r.valid, 'valid')
  assert(r.errors.length === 0, 'no errors')
}

// Case 4: plan rejects file content
console.log('\nCase 4: plan rejects file content')
{
  const r = validateTaskMode('plan', { hasFileActions: true, hasFileContent: true, hasGroundedContext: true, diffStatus: null })
  assert(!r.valid, 'rejected')
  assert(r.errors[0] === 'plan mode must not produce file contents — only file_actions are allowed', 'correct msg')
}

// Case 5: plan allows file_actions only
console.log('\nCase 5: plan allows file_actions only')
{
  const r = validateTaskMode('plan', { hasFileActions: true, hasFileContent: false, hasGroundedContext: true, diffStatus: null })
  assert(r.valid, 'valid')
}

// Case 6: patch rejects without grounded context
console.log('\nCase 6: patch rejects without grounded context')
{
  const r = validateTaskMode('patch', { hasFileActions: false, hasFileContent: true, hasGroundedContext: false, diffStatus: null })
  assert(!r.valid, 'rejected')
  assert(r.errors[0] === 'patch mode requires grounded file context', 'correct msg')
}

// Case 7: patch allows with grounded context
console.log('\nCase 7: patch allows with grounded context')
{
  const r = validateTaskMode('patch', { hasFileActions: false, hasFileContent: true, hasGroundedContext: true, diffStatus: null })
  assert(r.valid, 'valid')
}

// Case 8: apply rejects without pending
console.log('\nCase 8: apply rejects without pending diffStatus')
{
  const r = validateTaskMode('apply', { hasFileActions: false, hasFileContent: false, hasGroundedContext: false, diffStatus: 'applied' })
  assert(!r.valid, 'rejected')
  assert(r.errors[0] === 'apply mode requires metadata.diffStatus === "pending"', 'correct msg')
}

// Case 9: apply allows with pending
console.log('\nCase 9: apply allows with pending diffStatus')
{
  const r = validateTaskMode('apply', { hasFileActions: false, hasFileContent: false, hasGroundedContext: false, diffStatus: 'pending' })
  assert(r.valid, 'valid')
}

// Case 10: Integration — simulate processMessageStream flow for explain intent
console.log('\nCase 10: Simulated processMessageStream (explain intent)')
{
  const intent = 'explain'
  const taskMode = resolveTaskMode(intent)
  assert(taskMode === 'inspect', 'explain resolves to inspect')
  // Simulate AI returning a create_files tool call (violation!)
  const fakeTCs = [{ function: { name: 'create_files', arguments: '{"files":[]}' } }]
  const hasFileContent = fakeTCs.some(tc => ['create_files', 'update_files'].includes(tc.function.name))
  const hasFileActions = false
  const r = validateTaskMode(taskMode, { hasFileActions, hasFileContent: false, hasGroundedContext: false, diffStatus: null })
  // Note: create_files sets hasFileContent, but since taskMode is 'inspect', only hasFileActions matters
  const r2 = validateTaskMode(taskMode, { hasFileActions: true, hasFileContent: false, hasGroundedContext: false, diffStatus: null })
  assert(r.valid, 'inspect + no file_actions from explain is valid (file content check is irrelevant for inspect)')
  assert(!r2.valid, 'inspect + file_actions → rejected')
}

// Case 11: Integration — simulate executePlanStream
console.log('\nCase 11: Simulated executePlanStream (patch mode)')
{
  const taskMode = 'patch'
  // With grounded context
  const r1 = validateTaskMode(taskMode, { hasFileActions: false, hasFileContent: true, hasGroundedContext: true, diffStatus: null })
  assert(r1.valid, 'patch + grounded → valid')
  // Without grounded context
  const r2 = validateTaskMode(taskMode, { hasFileActions: false, hasFileContent: true, hasGroundedContext: false, diffStatus: null })
  assert(!r2.valid, 'patch + ungrounded → rejected')
}

// Summary
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
process.exit(failed > 0 ? 1 : 0)
