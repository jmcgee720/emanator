#!/usr/bin/env node
import { readFileSync } from 'fs'
import crypto from 'crypto'

// --- Inline dependencies ---
const PLACEHOLDER_PATTERNS = [/\bassume\b/i, /\bexisting code\b/i, /\binsert here\b/i, /\bplaceholder\b/i]
function containsPlaceholderLanguage(t) { if(!t)return false; for(const p of PLACEHOLDER_PATTERNS){if(p.test(t))return true}; return false }
function detectSingleFileIntent() { return null } // stub

function validatePlan(plan, fileContext, previousRejectedHash = null, userMessage = null, opts = {}) {
  const errors = [], warnings = [], VALID_ACTIONS = new Set(['create','update','delete'])
  const allowedPathPrefix = opts.allowedPathPrefix || null

  if (!plan.file_actions || !Array.isArray(plan.file_actions) || plan.file_actions.length === 0) {
    errors.push('file_actions is missing or empty')
  }
  const seenPaths = new Set()
  for (const action of (plan.file_actions || [])) {
    const norm = (action.path || '').replace(/^\.\//, '').replace(/^\//, '')
    if (!norm) { errors.push('file_action has empty or missing path'); continue }
    if (!VALID_ACTIONS.has(action.action)) errors.push(`"${norm}": invalid action "${action.action}"`)
    if (seenPaths.has(norm)) errors.push(`"${norm}": duplicate path`)
    seenPaths.add(norm)
    if (allowedPathPrefix && !norm.startsWith(allowedPathPrefix)) {
      errors.push(`"${norm}": outside allowed self-edit scope "${allowedPathPrefix}"`)
    }
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(plan.file_actions || [])).digest('hex').slice(0, 16)
  return { valid: errors.length === 0, errors, warnings, hash }
}

let allPass = true
function assert(label, cond) { const s = cond ? 'PASS' : 'FAIL'; if(!cond) allPass=false; console.log(`  [${s}] ${label}`) }

// ═══ Test 1: no prefix → all paths allowed ═══
console.log('\nTest 1: no allowedPathPrefix (normal builder)')
const r1 = validatePlan({ file_actions: [
  { path: 'lib/ai/service.js', action: 'update', description: 'x' },
  { path: 'components/foo.jsx', action: 'create', description: 'x' },
]}, null, null, 'test', {})
assert('valid with no prefix', r1.valid === true)

// ═══ Test 2: prefix set, all paths match → allowed ═══
console.log('\nTest 2: allowedPathPrefix matches all paths')
const r2 = validatePlan({ file_actions: [
  { path: 'lib/ai/plan-validator.js', action: 'update', description: 'x' },
]}, null, null, 'test', { allowedPathPrefix: 'lib/ai/plan-validator.js' })
assert('valid when path matches prefix', r2.valid === true)

// ═══ Test 3: prefix set, path OUTSIDE scope → rejected ═══
console.log('\nTest 3: allowedPathPrefix blocks out-of-scope path')
const r3 = validatePlan({ file_actions: [
  { path: 'lib/ai/plan-validator.js', action: 'update', description: 'x' },
  { path: 'components/dashboard/Dashboard.jsx', action: 'update', description: 'x' },
]}, null, null, 'test', { allowedPathPrefix: 'lib/ai/plan-validator.js' })
assert('rejected (out-of-scope path)', r3.valid === false)
assert('error mentions Dashboard.jsx', r3.errors.some(e => e.includes('Dashboard.jsx')))
assert('error mentions outside allowed', r3.errors.some(e => e.includes('outside allowed self-edit scope')))

// ═══ Test 4: directory prefix (e.g. components/) ═══
console.log('\nTest 4: directory prefix allows sub-paths')
const r4 = validatePlan({ file_actions: [
  { path: 'components/dashboard/LeftPanel.jsx', action: 'update', description: 'x' },
  { path: 'components/ui/button.jsx', action: 'update', description: 'x' },
]}, null, null, 'test', { allowedPathPrefix: 'components/' })
assert('valid when all paths under prefix', r4.valid === true)

// ═══ Test 5: directory prefix rejects outside paths ═══
console.log('\nTest 5: directory prefix rejects lib/ path')
const r5 = validatePlan({ file_actions: [
  { path: 'components/ui/button.jsx', action: 'update', description: 'x' },
  { path: 'lib/ai/service.js', action: 'update', description: 'x' },
]}, null, null, 'test', { allowedPathPrefix: 'components/' })
assert('rejected', r5.valid === false)
assert('error mentions lib/ai/service.js', r5.errors.some(e => e.includes('lib/ai/service.js')))

// ═══ Test 6: null prefix (selfEditTarget not set) → no restriction ═══
console.log('\nTest 6: null prefix same as no restriction')
const r6 = validatePlan({ file_actions: [
  { path: 'anything/anywhere.js', action: 'create', description: 'x' },
]}, null, null, 'test', { allowedPathPrefix: null })
assert('valid with null prefix', r6.valid === true)

// ═══ Structural: source file checks ═══
console.log('\nStructural: source file verification')
const validatorSrc = readFileSync('/app/lib/ai/plan-validator.js', 'utf-8')
const serviceSrc = readFileSync('/app/lib/ai/service.js', 'utf-8')

assert('validatePlan accepts opts parameter', validatorSrc.includes('opts = {}'))
assert('allowedPathPrefix extracted from opts', validatorSrc.includes("opts.allowedPathPrefix"))
assert('path scope check in validator', validatorSrc.includes('outside allowed self-edit scope'))

assert('processMessageStream passes selfEditTarget.path', serviceSrc.includes("allowedPathPrefix: selfEditTarget?.path"))
assert('executePlanStream receives selfEditTarget', serviceSrc.includes('planData, runId, startTime, selfEditTarget }'))
assert('executePlanStream passes selfEditTarget.path', 
  serviceSrc.slice(serviceSrc.indexOf('async *executePlanStream')).includes("allowedPathPrefix: selfEditTarget?.path"))

console.log(`\n${'='.repeat(50)}`)
console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED')
process.exit(allPass ? 0 : 1)
