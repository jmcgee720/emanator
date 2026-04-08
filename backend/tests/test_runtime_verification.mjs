/**
 * Test suite for runtime verification features in patch-verification.js
 * Tests: generateRuntimeTestScript, generateInteractionTests, buildVerifiedPatchResponse (three-tier status)
 */

import { 
  verifyPatchResult, 
  buildVerifiedPatchResponse, 
  generateRuntimeTestScript, 
  generateInteractionTests 
} from '../../lib/ai/patch-verification.js'

// Test results tracking
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

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`)
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

function assertNotNull(value, message = '') {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected non-null value')
  }
}

// ============================================
// Test generateRuntimeTestScript
// ============================================

console.log('\n=== Testing generateRuntimeTestScript ===')

test('generateRuntimeTestScript: returns null for empty checks', () => {
  const result = generateRuntimeTestScript([])
  assertEqual(result, null, 'Should return null for empty checks')
})

test('generateRuntimeTestScript: generates valid JS for heading_text check', () => {
  const checks = [{ type: 'heading_text', value: 'Welcome Home', description: 'Heading text "Welcome Home" should be present' }]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'setTimeout', 'Should use setTimeout for React mount delay')
  assertIncludes(script, 'querySelectorAll', 'Should use querySelectorAll for DOM checks')
  assertIncludes(script, 'postMessage', 'Should use postMessage for reporting')
  assertIncludes(script, 'runtime_verification', 'Should include runtime_verification type')
  assertIncludes(script, 'Welcome Home', 'Should include the heading text to check')
})

test('generateRuntimeTestScript: generates valid JS for active_section check', () => {
  const checks = [{ type: 'active_section', value: 'Dashboard', description: '"Dashboard" section should be active' }]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'Dashboard', 'Should include section name')
  assertIncludes(script, 'getBoundingClientRect', 'Should check element visibility')
  assertIncludes(script, 'active', 'Should check for active class/attribute')
})

test('generateRuntimeTestScript: generates valid JS for form_field check', () => {
  const checks = [{ type: 'form_field', value: 'Email', description: 'Form field "Email" should be present' }]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'Email', 'Should include field name')
  assertIncludes(script, 'label', 'Should check labels')
  assertIncludes(script, 'HTMLInputElement.prototype', 'Should use native input setter for React compatibility')
  assertIncludes(script, 'dispatchEvent', 'Should dispatch events for React state updates')
})

test('generateRuntimeTestScript: generates valid JS for button_text check', () => {
  const checks = [{ type: 'button_text', value: 'Get Started', description: 'Button "Get Started" should exist' }]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'Get Started', 'Should include button text')
  assertIncludes(script, 'button', 'Should query buttons')
})

test('generateRuntimeTestScript: generates valid JS for removed_element check', () => {
  const checks = [{ type: 'removed_element', value: 'Testimonials', description: '"Testimonials" should be removed' }]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'Testimonials', 'Should include element name')
  assertIncludes(script, 'indexOf', 'Should check if text is NOT present')
})

test('generateRuntimeTestScript: generates valid JS for nav_item check', () => {
  const checks = [{ type: 'nav_item', value: 'About', description: 'Navigation should include "About"' }]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'About', 'Should include nav item name')
  assertIncludes(script, 'nav', 'Should query nav elements')
  assertIncludes(script, 'sidebar', 'Should also check sidebar')
})

test('generateRuntimeTestScript: handles multiple checks', () => {
  const checks = [
    { type: 'heading_text', value: 'Welcome', description: 'Heading' },
    { type: 'button_text', value: 'Submit', description: 'Button' },
    { type: 'form_field', value: 'Name', description: 'Field' }
  ]
  const script = generateRuntimeTestScript(checks)
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'Welcome', 'Should include first check')
  assertIncludes(script, 'Submit', 'Should include second check')
  assertIncludes(script, 'Name', 'Should include third check')
  assertIncludes(script, 'Promise.all', 'Should use Promise.all for async tests')
})

test('generateRuntimeTestScript: includes interaction tests from options', () => {
  const checks = [{ type: 'heading_text', value: 'Test', description: 'Test heading' }]
  const interactionTests = [{
    name: 'Custom interaction test',
    code: '(function() { return { pass: true, detail: "Custom test passed" }; })()'
  }]
  const script = generateRuntimeTestScript(checks, { interactionTests })
  
  assertNotNull(script, 'Should generate a script')
  assertIncludes(script, 'Custom interaction test', 'Should include custom test name')
  assertIncludes(script, 'Custom test passed', 'Should include custom test code')
})

// ============================================
// Test generateInteractionTests
// ============================================

console.log('\n=== Testing generateInteractionTests ===')

test('generateInteractionTests: detects sidebar navigation from onClick patterns', () => {
  const savedFiles = [{
    path: 'app/page.jsx',
    content: `
      <button onClick={() => setSection('Dashboard')}>Dashboard</button>
      <button onClick={() => setSection('Settings')}>Settings</button>
      <button onClick={() => setSection('Profile')}>Profile</button>
    `
  }]
  const tests = generateInteractionTests(savedFiles, 'test message')
  
  assertTrue(tests.length > 0, 'Should generate interaction tests')
  assertTrue(tests.some(t => t.name.includes('Dashboard')), 'Should detect Dashboard navigation')
  assertTrue(tests.some(t => t.code.includes('click')), 'Should include click simulation')
})

test('generateInteractionTests: limits to max 3 navigation tests', () => {
  const savedFiles = [{
    path: 'app/page.jsx',
    content: `
      <button onClick={() => setSection('One')}>One</button>
      <button onClick={() => setSection('Two')}>Two</button>
      <button onClick={() => setSection('Three')}>Three</button>
      <button onClick={() => setSection('Four')}>Four</button>
      <button onClick={() => setSection('Five')}>Five</button>
    `
  }]
  const tests = generateInteractionTests(savedFiles, 'test message')
  
  const navTests = tests.filter(t => t.name.includes('Navigation'))
  assertTrue(navTests.length <= 3, 'Should limit to max 3 navigation tests')
})

test('generateInteractionTests: detects state preview inputs with JSON.stringify', () => {
  const savedFiles = [{
    path: 'app/page.jsx',
    content: `
      <input name="username" />
      <input name="email" />
      <pre>State Preview: {JSON.stringify(formData, null, 2)}</pre>
    `
  }]
  const tests = generateInteractionTests(savedFiles, 'test message')
  
  const inputTests = tests.filter(t => t.name.includes('Input'))
  assertTrue(inputTests.length > 0, 'Should generate input typing tests')
  assertTrue(inputTests.some(t => t.code.includes('RuntimeTest_')), 'Should include test value prefix')
})

test('generateInteractionTests: returns empty array when no patterns found', () => {
  const savedFiles = [{
    path: 'app/page.jsx',
    content: '<div>Simple static content</div>'
  }]
  const tests = generateInteractionTests(savedFiles, 'test message')
  
  assertEqual(tests.length, 0, 'Should return empty array for static content')
})

// ============================================
// Test buildVerifiedPatchResponse (three-tier status)
// ============================================

console.log('\n=== Testing buildVerifiedPatchResponse (three-tier status) ===')

test('buildVerifiedPatchResponse: handles VERIFIED status correctly', () => {
  const result = {
    verified: true,
    filesChanged: ['app/page.jsx'],
    whatShouldBeVisible: '- Heading "Welcome" should be present',
    howToVerify: '- Look for "Welcome" text on the page',
    verifiedItems: ['Heading text "Welcome" should be present'],
    unverifiedItems: [],
    status: 'VERIFIED'
  }
  const response = buildVerifiedPatchResponse(result, true)
  
  assertIncludes(response, 'FILES CHANGED', 'Should include FILES CHANGED section')
  assertIncludes(response, 'WHAT SHOULD NOW BE VISIBLE', 'Should include WHAT SHOULD NOW BE VISIBLE section')
  assertIncludes(response, 'HOW TO VERIFY IN PREVIEW', 'Should include HOW TO VERIFY section')
  assertIncludes(response, 'VERIFICATION STATUS:** VERIFIED', 'Should show VERIFIED status')
})

test('buildVerifiedPatchResponse: handles CODE_VERIFIED_ONLY status correctly', () => {
  const result = {
    verified: true,
    filesChanged: ['app/page.jsx'],
    whatShouldBeVisible: '- Heading "Welcome" should be present',
    howToVerify: '- Look for "Welcome" text on the page',
    verifiedItems: ['Heading text "Welcome" should be present'],
    unverifiedItems: [],
    status: 'VERIFIED',
    runtimeStatus: 'CODE_VERIFIED_ONLY'
  }
  const response = buildVerifiedPatchResponse(result, true)
  
  assertIncludes(response, 'VERIFICATION STATUS:** CODE VERIFIED ONLY', 'Should show CODE VERIFIED ONLY status')
  assertIncludes(response, 'runtime checks pending', 'Should mention runtime checks pending')
  assertIncludes(response, 'verification badge', 'Should mention verification badge')
})

test('buildVerifiedPatchResponse: handles NOT_VERIFIED status correctly', () => {
  const result = {
    verified: false,
    filesChanged: ['app/page.jsx'],
    whatShouldBeVisible: '- Heading "Welcome" should be present',
    howToVerify: '- Look for "Welcome" text on the page',
    verifiedItems: [],
    unverifiedItems: ['Heading text "Welcome" should be present'],
    status: 'NOT_VERIFIED'
  }
  const response = buildVerifiedPatchResponse(result, true)
  
  assertIncludes(response, 'VERIFICATION STATUS:** PATCH APPLIED BUT NOT VERIFIED', 'Should show NOT VERIFIED status')
  assertIncludes(response, 'Could not confirm', 'Should mention unverified items')
  assertIncludes(response, 'smaller, more specific follow-up', 'Should suggest follow-up')
})

test('buildVerifiedPatchResponse: handles APPLIED_NO_AUTO_CHECKS status', () => {
  const result = {
    verified: null,
    filesChanged: ['app/page.jsx'],
    whatShouldBeVisible: 'Changes applied per request. Manual preview check recommended.',
    howToVerify: 'Open the preview and verify the requested change is visible.',
    verifiedItems: ['1 file(s) written successfully'],
    unverifiedItems: [],
    status: 'APPLIED_NO_AUTO_CHECKS'
  }
  const response = buildVerifiedPatchResponse(result, true)
  
  assertIncludes(response, 'PATCH APPLIED', 'Should show PATCH APPLIED status')
  assertIncludes(response, 'manual preview check', 'Should recommend manual check')
})

test('buildVerifiedPatchResponse: runtimeStatus overrides status', () => {
  const result = {
    verified: true,
    filesChanged: ['app/page.jsx'],
    whatShouldBeVisible: '- Test',
    howToVerify: '- Test',
    verifiedItems: ['Test'],
    unverifiedItems: [],
    status: 'VERIFIED',
    runtimeStatus: 'CODE_VERIFIED_ONLY'
  }
  const response = buildVerifiedPatchResponse(result, true)
  
  // runtimeStatus should take precedence
  assertIncludes(response, 'CODE VERIFIED ONLY', 'runtimeStatus should override status')
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
