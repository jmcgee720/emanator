#!/usr/bin/env node
/**
 * Verify the text-parsing fallback paths now run validatePatchGrounding
 * before emitting diff_file events.
 */

import { readFileSync } from 'fs'

const src = readFileSync('/app/lib/ai/service.js', 'utf-8')

let allPass = true
function assert(label, condition) {
  const status = condition ? 'PASS' : 'FAIL'
  if (!condition) allPass = false
  console.log(`  [${status}] ${label}`)
}

// ── Helper: extract a function body slice ──
function fnSlice(name, size = 3000) {
  const idx = src.indexOf(name)
  return idx === -1 ? '' : src.slice(idx, idx + size)
}

// ═══════════════════════════════════════════════
// _processStream text-fallback (search from the unique comment)
// ═══════════════════════════════════════════════
console.log('\n_processStream text-fallback path:')
const psComment = 'Try parsing files from response text if no tool calls (skip in plan mode)'
const psIdx = src.indexOf(psComment)
assert('fallback block found in _processStream', psIdx !== -1)

const psBlock = src.slice(psIdx, psIdx + 2500)

// 1. candidateDiffs pattern (diffs built into temp array, not directly into diffFiles)
assert('uses candidateDiffs temp array', psBlock.includes('const candidateDiffs = []'))
assert('pushes to candidateDiffs (not diffFiles)', psBlock.includes('candidateDiffs.push('))

// 2. validatePatchGrounding runs on candidateDiffs
assert('validatePatchGrounding called on candidateDiffs', psBlock.includes('validatePatchGrounding(candidateDiffs'))

// 3. Rejection pattern
assert('patch_grounding_failed status emitted on failure', psBlock.includes("stage: 'patch_grounding_failed'"))
assert('logPlanEvent logs rejection', psBlock.includes("taskMode: 'patch_grounding_rejected'"))

// 4. Only emits diff_file in else branch (after validation passes)
const validateIdx = psBlock.indexOf('validatePatchGrounding(candidateDiffs')
const elseIdx = psBlock.indexOf('} else {', validateIdx)
const diffFileIdx = psBlock.indexOf("event: 'diff_file'", validateIdx)
assert('diff_file emitted ONLY in else (valid) branch', elseIdx !== -1 && diffFileIdx > elseIdx)

// 5. No direct diffFiles.push before validation
const pushBeforeValidate = psBlock.slice(0, psBlock.indexOf('validatePatchGrounding(candidateDiffs'))
assert('no diffFiles.push before validation', !pushBeforeValidate.includes('diffFiles.push'))

// ═══════════════════════════════════════════════
// executePlanStream text-fallback
// ═══════════════════════════════════════════════
console.log('\nexecutePlanStream text-fallback path:')
const epsComment = 'Try parsing files from response text if no tool calls produced diffs'
const epsIdx = src.indexOf(epsComment)
assert('fallback block found in executePlanStream', epsIdx !== -1)

const epsBlock = src.slice(epsIdx, epsIdx + 2500)

assert('uses candidateDiffs temp array', epsBlock.includes('const candidateDiffs = []'))
assert('pushes to candidateDiffs (not diffFiles)', epsBlock.includes('candidateDiffs.push('))
assert('validatePatchGrounding called on candidateDiffs', epsBlock.includes('validatePatchGrounding(candidateDiffs'))
assert('patch_grounding_failed status emitted on failure', epsBlock.includes("stage: 'patch_grounding_failed'"))
assert('logPlanEvent logs rejection', epsBlock.includes("taskMode: 'patch_grounding_rejected'"))

const epsValidateIdx = epsBlock.indexOf('validatePatchGrounding(candidateDiffs')
const epsElseIdx = epsBlock.indexOf('} else {', epsValidateIdx)
const epsDiffFileIdx = epsBlock.indexOf("event: 'diff_file'", epsValidateIdx)
assert('diff_file emitted ONLY in else (valid) branch', epsElseIdx !== -1 && epsDiffFileIdx > epsElseIdx)

const epsPushBeforeValidate = epsBlock.slice(0, epsBlock.indexOf('validatePatchGrounding(candidateDiffs'))
assert('no diffFiles.push before validation', !epsPushBeforeValidate.includes('diffFiles.push'))

// ═══════════════════════════════════════════════
// Parity: both paths use the same context variables
// ═══════════════════════════════════════════════
console.log('\nParity checks:')
assert('_processStream uses filesByPath + proposedPlan', psBlock.includes('filesByPath, proposedPlan'))
assert('executePlanStream uses filesByPath + planData', epsBlock.includes('filesByPath, planData'))

// Total validatePatchGrounding call count (import excluded)
const allCalls = [...src.matchAll(/validatePatchGrounding\(/g)]
assert('total validatePatchGrounding usage calls = 4', allCalls.length === 4)

// ── Summary ──
console.log(`\n${'='.repeat(50)}`)
console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED')
process.exit(allPass ? 0 : 1)
