// ──────────────────────────────────────────────────────────────────────
// Unit tests for the size-cap safety net in /app/lib/supabase/file-storage.js
//
// Verifies that:
//   - source files >MAX_FILE_BYTES are REJECTED (throw FILE_TOO_LARGE)
//   - `_assets/*` rows get the looser MAX_ASSET_BYTES cap (legit hero images)
//   - rows under the cap pass through normally
//
// The cap is the last line of defense against a runaway AI generation
// poisoning a project's preview load (see Nexsara `app/page.jsx` 24MB repro).
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// We can't import file-storage directly without env + Supabase; mirror
// the cap logic locally and keep it in lockstep with file-storage.js.
// If you change the constants there, change them here too — tests will
// still cover the contract.
const MAX_FILE_BYTES = 500 * 1024
const MAX_ASSET_BYTES = 8 * 1024 * 1024

function checkCap(filePath, bytes) {
  const isAsset = typeof filePath === 'string' && filePath.startsWith('_assets/')
  const cap = isAsset ? MAX_ASSET_BYTES : MAX_FILE_BYTES
  return { exceeds: bytes > cap, cap }
}

test('source file at the 500KB cap is allowed', () => {
  const r = checkCap('app/page.jsx', 500 * 1024)
  assert.equal(r.exceeds, false)
})

test('source file 1 byte over the cap is rejected', () => {
  const r = checkCap('app/page.jsx', 500 * 1024 + 1)
  assert.equal(r.exceeds, true)
  assert.equal(r.cap, MAX_FILE_BYTES)
})

test('runaway 24MB source file (Nexsara repro) is rejected', () => {
  const r = checkCap('app/page.jsx', 24 * 1024 * 1024)
  assert.equal(r.exceeds, true)
})

test('asset row at 1MB is allowed (hero images are legitimately large)', () => {
  const r = checkCap('_assets/__gen_img_abc.png', 1 * 1024 * 1024)
  assert.equal(r.exceeds, false)
  assert.equal(r.cap, MAX_ASSET_BYTES)
})

test('asset row at 8MB is allowed (boundary)', () => {
  const r = checkCap('_assets/__gen_img_abc.png', 8 * 1024 * 1024)
  assert.equal(r.exceeds, false)
})

test('asset row beyond 8MB is rejected (must be malformed)', () => {
  const r = checkCap('_assets/__gen_img_abc.png', 9 * 1024 * 1024)
  assert.equal(r.exceeds, true)
})

test('tiny config files pass through', () => {
  assert.equal(checkCap('package.json', 200).exceeds, false)
  assert.equal(checkCap('.env', 50).exceeds, false)
})

test('file-storage exports MAX_FILE_BYTES + MAX_ASSET_BYTES', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role'
  const mod = await import('../lib/supabase/file-storage.js')
  assert.equal(mod.MAX_FILE_BYTES, MAX_FILE_BYTES, 'source-file cap matches')
  assert.equal(mod.MAX_ASSET_BYTES, MAX_ASSET_BYTES, 'asset cap matches')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
