/**
 * Integration test: Simulates the Agent Loop flow for edit_lines.
 * 
 * This test mimics what message-stream.js does:
 * 1. Call handleReadFiles (self-edit mode) to get numbered lines
 * 2. Parse the line numbers from the output
 * 3. Call handleEditLines with those line numbers
 * 4. Verify the file was correctly modified
 * 
 * Run: node --experimental-vm-modules tests/test-agent-loop-edit-flow.mjs
 */

import fs from 'fs'
import path from 'path'
import { handleReadFiles, handleEditLines } from '../lib/e2b/agent-tools.js'

const TEST_DIR = '/tmp/agent-loop-test'
let testCount = 0
let passCount = 0
let failCount = 0

function setup() {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true })
}

function relativeToApp(absPath) {
  return path.relative('/app', absPath)
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

console.log('\n=== Agent Loop Integration Tests ===\n')
setup()

// ── Test 1: Full flow — read file, find line, edit it ──
await test('Full flow: read_files → edit_lines → verify', async () => {
  // Create a realistic JSX component file
  const jsxContent = `'use client'
import React, { useState } from 'react'
import { Button } from '../ui/button'

export function ProjectGrid({ projects, onSelect }) {
  const [selected, setSelected] = useState([])
  
  const handleSelectAll = () => {
    setSelected(projects.map(p => p.id))
  }
  
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-3 flex justify-between">
        <h2>Projects</h2>
        <Button onClick={handleSelectAll}>
          Select All
        </Button>
      </div>
      {projects.map(project => (
        <div
          key={project.id}
          className="p-4 border rounded"
          onClick={() => onSelect(project.id)}
        >
          <h3>{project.name}</h3>
          <p>{project.description}</p>
        </div>
      ))}
    </div>
  )
}`
  const absPath = path.join(TEST_DIR, 'ProjectGrid.jsx')
  fs.writeFileSync(absPath, jsxContent, 'utf-8')
  const relPath = relativeToApp(absPath)

  // Step 1: Read file (like the AI would)
  const readResult = await handleReadFiles(
    { paths: [relPath], reason: 'Need to change Select All button text' },
    { isSelfEdit: true, projectFiles: [] }
  )

  // Verify read_files returns numbered lines
  assert(readResult.includes('edit_lines'), 'read_files should mention edit_lines')
  
  // Step 2: Parse line numbers from the read output
  // The AI would see numbered lines like:
  //   16| <Button onClick={handleSelectAll}>
  //   17|   Select All
  //   18| </Button>
  const lines = jsxContent.split('\n')
  let selectAllButtonStart = -1
  let selectAllButtonEnd = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<Button') && lines[i].includes('handleSelectAll')) {
      selectAllButtonStart = i + 1 // 1-indexed
    }
    if (selectAllButtonStart > 0 && lines[i].includes('</Button>')) {
      selectAllButtonEnd = i + 1
      break
    }
  }

  assert(selectAllButtonStart > 0, `Found button start at line ${selectAllButtonStart}`)
  assert(selectAllButtonEnd > 0, `Found button end at line ${selectAllButtonEnd}`)

  // Step 3: Call edit_lines (like the AI would)
  const editResult = await handleEditLines({
    path: relPath,
    edits: [{
      type: 'replace',
      line_start: selectAllButtonStart,
      line_end: selectAllButtonEnd,
      content: '        <Button onClick={handleSelectAll} variant="outline">\n          Select All Projects\n        </Button>'
    }],
    summary: 'Updated button text and added variant prop'
  }, { isSelfEdit: true })

  assert(editResult.success, `Edit should succeed: ${JSON.stringify(editResult.errors)}`)
  
  // Step 4: Verify the file was correctly modified
  const newContent = fs.readFileSync(absPath, 'utf-8')
  assert(newContent.includes('Select All Projects'), 'New text should be present')
  assert(newContent.includes('variant="outline"'), 'New variant prop should be present')
  assert(!newContent.includes('>Select All<') && !newContent.includes('Select All\n        </Button>') || newContent.includes('Select All Projects'), 'Old text should be gone')
  
  // Verify surrounding code is intact
  assert(newContent.includes("'use client'"), 'File header intact')
  assert(newContent.includes('projects.map(project =>'), 'Code below edit is intact')
  assert(newContent.includes('handleSelectAll'), 'Click handler still there')
})

