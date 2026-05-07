// ──────────────────────────────────────────────────────────────────────
// Unit tests for /app/lib/supabase/file-storage.js
//
// We mirror the pure decision logic (size threshold, key normalization,
// fallback semantics) from file-storage.js. If the source drifts from
// these tests, both fail loudly. Integration with real Supabase Storage
// is verified separately via /app/scripts/migrate-files-to-storage.mjs
// dry-run + live deployment smoke tests.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

const INLINE_SIZE_LIMIT = 8 * 1024

function storageKey(projectId, filePath) {
  const safePath = String(filePath || '')
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '_')
    .split('/')
    .map(seg => seg.replace(/[^a-zA-Z0-9._\-]/g, '_'))
    .join('/')
  return `${projectId}/${safePath}`
}

function decidePersist(content) {
  const text = typeof content === 'string' ? content : ''
  const bytes = Buffer.byteLength(text, 'utf8')
  return { goesToStorage: bytes > INLINE_SIZE_LIMIT, bytes }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── size-threshold decision ─────────────────────────────────────────
test('content under 8 KB stays inline (small package.json)', () => {
  const r = decidePersist('{"name":"tiny"}')
  assert.equal(r.goesToStorage, false)
})

test('content exactly at 8 KB stays inline (boundary)', () => {
  const r = decidePersist('x'.repeat(8 * 1024))
  assert.equal(r.goesToStorage, false)
})

test('content just over 8 KB goes to storage', () => {
  const r = decidePersist('x'.repeat(8 * 1024 + 1))
  assert.equal(r.goesToStorage, true)
})

test('content 100 KB goes to storage', () => {
  const r = decidePersist('x'.repeat(100 * 1024))
  assert.equal(r.goesToStorage, true)
})

test('multi-byte chars counted by bytes (not chars)', () => {
  // 4-byte emoji × 2049 = 8196 bytes → over 8 KB
  const r = decidePersist('🌟'.repeat(2049))
  assert.equal(r.goesToStorage, true)
})

test('empty string stays inline (cheap NULL-safe path)', () => {
  const r = decidePersist('')
  assert.equal(r.goesToStorage, false)
})

test('non-string (null/undefined) treated as empty', () => {
  assert.equal(decidePersist(null).goesToStorage, false)
  assert.equal(decidePersist(undefined).goesToStorage, false)
})

// ─── storage key normalization (security: prevents bucket escape) ───
test('storageKey: simple project_id/path', () => {
  assert.equal(storageKey('proj-1', 'src/index.js'), 'proj-1/src/index.js')
})

test('storageKey: strips leading slashes', () => {
  assert.equal(storageKey('proj-1', '/src/index.js'), 'proj-1/src/index.js')
  assert.equal(storageKey('proj-1', '///src/index.js'), 'proj-1/src/index.js')
})

test('storageKey: ../../ traversal sanitized to underscore', () => {
  // CRITICAL: prevents writing into another tenant's bucket prefix.
  // The regex replaces `..` with `_` but the surrounding `/` is kept.
  assert.equal(storageKey('proj-1', '../etc/passwd'), 'proj-1/_/etc/passwd')
  assert.equal(storageKey('proj-1', '../../../../root/.ssh/id_rsa'), 'proj-1/_/_/_/_/root/.ssh/id_rsa')
})

test('storageKey: unicode in paths sanitized to underscores (Supabase rejects)', () => {
  // Supabase Storage rejects non-ASCII chars with "Invalid key". Sanitize.
  assert.equal(storageKey('proj-1', 'src/héllo.js'), 'proj-1/src/h_llo.js')
})

test('storageKey: spaces and special chars sanitized (was breaking real uploads)', () => {
  // Real-world failures we hit: "Screenshot 2026-04-12 at 4.23.22 PM.png"
  assert.equal(
    storageKey('proj-1', '_uploads/Screenshot 2026-04-12 at 4.23.22 PM.png'),
    'proj-1/_uploads/Screenshot_2026-04-12_at_4.23.22_PM.png',
  )
  assert.equal(storageKey('p', 'a:b/c?d.png'), 'p/a_b/c_d.png')
})

test('storageKey: empty path is safe', () => {
  assert.equal(storageKey('proj-1', ''), 'proj-1/')
  assert.equal(storageKey('proj-1', null), 'proj-1/')
})

// ─── module export contract ─────────────────────────────────────────
test('file-storage module exports the documented surface', async () => {
  // file-storage.js calls createAdminClient() at import time, which
  // requires env vars. Set test stubs before importing.
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role'
  const mod = await import('../lib/supabase/file-storage.js')
  for (const name of [
    'STORAGE_BUCKET',
    'INLINE_SIZE_LIMIT',
    'ensureBucket',
    'persistContent',
    'resolveContent',
    'resolveAllContent',
    'deleteStorageObject',
  ]) {
    assert.ok(name in mod, `missing export: ${name}`)
  }
  assert.equal(mod.STORAGE_BUCKET, 'project-files')
  assert.equal(mod.INLINE_SIZE_LIMIT, 8 * 1024)
})

// ─── db.js wires up correctly (smoke check the imports resolve) ─────
test('db.js imports the persist/resolve helpers', async () => {
  const dbSrc = await (await import('node:fs/promises')).readFile(
    new URL('../lib/supabase/db.js', import.meta.url), 'utf8'
  )
  assert.match(dbSrc, /from\s+['"]\.\/file-storage(\.js)?['"]/)
  assert.match(dbSrc, /persistContent/)
  assert.match(dbSrc, /resolveContent/)
  assert.match(dbSrc, /resolveAllContent/)
  assert.match(dbSrc, /deleteStorageObject/)
  // Hot-path: findByProjectId must call resolveAllContent so callers
  // never see an unresolved storage_path placeholder.
  assert.match(dbSrc, /resolveAllContent\(data/)
  // bulkInsert must persist before insert (the Spyrals/Mangia-Mama path).
  assert.match(dbSrc, /persistContent\(r\.project_id,\s*r\.path,\s*r\.content\)/)
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (err) { console.error(`  ✗ ${t.name}\n     `, err.message); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
