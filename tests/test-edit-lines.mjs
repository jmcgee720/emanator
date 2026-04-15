/**
 * Unit tests for handleEditLines — the line-number-based editing tool.
 * Tests: replace, insert_after, delete, multi-edit bottom-to-top ordering,
 * boundary validation, empty file, and real-world scenarios.
 * 
 * Run: node --experimental-vm-modules tests/test-edit-lines.mjs
 */

import fs from 'fs'
import path from 'path'
import { handleEditLines } from '../lib/e2b/agent-tools.js'

const TEST_DIR = '/tmp/edit-lines-tests'
let testCount = 0
let passCount = 0
let failCount = 0

function setup() {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true })
}

function createTestFile(name, content) {
  const filePath = path.join(TEST_DIR, name)
  fs.writeFileSync(filePath, content, 'utf-8')
  // Return path relative to /app so handleEditLines resolves it under /app
  // Since handleEditLines resolves to /app/{path}, we use a path that resolves correctly
  return filePath
}

function readTestFile(absPath) {
  return fs.readFileSync(absPath, 'utf-8')
}

async function test(name, fn) {
  testCount++
  try {
    await fn()
    passCount++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failCount++
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed')
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Not equal'}\n    Expected: ${JSON.stringify(expected)}\n    Actual:   ${JSON.stringify(actual)}`)
  }
}

// We need to override the path resolution since handleEditLines resolves paths under /app
// Let's monkey-patch for testing — we'll use absolute paths directly by making the file path
// such that path.resolve('/app', filePath) === our actual path
// e.g., if we put the file at /tmp/edit-lines-tests/test.js, we pass '../tmp/edit-lines-tests/test.js'

function relativeToApp(absPath) {
  return path.relative('/app', absPath)
}

console.log('\n=== handleEditLines Unit Tests ===\n')
setup()

// ── Test 1: Basic single-line replace ──
await test('Basic single-line replace', async () => {
  const absPath = createTestFile('t1.js', 'line1\nline2\nline3\nline4\nline5')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 3, line_end: 3, content: 'REPLACED_LINE3' }],
    summary: 'Replace line 3'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.applied, 1, 'Should apply 1 edit')
  const content = readTestFile(absPath)
  assertEqual(content, 'line1\nline2\nREPLACED_LINE3\nline4\nline5', 'Content should match')
})

// ── Test 2: Multi-line replace ──
await test('Multi-line replace', async () => {
  const absPath = createTestFile('t2.js', 'a\nb\nc\nd\ne\nf')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 2, line_end: 4, content: 'B\nC\nD' }],
    summary: 'Replace lines 2-4'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  const content = readTestFile(absPath)
  assertEqual(content, 'a\nB\nC\nD\ne\nf', 'Replaced lines should match')
})

// ── Test 3: Replace with fewer lines (shrink) ──
await test('Replace with fewer lines (shrink)', async () => {
  const absPath = createTestFile('t3.js', 'a\nb\nc\nd\ne')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 2, line_end: 4, content: 'MERGED' }],
    summary: 'Merge lines 2-4 into one'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.linesAfter, 3, 'Should have 3 lines after')
  const content = readTestFile(absPath)
  assertEqual(content, 'a\nMERGED\ne', 'Content should be shrunk')
})

// ── Test 4: Replace with more lines (expand) ──
await test('Replace with more lines (expand)', async () => {
  const absPath = createTestFile('t4.js', 'a\nb\nc')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 2, line_end: 2, content: 'b1\nb2\nb3' }],
    summary: 'Expand line 2 into 3 lines'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.linesAfter, 5, 'Should have 5 lines after')
  const content = readTestFile(absPath)
  assertEqual(content, 'a\nb1\nb2\nb3\nc', 'Content should be expanded')
})

// ── Test 5: insert_after ──
await test('insert_after', async () => {
  const absPath = createTestFile('t5.js', 'line1\nline2\nline3')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'insert_after', line_start: 2, content: 'NEW_LINE' }],
    summary: 'Insert after line 2'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  const content = readTestFile(absPath)
  assertEqual(content, 'line1\nline2\nNEW_LINE\nline3', 'Inserted line should appear after line 2')
})

