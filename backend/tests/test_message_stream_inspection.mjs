/**
 * Code inspection tests for message-stream.js and prompt-builder.js
 * Verifies that 'Done' completion messages have been replaced with buildVerifiedPatchResponse
 */

import fs from 'fs'
import path from 'path'

const results = {
  passed: 0,
  failed: 0,
  tests: []
}

function test(name, fn) {
  try {
    fn()
    results.passed++
    results.tests.push({ name, status: 'PASS' })
    console.log(`✓ ${name}`)
  } catch (error) {
    results.failed++
    results.tests.push({ name, status: 'FAIL', error: error.message })
    console.log(`✗ ${name}: ${error.message}`)
  }
}

function assertTrue(condition, message = '') {
  if (!condition) {
    throw new Error(message || 'Expected true but got false')
  }
}

function assertFalse(condition, message = '') {
  if (condition) {
    throw new Error(message || 'Expected false but got true')
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`)
  }
}

// Load file contents
const messageStreamPath = '/app/lib/ai/message-stream.js'
const promptBuilderPath = '/app/lib/ai/prompt-builder.js'
const patchVerificationPath = '/app/lib/ai/patch-verification.js'

const messageStreamContent = fs.readFileSync(messageStreamPath, 'utf-8')
const promptBuilderContent = fs.readFileSync(promptBuilderPath, 'utf-8')
const patchVerificationContent = fs.readFileSync(patchVerificationPath, 'utf-8')

console.log('\n=== Testing message-stream.js imports ===')

test('message-stream.js: imports verifyPatchResult from patch-verification.js', () => {
  assertTrue(
    messageStreamContent.includes("import { verifyPatchResult, buildVerifiedPatchResponse } from './patch-verification.js'"),
    'Should import verifyPatchResult and buildVerifiedPatchResponse'
  )
})

console.log('\n=== Testing message-stream.js buildVerifiedPatchResponse usage ===')

test('message-stream.js: uses buildVerifiedPatchResponse for PlanValidator revised path', () => {
  // Line ~1052: PlanValidator revised -> buildVerifiedPatchResponse
  assertTrue(
    messageStreamContent.includes('const vResult = verifyPatchResult(revSaved, userMessage)') &&
    messageStreamContent.includes('fullContent = buildVerifiedPatchResponse(vResult, refinementMode)'),
    'Should use buildVerifiedPatchResponse for PlanValidator revised path'
  )
})

test('message-stream.js: uses buildVerifiedPatchResponse for SelfCritique revised path', () => {
  // Line ~1142: SelfCritique revised -> buildVerifiedPatchResponse
  assertTrue(
    messageStreamContent.includes('buildVerifiedPatchResponse(verifyPatchResult(revSaved2, userMessage), refinementMode)'),
    'Should use buildVerifiedPatchResponse for SelfCritique revised path'
  )
})

test('message-stream.js: uses buildVerifiedPatchResponse for auto-execute inline', () => {
  // Line ~1265: auto-execute inline non-new-project -> buildVerifiedPatchResponse
  const hasAutoExecuteVerification = messageStreamContent.includes(
    'const vResult = verifyPatchResult(savedFiles, userMessage)'
  ) && messageStreamContent.includes(
    'fullContent = buildVerifiedPatchResponse(vResult, true)'
  )
  assertTrue(hasAutoExecuteVerification, 'Should use buildVerifiedPatchResponse for auto-execute inline')
})

test('message-stream.js: uses buildVerifiedPatchResponse for direct edit success', () => {
  // Line ~1342: direct edit success -> buildVerifiedPatchResponse
  const hasDirectEditVerification = messageStreamContent.includes(
    'const vResult = verifyPatchResult(savedFiles, userMessage)'
  ) && messageStreamContent.includes(
    'fullContent = buildVerifiedPatchResponse(vResult, refinementMode)'
  )
  assertTrue(hasDirectEditVerification, 'Should use buildVerifiedPatchResponse for direct edit success')
})

console.log('\n=== Testing message-stream.js for remaining "Done" strings ===')

test('message-stream.js: no "Done — I\'ve updated the preview" strings', () => {
  assertFalse(
    messageStreamContent.includes("Done — I've updated the preview"),
    'Should not contain "Done — I\'ve updated the preview"'
  )
})

// Count remaining "Done —" strings (these are in fallback paths that weren't specified for replacement)
const doneMatches = messageStreamContent.match(/Done —/g) || []
console.log(`\nNote: Found ${doneMatches.length} remaining "Done —" strings in fallback paths`)

console.log('\n=== Testing prompt-builder.js instructions ===')

test('prompt-builder.js: Refinement prompt instructs AI to describe exact visible result', () => {
  assertTrue(
    promptBuilderContent.includes('describe the EXACT visible result') ||
    promptBuilderContent.includes('EXACT visible result'),
    'Refinement prompt should instruct AI to describe exact visible result'
  )
})

test('prompt-builder.js: Refinement prompt blocks generic "Done" language', () => {
  assertTrue(
    promptBuilderContent.includes('NEVER say generic phrases like "Done"') ||
    promptBuilderContent.includes("NEVER say generic phrases"),
    'Refinement prompt should block generic Done language'
  )
})

test('prompt-builder.js: New page prompt instructs AI to describe exact visible result', () => {
  assertTrue(
    promptBuilderContent.includes('EXACTLY what you built') ||
    promptBuilderContent.includes('Describe the actual visible result'),
    'New page prompt should instruct AI to describe exact visible result'
  )
})

test('prompt-builder.js: New page prompt blocks generic completion language', () => {
  assertTrue(
    promptBuilderContent.includes('NEVER use generic phrases like "Done"') ||
    promptBuilderContent.includes("NEVER use generic phrases"),
    'New page prompt should block generic completion language'
  )
})

console.log('\n=== Testing patch-verification.js exports ===')

test('patch-verification.js: exports verifyPatchResult function', () => {
  assertTrue(
    patchVerificationContent.includes('export function verifyPatchResult'),
    'Should export verifyPatchResult function'
  )
})

test('patch-verification.js: exports buildVerifiedPatchResponse function', () => {
  assertTrue(
    patchVerificationContent.includes('export function buildVerifiedPatchResponse'),
    'Should export buildVerifiedPatchResponse function'
  )
})

test('patch-verification.js: extractExpectedChanges handles heading patterns', () => {
  assertTrue(
    patchVerificationContent.includes('headingPatterns') &&
    patchVerificationContent.includes('heading_text'),
    'Should have heading pattern extraction'
  )
})

test('patch-verification.js: extractExpectedChanges handles active section patterns', () => {
  assertTrue(
    patchVerificationContent.includes('sectionPatterns') &&
    patchVerificationContent.includes('active_section'),
    'Should have active section pattern extraction'
  )
})

test('patch-verification.js: extractExpectedChanges handles form field patterns', () => {
  assertTrue(
    patchVerificationContent.includes('formPatterns') &&
    patchVerificationContent.includes('form_field'),
    'Should have form field pattern extraction'
  )
})

test('patch-verification.js: extractExpectedChanges handles removal patterns', () => {
  assertTrue(
    patchVerificationContent.includes('removePatterns') &&
    patchVerificationContent.includes('removed_element'),
    'Should have removal pattern extraction'
  )
})

test('patch-verification.js: verifyPatchResult returns VERIFIED status', () => {
  assertTrue(
    patchVerificationContent.includes("? 'VERIFIED' : 'NOT_VERIFIED'") ||
    patchVerificationContent.includes("'VERIFIED'"),
    'Should return VERIFIED status'
  )
})

test('patch-verification.js: verifyPatchResult returns NOT_VERIFIED status', () => {
  assertTrue(
    patchVerificationContent.includes("'NOT_VERIFIED'"),
    'Should return NOT_VERIFIED status'
  )
})

test('patch-verification.js: verifyPatchResult returns APPLIED_NO_AUTO_CHECKS status', () => {
  assertTrue(
    patchVerificationContent.includes("'APPLIED_NO_AUTO_CHECKS'"),
    'Should return APPLIED_NO_AUTO_CHECKS status'
  )
})

test('patch-verification.js: verifyPatchResult checks useState patterns', () => {
  assertTrue(
    patchVerificationContent.includes('useState') &&
    patchVerificationContent.includes('statePatterns'),
    'Should check useState patterns for active section verification'
  )
})

test('patch-verification.js: buildVerifiedPatchResponse includes FILES CHANGED', () => {
  assertTrue(
    patchVerificationContent.includes('FILES CHANGED'),
    'Should include FILES CHANGED section'
  )
})

test('patch-verification.js: buildVerifiedPatchResponse includes WHAT SHOULD NOW BE VISIBLE', () => {
  assertTrue(
    patchVerificationContent.includes('WHAT SHOULD NOW BE VISIBLE'),
    'Should include WHAT SHOULD NOW BE VISIBLE section'
  )
})

test('patch-verification.js: buildVerifiedPatchResponse includes HOW TO VERIFY IN PREVIEW', () => {
  assertTrue(
    patchVerificationContent.includes('HOW TO VERIFY IN PREVIEW'),
    'Should include HOW TO VERIFY IN PREVIEW section'
  )
})

test('patch-verification.js: buildVerifiedPatchResponse includes VERIFICATION STATUS', () => {
  assertTrue(
    patchVerificationContent.includes('VERIFICATION STATUS'),
    'Should include VERIFICATION STATUS section'
  )
})

// ============================================
// Print summary
// ============================================

console.log('\n========================================')
console.log(`CODE INSPECTION TEST RESULTS`)
console.log(`========================================`)
console.log(`Passed: ${results.passed}`)
console.log(`Failed: ${results.failed}`)
console.log(`Total:  ${results.passed + results.failed}`)
console.log(`Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`)
console.log('========================================\n')

if (results.failed > 0) {
  console.log('Failed tests:')
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`  - ${t.name}: ${t.error}`)
  })
}

// Document remaining "Done —" strings for the report
console.log('\n=== Remaining "Done —" strings in message-stream.js ===')
const lines = messageStreamContent.split('\n')
lines.forEach((line, idx) => {
  if (line.includes('Done —')) {
    console.log(`Line ${idx + 1}: ${line.trim().slice(0, 100)}...`)
  }
})

// Exit with error code if tests failed
process.exit(results.failed > 0 ? 1 : 0)
