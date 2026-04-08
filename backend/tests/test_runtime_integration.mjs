/**
 * Code inspection tests for message-stream.js runtime verification integration
 * Verifies that buildVerifiedResponseWithRuntime is used at all completion sites
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

function assertIncludes(str, substring, message = '') {
  if (!str || !str.includes(substring)) {
    throw new Error(`${message} Expected string to include "${substring}"`)
  }
}

// Load the source files
const messageStreamPath = path.join(process.cwd(), 'lib/ai/message-stream.js')
const streamClientPath = path.join(process.cwd(), 'lib/stream-client.js')
const dashboardPath = path.join(process.cwd(), 'components/dashboard/Dashboard.jsx')
const rightPanelPath = path.join(process.cwd(), 'components/dashboard/RightPanel.jsx')
const previewTabPath = path.join(process.cwd(), 'components/dashboard/tabs/PreviewTab.jsx')

const messageStreamCode = fs.readFileSync(messageStreamPath, 'utf-8')
const streamClientCode = fs.readFileSync(streamClientPath, 'utf-8')
const dashboardCode = fs.readFileSync(dashboardPath, 'utf-8')
const rightPanelCode = fs.readFileSync(rightPanelPath, 'utf-8')
const previewTabCode = fs.readFileSync(previewTabPath, 'utf-8')

// ============================================
// Test message-stream.js
// ============================================

console.log('\n=== Testing message-stream.js ===')

test('message-stream.js: imports generateRuntimeTestScript and generateInteractionTests', () => {
  assertIncludes(messageStreamCode, 'generateRuntimeTestScript', 'Should import generateRuntimeTestScript')
  assertIncludes(messageStreamCode, 'generateInteractionTests', 'Should import generateInteractionTests')
})

test('message-stream.js: defines buildVerifiedResponseWithRuntime helper', () => {
  assertIncludes(messageStreamCode, 'function buildVerifiedResponseWithRuntime', 'Should define buildVerifiedResponseWithRuntime')
  assertIncludes(messageStreamCode, 'verifyPatchResult(savedFiles, userMessage)', 'Should call verifyPatchResult')
  assertIncludes(messageStreamCode, 'generateInteractionTests(savedFiles, userMessage)', 'Should call generateInteractionTests')
  assertIncludes(messageStreamCode, 'generateRuntimeTestScript(vResult.checks', 'Should call generateRuntimeTestScript')
})

test('message-stream.js: buildVerifiedResponseWithRuntime returns { text, runtimeEvent }', () => {
  assertIncludes(messageStreamCode, "return { text, runtimeEvent }", 'Should return { text, runtimeEvent }')
})

test('message-stream.js: buildVerifiedResponseWithRuntime sets CODE_VERIFIED_ONLY when runtime script exists', () => {
  assertIncludes(messageStreamCode, "vResult.runtimeStatus = 'CODE_VERIFIED_ONLY'", 'Should set CODE_VERIFIED_ONLY status')
})

test('message-stream.js: buildVerifiedResponseWithRuntime creates runtime_tests event', () => {
  assertIncludes(messageStreamCode, "event: 'runtime_tests'", 'Should create runtime_tests event')
  assertIncludes(messageStreamCode, 'data: { script: runtimeScript', 'Should include script in event data')
})

test('message-stream.js: completion sites use buildVerifiedResponseWithRuntime', () => {
  // Count occurrences of buildVerifiedResponseWithRuntime calls
  const matches = messageStreamCode.match(/buildVerifiedResponseWithRuntime\(/g) || []
  assertTrue(matches.length >= 5, `Should have at least 5 calls to buildVerifiedResponseWithRuntime, found ${matches.length}`)
})

test('message-stream.js: completion sites yield runtimeEvent', () => {
  // Check that runtimeEvent is yielded after buildVerifiedResponseWithRuntime calls
  const yieldRuntimeMatches = messageStreamCode.match(/if \(.*runtimeEvent.*\) yield.*runtimeEvent|if \(.*Rt\) yield.*Rt/g) || []
  assertTrue(yieldRuntimeMatches.length >= 3, `Should yield runtimeEvent at completion sites, found ${yieldRuntimeMatches.length} patterns`)
})

test('message-stream.js: no remaining "Done —" strings', () => {
  const doneMatches = messageStreamCode.match(/Done —/g) || []
  assertTrue(doneMatches.length === 0, `Should have no "Done —" strings, found ${doneMatches.length}`)
})

// ============================================
// Test stream-client.js
// ============================================

console.log('\n=== Testing stream-client.js ===')

test('stream-client.js: handles runtime_tests event type', () => {
  assertIncludes(streamClientCode, "case 'runtime_tests'", 'Should have case for runtime_tests')
  assertIncludes(streamClientCode, 'onRuntimeTests', 'Should call onRuntimeTests callback')
})

// ============================================
// Test Dashboard.jsx
// ============================================

console.log('\n=== Testing Dashboard.jsx ===')

test('Dashboard.jsx: has runtimeTestScript state', () => {
  assertIncludes(dashboardCode, 'const [runtimeTestScript, setRuntimeTestScript] = useState(null)', 'Should have runtimeTestScript state')
})

test('Dashboard.jsx: has onRuntimeTests callback in sendMessage', () => {
  assertIncludes(dashboardCode, 'onRuntimeTests:', 'Should have onRuntimeTests callback')
  assertIncludes(dashboardCode, 'setRuntimeTestScript(data.script)', 'Should set runtimeTestScript from data.script')
})

test('Dashboard.jsx: has onRuntimeTests callback in executePlan', () => {
  // Check that executePlan also has the callback
  const executePlanSection = dashboardCode.slice(dashboardCode.indexOf('const executePlan'))
  assertIncludes(executePlanSection, 'onRuntimeTests:', 'executePlan should have onRuntimeTests callback')
})

test('Dashboard.jsx: passes runtimeTestScript to RightPanel', () => {
  assertIncludes(dashboardCode, 'runtimeTestScript={runtimeTestScript}', 'Should pass runtimeTestScript to RightPanel')
})

// ============================================
// Test RightPanel.jsx
// ============================================

console.log('\n=== Testing RightPanel.jsx ===')

test('RightPanel.jsx: accepts runtimeTestScript prop', () => {
  assertIncludes(rightPanelCode, 'runtimeTestScript,', 'Should accept runtimeTestScript prop')
})

test('RightPanel.jsx: passes runtimeTestScript to PreviewTab', () => {
  assertIncludes(rightPanelCode, 'runtimeTestScript={runtimeTestScript}', 'Should pass runtimeTestScript to PreviewTab')
})

// ============================================
// Test PreviewTab.jsx
// ============================================

console.log('\n=== Testing PreviewTab.jsx ===')

test('PreviewTab.jsx: accepts externalRuntimeTestScript prop', () => {
  assertIncludes(previewTabCode, 'runtimeTestScript: externalRuntimeTestScript', 'Should accept runtimeTestScript as externalRuntimeTestScript')
})

test('PreviewTab.jsx: has runtimeResults state', () => {
  assertIncludes(previewTabCode, 'const [runtimeResults, setRuntimeResults] = useState(null)', 'Should have runtimeResults state')
})

test('PreviewTab.jsx: listens for runtime_verification postMessage', () => {
  assertIncludes(previewTabCode, "event.data?.type === 'runtime_verification'", 'Should listen for runtime_verification message')
  assertIncludes(previewTabCode, 'setRuntimeResults(event.data)', 'Should set runtimeResults from event data')
})

test('PreviewTab.jsx: injects runtime test script into iframe', () => {
  assertIncludes(previewTabCode, 'script.textContent = runtimeTestScript', 'Should inject script into iframe')
  assertIncludes(previewTabCode, 'doc.body.appendChild(script)', 'Should append script to document body')
})

test('PreviewTab.jsx: shows runtime verification badge', () => {
  assertIncludes(previewTabCode, 'data-testid="runtime-verification-badge"', 'Should have runtime verification badge')
  assertIncludes(previewTabCode, "runtimeResults.allPassed ? 'VERIFIED'", 'Should show VERIFIED when all pass')
  assertIncludes(previewTabCode, 'runtimeResults.passed}/${runtimeResults.total}', 'Should show X/Y when not all pass')
})

test('PreviewTab.jsx: shows runtime results panel when not all tests pass', () => {
  assertIncludes(previewTabCode, 'data-testid="runtime-verification-results"', 'Should have runtime verification results panel')
  assertIncludes(previewTabCode, 'runtimeResults && !runtimeResults.allPassed', 'Should show panel when not all pass')
  assertIncludes(previewTabCode, 'runtimeResults.results?.map', 'Should map over results')
})

// ============================================
// Print summary
// ============================================

console.log('\n=== Test Summary ===')
console.log(`Passed: ${results.passed}`)
console.log(`Failed: ${results.failed}`)
console.log(`Total: ${results.passed + results.failed}`)

if (results.failed > 0) {
  console.log('\nFailed tests:')
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`  - ${t.name}: ${t.error}`)
  })
  process.exit(1)
}

console.log('\n✓ All tests passed!')