// ── Test 6: delete ──
await test('delete single line', async () => {
  const absPath = createTestFile('t6.js', 'a\nb\nc\nd\ne')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'delete', line_start: 3, line_end: 3 }],
    summary: 'Delete line 3'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.linesAfter, 4, 'Should have 4 lines')
  const content = readTestFile(absPath)
  assertEqual(content, 'a\nb\nd\ne', 'Line c should be removed')
})

// ── Test 7: delete range ──
await test('delete range', async () => {
  const absPath = createTestFile('t7.js', 'a\nb\nc\nd\ne')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'delete', line_start: 2, line_end: 4 }],
    summary: 'Delete lines 2-4'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.linesAfter, 2, 'Should have 2 lines')
  const content = readTestFile(absPath)
  assertEqual(content, 'a\ne', 'Only a and e should remain')
})

// ── Test 8: Multiple edits bottom-to-top ordering ──
await test('Multiple edits applied bottom-to-top', async () => {
  const absPath = createTestFile('t8.js', 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [
      { type: 'replace', line_start: 2, line_end: 2, content: 'REPLACED2' },
      { type: 'replace', line_start: 5, line_end: 5, content: 'REPLACED5' },
      { type: 'replace', line_start: 7, line_end: 7, content: 'REPLACED7' },
    ],
    summary: 'Replace lines 2, 5, 7'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.applied, 3, 'All 3 edits should apply')
  const content = readTestFile(absPath)
  assertEqual(content, 'L1\nREPLACED2\nL3\nL4\nREPLACED5\nL6\nREPLACED7\nL8', 'All replacements correct')
})

// ── Test 9: Multi-edit with insert + replace (bottom-to-top order matters) ──
await test('Mixed insert_after + replace (bottom-to-top)', async () => {
  const absPath = createTestFile('t9.js', 'A\nB\nC\nD\nE')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [
      { type: 'replace', line_start: 1, line_end: 1, content: 'AA' },
      { type: 'insert_after', line_start: 4, content: 'NEW_AFTER_D' },
    ],
    summary: 'Replace line 1 and insert after line 4'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.applied, 2, 'Both edits should apply')
  const content = readTestFile(absPath)
  // Insert after line 4 happens first (bottom-to-top), then replace line 1
  assertEqual(content, 'AA\nB\nC\nD\nNEW_AFTER_D\nE', 'Content correct after mixed edits')
})

// ── Test 10: Out-of-range line number ──
await test('Out-of-range line number produces error', async () => {
  const absPath = createTestFile('t10.js', 'a\nb\nc')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 10, line_end: 10, content: 'X' }],
    summary: 'Bad line number'
  }, { isSelfEdit: true })

  assert(!result.success, 'Should fail')
  assert(result.errors.length > 0, 'Should have errors')
  assert(result.errors[0].includes('out of range'), 'Error message should mention out of range')
})

// ── Test 11: Invalid line range (end < start) ──
await test('Invalid line range (end < start)', async () => {
  const absPath = createTestFile('t11.js', 'a\nb\nc\nd\ne')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 4, line_end: 2, content: 'X' }],
    summary: 'Bad range'
  }, { isSelfEdit: true })

  assert(!result.success || result.errors.length > 0, 'Should fail or have errors')
})

// ── Test 12: File not found ──
await test('File not found returns error', async () => {
  const result = await handleEditLines({
    path: '../tmp/nonexistent-file-xyz.js',
    edits: [{ type: 'replace', line_start: 1, line_end: 1, content: 'X' }],
    summary: 'Nonexistent file'
  }, { isSelfEdit: true })

  assert(!result.success, 'Should fail')
  assert(result.error?.includes('not found'), 'Error should mention not found')
})

