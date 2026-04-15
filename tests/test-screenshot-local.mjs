/**
 * Test local screenshot description for self-edit mode.
 * Run: node --experimental-vm-modules tests/test-screenshot-local.mjs
 */

import { describeScreenshotLocal } from '../lib/e2b/screenshot-service.js'

console.log('=== Local Screenshot Description Test ===\n')

try {
  console.log('Testing describeScreenshotLocal against localhost:3000...')
  const result = await describeScreenshotLocal('http://localhost:3000')
  console.log('\nResult:')
  console.log(result)
  
  // Verify it has expected sections
  const hasStatus = result.includes('Build Status')
  const hasTitle = result.includes('Title')
  const hasContent = result.includes('Has Content')
  
  console.log('\n--- Checks ---')
  console.log('Has Build Status:', hasStatus ? '✓' : '✗')
  console.log('Has Title:', hasTitle ? '✓' : '✗')
  console.log('Has Content check:', hasContent ? '✓' : '✗')
  
  const allPassed = hasStatus && hasTitle && hasContent
  console.log(`\n=== ${allPassed ? 'PASSED' : 'FAILED'} ===`)
  if (!allPassed) process.exit(1)
} catch (err) {
  console.error('Test failed with error:', err.message)
  process.exit(1)
}
