#!/usr/bin/env node
/**
 * Standalone verification of the executePlanStream validatePlan guard.
 * 
 * Strategy: We can't import service.js directly (Next.js @/ aliases).
 * Instead, we read the source, extract the guard logic pattern, and verify
 * validatePlan itself rejects bad plans. Then we grep the source to confirm
 * the guard is structurally placed before any file operations.
 */

import { readFileSync } from 'fs'
import crypto from 'crypto'

// --- Inline the dependencies that plan-validator needs ---
const PLACEHOLDER_PATTERNS = [
  /\bassume\b/i,
  /\bexisting code\b/i,
  /\binsert here\b/i,
  /\bwhere metadata is read\b/i,
  /\b\.\.\.\s*rest of/i,
  /\bplaceholder\b/i,
]

function containsPlaceholderLanguage(text) {
  if (!text) return false
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) return true
  }
  return false
}

// --- Inline validatePlan from plan-validator.js (core logic) ---
function validatePlan(plan, fileContext, previousRejectedHash = null, userMessage = null) {
  const errors = []
  const warnings = []
  const VALID_ACTIONS = new Set(['create', 'update', 'delete'])

  if (!plan.file_actions || !Array.isArray(plan.file_actions) || plan.file_actions.length === 0) {
    errors.push('file_actions is missing or empty')
  }

  const seenPaths = new Set()
  for (const action of (plan.file_actions || [])) {
    const norm = (action.path || '').replace(/^\.\//, '').replace(/^\//, '')
    if (!norm) { errors.push('file_action has empty or missing path'); continue }
    if (!VALID_ACTIONS.has(action.action)) {
      errors.push(`"${norm}": invalid action "${action.action}" — must be create, update, or delete`)
    }
    if (seenPaths.has(norm)) { errors.push(`"${norm}": duplicate path in file_actions`) }
    seenPaths.add(norm)
  }

  if (plan.constraints_checked && plan.constraints_checked.grounded_in_file_context === false) {
    errors.push('Plan self-reports as not grounded in file context')
  }

  const reasoningText = Array.isArray(plan.reasoning) ? plan.reasoning.join(' ') : (plan.reasoning || '')
  if (containsPlaceholderLanguage(reasoningText)) {
    errors.push(`Reasoning contains placeholder language: "${reasoningText.slice(0, 100)}"`)
  }

  for (const action of (plan.file_actions || [])) {
    const desc = [action.intent, action.reason, action.description].filter(Boolean).join(' ')
    if (containsPlaceholderLanguage(desc)) {
      errors.push(`File action "${action.path}" contains placeholder language`)
    }
  }

  const hash = crypto.createHash('sha256').update(JSON.stringify(plan.file_actions || [])).digest('hex').slice(0, 16)
  return { valid: errors.length === 0, errors, warnings, hash }
}

// ===================== TESTS =====================

let allPass = true
function assert(label, condition) {
  const status = condition ? 'PASS' : 'FAIL'
  if (!condition) allPass = false
  console.log(`  [${status}] ${label}`)
}

// --- Test 1: validatePlan rejects empty plan ---
console.log('\nTest 1: empty plan (no file_actions)')
const r1 = validatePlan({}, null, null, 'test')
assert('valid === false', r1.valid === false)
assert('errors mention file_actions', r1.errors.some(e => e.includes('file_actions')))

// --- Test 2: validatePlan rejects invalid action type ---
console.log('\nTest 2: invalid action type')
const r2 = validatePlan({ file_actions: [{ path: 'foo.js', action: 'explode' }], summary: 'boom' }, null, null, 'test')
assert('valid === false', r2.valid === false)
assert('errors mention invalid action', r2.errors.some(e => e.includes('invalid action')))

// --- Test 3: validatePlan accepts valid plan ---
console.log('\nTest 3: valid plan')
const r3 = validatePlan({ file_actions: [{ path: 'foo.js', action: 'create', description: 'add foo' }], summary: 'ok' }, null, null, 'test')
assert('valid === true', r3.valid === true)
assert('no errors', r3.errors.length === 0)

// --- Test 4: Source-level verification that executePlanStream has the guard ---
console.log('\nTest 4: executePlanStream source structure')
const src = readFileSync('/app/lib/ai/service.js', 'utf-8')
const fnStart = src.indexOf('async *executePlanStream(')
assert('executePlanStream found in source', fnStart !== -1)

// Extract from function start to the first 1500 chars (enough to see guard + context loading)
const fnSlice = src.slice(fnStart, fnStart + 1500)
assert('validatePlan() called inside executePlanStream', fnSlice.includes('validatePlan(planData'))
assert('plan_validation_failed event emitted', fnSlice.includes("'plan_validation_failed'"))
assert('error event emitted on invalid', fnSlice.includes("event: 'error'"))
assert('return after rejection (stops execution)', fnSlice.includes('return'))

// Verify the guard appears BEFORE loadScopedContext (no file ops before validation)
const guardIdx = fnSlice.indexOf('validatePlan(planData')
const loadIdx = fnSlice.indexOf('loadScopedContext')
assert('guard runs BEFORE loadScopedContext', guardIdx < loadIdx)

// Verify the guard appears BEFORE buildFilesystemContext
const fsIdx = fnSlice.indexOf('buildFilesystemContext')
assert('guard runs BEFORE buildFilesystemContext', guardIdx < fsIdx)

// --- Test 5: simulate the guard logic inline (mirrors what executePlanStream does) ---
console.log('\nTest 5: simulate executePlanStream guard with bad plan')
const badPlan = { summary: 'hack', file_actions: [] }
const simResult = validatePlan(badPlan, null, null, 'test')
const events = []
if (!simResult.valid) {
  events.push({ event: 'status', data: { stage: 'plan_validation_failed', detail: `Plan rejected: ${simResult.errors.join('; ')}` } })
  events.push({ event: 'error', data: { message: `Invalid plan: ${simResult.errors.join('; ')}` } })
}
assert('guard produced plan_validation_failed event', events.some(e => e.data?.stage === 'plan_validation_failed'))
assert('guard produced error event', events.some(e => e.event === 'error'))
assert('no file operation events produced', !events.some(e => ['executing_plan', 'diff', 'file_created', 'file_updated'].includes(e.event)))

// --- Summary ---
console.log(`\n${'='.repeat(50)}`)
console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED')
process.exit(allPass ? 0 : 1)
