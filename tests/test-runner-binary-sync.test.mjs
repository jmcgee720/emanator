// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner /sync handler decodes data: URIs back to binary.
//
// Auroraly stores binary assets (PNG/JPG/etc) as `data:image/png;base64,…`
// strings in project_files.content. When syncing to a Fly machine the
// runner used to write that literal text to disk → Phaser (or any
// `<img src="/assets/foo.png">`) would download the data-URI text and
// fail to parse as image. Now the runner detects the data URI prefix
// and decodes back to binary bytes before writing.
//
// We mirror the decode logic locally to lock the contract without
// having to spin up a real express server in the test.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function decodeIfDataUri(content) {
  // Mirrors the patch in /app/preview-runner/index.js around line 381.
  if (typeof content !== 'string') return { content, isBinary: false }
  const m = content.match(/^data:[a-zA-Z0-9+\-./]+;base64,(.+)$/s)
  if (!m) return { content, isBinary: false }
  return { content: Buffer.from(m[1], 'base64'), isBinary: true }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('PNG data URI is decoded to a Buffer', () => {
  // 1×1 transparent PNG (smallest valid PNG bytes).
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const r = decodeIfDataUri(png)
  assert.equal(r.isBinary, true, 'should be flagged as binary')
  assert.ok(Buffer.isBuffer(r.content), 'should return a Buffer')
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(r.content[0], 0x89)
  assert.equal(r.content[1], 0x50)
  assert.equal(r.content[2], 0x4E)
  assert.equal(r.content[3], 0x47)
})

test('JPEG data URI is decoded', () => {
  // Minimal valid JPEG header: FF D8 FF E0
  const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
  const dataUri = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`
  const r = decodeIfDataUri(dataUri)
  assert.equal(r.isBinary, true)
  assert.deepEqual(r.content.slice(0, 4), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))
})

test('SVG data URI (text-based image format) is decoded', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const r = decodeIfDataUri(dataUri)
  assert.equal(r.isBinary, true)
  assert.equal(r.content.toString('utf8'), svg)
})

test('audio/wav data URI is decoded', () => {
  // WAV header magic "RIFF"
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
  const dataUri = `data:audio/wav;base64,${wav.toString('base64')}`
  const r = decodeIfDataUri(dataUri)
  assert.equal(r.isBinary, true)
  assert.equal(r.content.toString('ascii', 0, 4), 'RIFF')
})

test('source code (NOT a data URI) is left as a string', () => {
  const code = `import React from 'react'\nexport default function App() { return <div>x</div> }`
  const r = decodeIfDataUri(code)
  assert.equal(r.isBinary, false)
  assert.equal(r.content, code)
})

test('text containing the substring "data:image/" but NOT prefix is left alone', () => {
  // A JSX file might describe a data URI in a string literal.
  const code = `const example = "data:image/png;base64,abc"\nexport default function() { return null }`
  const r = decodeIfDataUri(code)
  assert.equal(r.isBinary, false)
  assert.equal(r.content, code, 'must not mangle source code that mentions data URIs')
})

test('empty content is left alone', () => {
  const r = decodeIfDataUri('')
  assert.equal(r.isBinary, false)
  assert.equal(r.content, '')
})

test('non-string content (e.g. Buffer) is passed through', () => {
  const buf = Buffer.from([1, 2, 3])
  const r = decodeIfDataUri(buf)
  assert.equal(r.isBinary, false)
  assert.equal(r.content, buf)
})

test('runner index.js contains the data-URI decode hook', () => {
  // Make sure the runtime code agrees with what we're testing here.
  const text = readFileSync('/app/preview-runner/index.js', 'utf8')
  assert.ok(text.includes("data:[a-zA-Z0-9"), 'runner must have the data URI regex')
  assert.ok(text.includes("Buffer.from(m[1], 'base64')"), 'runner must decode base64')
  assert.ok(text.includes('decodedAssets'), 'runner must report decoded count')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
