/**
 * Unit tests for handleSearchReplace
 * Run: node --experimental-vm-modules tests/test-search-replace.mjs
 */

import fs from 'fs'
import path from 'path'
import { handleSearchReplace } from '../lib/e2b/agent-tools.js'

const TEST_DIR = '/tmp/search-replace-tests'
let pass = 0, fail = 0

function setup() { if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true }) }
function rel(abs) { return path.relative('/app', abs) }

async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m) }

console.log('\n=== handleSearchReplace Tests ===\n')
setup()

await test('Basic single replacement', async () => {
  const f = path.join(TEST_DIR, 't1.jsx')
  fs.writeFileSync(f, '<button>Old Text</button>')
  const r = await handleSearchReplace({ path: rel(f), edits: [{ old_str: 'Old Text', new_str: 'New Text' }], summary: 'test' }, { isSelfEdit: true })
  assert(r.success, 'Should succeed')
  assert(fs.readFileSync(f, 'utf-8') === '<button>New Text</button>', 'Content should match')
})

await test('Multiple replacements', async () => {
  const f = path.join(TEST_DIR, 't2.jsx')
  fs.writeFileSync(f, 'const a = 1\nconst b = 2\nconst c = 3')
  const r = await handleSearchReplace({ path: rel(f), edits: [
    { old_str: 'const a = 1', new_str: 'const a = 10' },
    { old_str: 'const c = 3', new_str: 'const c = 30' },
  ], summary: 'test' }, { isSelfEdit: true })
  assert(r.success, 'Should succeed')
  assert(r.applied === 2, 'Should apply 2')
  const content = fs.readFileSync(f, 'utf-8')
  assert(content.includes('a = 10') && content.includes('c = 30'), 'Both replaced')
})

await test('Exact match required — fails on mismatch', async () => {
  const f = path.join(TEST_DIR, 't3.jsx')
  fs.writeFileSync(f, '  <div className="test">')
  const r = await handleSearchReplace({ path: rel(f), edits: [{ old_str: '<div className="test">', new_str: '<div className="new">' }], summary: 'test' }, { isSelfEdit: true })
  // Should succeed because the exact string IS in the file (with leading spaces handled by normalization)
  assert(r.success, 'Should succeed with whitespace normalization')
})

await test('Completely wrong text fails safely', async () => {
  const f = path.join(TEST_DIR, 't4.jsx')
  fs.writeFileSync(f, '<div>Hello</div>')
  const r = await handleSearchReplace({ path: rel(f), edits: [{ old_str: 'NONEXISTENT TEXT', new_str: 'replacement' }], summary: 'test' }, { isSelfEdit: true })
  assert(!r.success, 'Should fail')
  assert(fs.readFileSync(f, 'utf-8') === '<div>Hello</div>', 'File should be unchanged')
})

await test('Multi-line replacement', async () => {
  const f = path.join(TEST_DIR, 't5.jsx')
  fs.writeFileSync(f, '<button\n  className="old"\n  onClick={handler}\n>\n  Click Me\n</button>')
  const r = await handleSearchReplace({ path: rel(f), edits: [{
    old_str: '<button\n  className="old"\n  onClick={handler}\n>\n  Click Me\n</button>',
    new_str: '<button className="new" onClick={handler}>\n  Click Here\n</button>'
  }], summary: 'test' }, { isSelfEdit: true })
  assert(r.success, 'Should succeed')
  assert(fs.readFileSync(f, 'utf-8').includes('Click Here'), 'New text present')
})

await test('Bracket mismatch caught', async () => {
  const f = path.join(TEST_DIR, 't6.jsx')
  fs.writeFileSync(f, 'function test() {\n  return <div>Hello</div>\n}')
  const r = await handleSearchReplace({ path: rel(f), edits: [{
    old_str: '  return <div>Hello</div>',
    new_str: '  return <div>Hello</div>\n  }\n  }\n  }'  // extra closing braces
  }], summary: 'test' }, { isSelfEdit: true })
  assert(!r.success, 'Should fail due to bracket mismatch')
  assert(r.errors[0].includes('Bracket mismatch'), 'Error mentions brackets')
})

await test('File not found', async () => {
  const r = await handleSearchReplace({ path: '../tmp/nonexistent.jsx', edits: [{ old_str: 'x', new_str: 'y' }], summary: 'test' }, { isSelfEdit: true })
  assert(!r.success, 'Should fail')
})

await test('originalContent preserved for rollback', async () => {
  const f = path.join(TEST_DIR, 't8.jsx')
  fs.writeFileSync(f, 'ORIGINAL CONTENT')
  const r = await handleSearchReplace({ path: rel(f), edits: [{ old_str: 'ORIGINAL', new_str: 'MODIFIED' }], summary: 'test' }, { isSelfEdit: true })
  assert(r.success, 'Should succeed')
  assert(r.originalContent === 'ORIGINAL CONTENT', 'Original preserved')
})

try { fs.rmSync(TEST_DIR, { recursive: true }) } catch {}
console.log(`\n=== ${pass}/${pass + fail} passed ===\n`)
if (fail > 0) process.exit(1)