// ── Test 13: Empty edits array ──
await test('Empty edits array returns error', async () => {
  const absPath = createTestFile('t13.js', 'content')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [],
    summary: 'Empty edits'
  }, { isSelfEdit: true })

  assert(!result.success, 'Should fail with empty edits')
})

// ── Test 14: Replace first line ──
await test('Replace first line', async () => {
  const absPath = createTestFile('t14.js', 'FIRST\nSECOND\nTHIRD')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 1, line_end: 1, content: 'NEW_FIRST' }],
    summary: 'Replace first line'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  const content = readTestFile(absPath)
  assertEqual(content, 'NEW_FIRST\nSECOND\nTHIRD', 'First line replaced')
})

// ── Test 15: Replace last line ──
await test('Replace last line', async () => {
  const absPath = createTestFile('t15.js', 'FIRST\nSECOND\nTHIRD')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{ type: 'replace', line_start: 3, line_end: 3, content: 'NEW_THIRD' }],
    summary: 'Replace last line'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  const content = readTestFile(absPath)
  assertEqual(content, 'FIRST\nSECOND\nNEW_THIRD', 'Last line replaced')
})

// ── Test 16: Real-world JSX edit scenario ──
await test('Real-world JSX button text change', async () => {
  const jsxContent = `import React from 'react'

export function ProjectGrid({ projects }) {
  return (
    <div className="grid">
      <button onClick={handleSelectAll}>
        Select All
      </button>
      {projects.map(p => (
        <div key={p.id}>{p.name}</div>
      ))}
    </div>
  )
}`
  const absPath = createTestFile('t16.jsx', jsxContent)
  
  // Simulate what the AI would do: replace lines 6-8 (the button)
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{
      type: 'replace',
      line_start: 6,
      line_end: 8,
      content: '      <button onClick={handleSelectAll} className="btn-primary">\n        Select All Projects\n      </button>'
    }],
    summary: 'Update button text and add className'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  const content = readTestFile(absPath)
  assert(content.includes('Select All Projects'), 'New text should be present')
  assert(content.includes('btn-primary'), 'New className should be present')
  assert(!content.includes('Select All\n'), 'Old text should be gone')
})

// ── Test 17: Insert multi-line block after ──
await test('Insert multi-line block after', async () => {
  const absPath = createTestFile('t17.js', 'import React from "react"\n\nexport default function App() {\n  return <div>Hello</div>\n}')
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [{
      type: 'insert_after',
      line_start: 1,
      content: 'import { useState } from "react"\nimport { Button } from "./ui/button"'
    }],
    summary: 'Add imports'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  const content = readTestFile(absPath)
  const lines = content.split('\n')
  assertEqual(lines[0], 'import React from "react"', 'Original line 1 intact')
  assertEqual(lines[1], 'import { useState } from "react"', 'First inserted line')
  assertEqual(lines[2], 'import { Button } from "./ui/button"', 'Second inserted line')
  assertEqual(lines[3], '', 'Original line 2 (empty) preserved')
})

// ── Test 18: linesBefore and linesAfter accuracy ──
await test('linesBefore and linesAfter are accurate', async () => {
  const absPath = createTestFile('t18.js', 'a\nb\nc\nd\ne') // 5 lines
  const result = await handleEditLines({
    path: relativeToApp(absPath),
    edits: [
      { type: 'delete', line_start: 3, line_end: 3 },    // removes 1 line
      { type: 'insert_after', line_start: 1, content: 'X\nY' }, // adds 2 lines
    ],
    summary: 'Delete + insert'
  }, { isSelfEdit: true })

  assert(result.success, 'Should succeed')
  assertEqual(result.linesBefore, 5, 'Started with 5 lines')
  assertEqual(result.linesAfter, 6, 'Should end with 6 lines (5 - 1 + 2)')
})

// ── Cleanup ──
try {
  fs.rmSync(TEST_DIR, { recursive: true })
} catch {}

// ── Summary ──
console.log(`\n=== Results: ${passCount}/${testCount} passed, ${failCount} failed ===\n`)

if (failCount > 0) {
  process.exit(1)
}
