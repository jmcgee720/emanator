/**
 * Test that read_files in self-edit mode returns properly numbered lines.
 * This is critical because edit_lines depends on these line numbers.
 * 
 * Run: node --experimental-vm-modules tests/test-read-files-numbering.mjs
 */

import fs from 'fs'
import { handleReadFiles } from '../lib/e2b/agent-tools.js'

const TEST_FILE = '/tmp/test-read-numbering.jsx'

// Create a test file
fs.writeFileSync(TEST_FILE, `import React from 'react'

export function Hello() {
  return (
    <div>
      <h1>Hello World</h1>
      <button>Click Me</button>
    </div>
  )
}`, 'utf-8')

console.log('=== read_files Line Numbering Test ===\n')

// Test self-edit mode (reads from disk with line numbers)
const result = await handleReadFiles(
  { paths: ['../tmp/test-read-numbering.jsx'], reason: 'Testing line numbers' },
  { isSelfEdit: true, projectFiles: [] }
)

// Verify line numbers are present
const hasLineNumbers = result.includes(' 1| ') && result.includes(' 5| ')
const hasEditLinesHint = result.includes('edit_lines')
const hasNumberedFormat = /\d+\|/.test(result)

console.log('Contains line numbers:', hasLineNumbers ? '✓' : '✗')
console.log('Has numbered format (N|):', hasNumberedFormat ? '✓' : '✗')
console.log('References edit_lines tool:', hasEditLinesHint ? '✓' : '✗')

// Verify specific line content
const lines = result.split('\n')
const line6 = lines.find(l => l.includes('6|') && l.includes('Hello World'))
const line7 = lines.find(l => l.includes('7|') && l.includes('Click Me'))

console.log('Line 6 has "Hello World":', line6 ? '✓' : '✗')
console.log('Line 7 has "Click Me":', line7 ? '✓' : '✗')

// Cleanup
fs.unlinkSync(TEST_FILE)

const allPassed = hasLineNumbers && hasNumberedFormat && hasEditLinesHint && line6 && line7
console.log(`\n=== ${allPassed ? 'ALL PASSED' : 'SOME FAILED'} ===`)
if (!allPassed) process.exit(1)