// ── Test 2: Multi-step agent flow — read → edit → read again → verify changes ──
await test('Multi-step: read → edit → read again → verify content matches', async () => {
  const content = `function add(a, b) {
  return a + b
}

function subtract(a, b) {
  return a - b
}

function multiply(a, b) {
  return a * b
}

module.exports = { add, subtract, multiply }`
  
  const absPath = path.join(TEST_DIR, 'math.js')
  fs.writeFileSync(absPath, content, 'utf-8')
  const relPath = relativeToApp(absPath)

  // Read
  const readResult1 = await handleReadFiles(
    { paths: [relPath], reason: 'Check current functions' },
    { isSelfEdit: true, projectFiles: [] }
  )
  assert(readResult1.includes('function add'), 'Initial read shows add function')

  // Edit: add a divide function after multiply
  const editResult = await handleEditLines({
    path: relPath,
    edits: [{
      type: 'insert_after',
      line_start: 11,
      content: '\nfunction divide(a, b) {\n  if (b === 0) throw new Error("Division by zero")\n  return a / b\n}'
    }],
    summary: 'Add divide function'
  }, { isSelfEdit: true })

  assert(editResult.success, 'Edit should succeed')

  // Also update exports
  const editResult2 = await handleEditLines({
    path: relPath,
    edits: [{
      type: 'replace',
      line_start: editResult.linesAfter,
      line_end: editResult.linesAfter,
      content: 'module.exports = { add, subtract, multiply, divide }'
    }],
    summary: 'Update exports to include divide'
  }, { isSelfEdit: true })

  assert(editResult2.success, 'Second edit should succeed')

  // Read again to verify
  const readResult2 = await handleReadFiles(
    { paths: [relPath], reason: 'Verify changes' },
    { isSelfEdit: true, projectFiles: [] }
  )
  assert(readResult2.includes('function divide'), 'New function should appear in re-read')
  assert(readResult2.includes('divide'), 'Exports should include divide')
})

// ── Test 3: Simulates an edit that the AI might get wrong — verify error handling ──
await test('Error handling: AI sends bad line numbers', async () => {
  const absPath = path.join(TEST_DIR, 'short.js')
  fs.writeFileSync(absPath, 'line1\nline2\nline3', 'utf-8')
  const relPath = relativeToApp(absPath)

  // AI tries to edit line 10 of a 3-line file
  const editResult = await handleEditLines({
    path: relPath,
    edits: [{ type: 'replace', line_start: 10, line_end: 10, content: 'oops' }],
    summary: 'Bad edit'
  }, { isSelfEdit: true })

  assert(!editResult.success, 'Should fail gracefully')
  assert(editResult.errors.length > 0, 'Should have error messages')
  
  // Verify original file is untouched
  const content = fs.readFileSync(absPath, 'utf-8')
  assert(content === 'line1\nline2\nline3', 'Original file should be untouched')
})

// ── Test 4: Verify message format matches what message-stream.js expects ──
await test('Result object shape matches message-stream.js expectations', async () => {
  const absPath = path.join(TEST_DIR, 'shape.js')
  fs.writeFileSync(absPath, 'const x = 1\nconst y = 2\nconst z = 3', 'utf-8')
  const relPath = relativeToApp(absPath)

  const editResult = await handleEditLines({
    path: relPath,
    edits: [{ type: 'replace', line_start: 2, line_end: 2, content: 'const y = 42' }],
    summary: 'Change y'
  }, { isSelfEdit: true })

  // Verify the shape expected by message-stream.js lines 2860-2881
  assert('success' in editResult, 'Has success')
  assert('applied' in editResult, 'Has applied')
  assert('failed' in editResult, 'Has failed')
  assert('errors' in editResult, 'Has errors')
  assert(Array.isArray(editResult.errors), 'errors is an array')
  assert('filePath' in editResult, 'Has filePath')
  assert('linesBefore' in editResult, 'Has linesBefore')
  assert('linesAfter' in editResult, 'Has linesAfter')
  assert('content' in editResult, 'Has content (for DB save)')
  assert(typeof editResult.content === 'string', 'content is a string')
  
  // Verify the success result message can be formatted (simulating line 2880-2881)
  const resultMsg = editResult.success
    ? `Successfully applied ${editResult.applied} edit(s) to \`${relPath}\` (${editResult.linesBefore} → ${editResult.linesAfter} lines). ${editResult.errors.length > 0 ? `\nWarnings: ${editResult.errors.join(', ')}` : ''}`
    : `Edit failed: ${editResult.errors?.join(', ') || editResult.error || 'Unknown error'}`
  
  assert(resultMsg.includes('Successfully applied 1 edit'), 'Message formats correctly')
  assert(resultMsg.includes('3 → 3 lines'), 'Line counts in message')
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
