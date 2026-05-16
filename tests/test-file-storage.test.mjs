// ──────────────────────────────────────────────────────────────────────
// Unit tests for /app/lib/supabase/file-storage.js
//
// Updated Feb 2026 for the single-source-of-truth rewrite:
//   - All text files are stored INLINE in `project_files.content`,
//     regardless of size (Postgres TOAST handles multi-MB TEXT fine).
//   - Supabase Storage is used ONLY for `_assets/*` rows (binary image
//     data URIs from image-extractor).
//   - Oversized text files are REJECTED with FILE_TOO_LARGE rather
//     than silently spilling to Storage. 2MB cap on source files.
//
// We mirror the pure decision logic + storageKey normalization here so
// changes to file-storage.js have to update both. Integration with real
// Supabase Storage is exercised by the deployed runner.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ASSET_BYTES = 8 * 1024 * 1024

function storageKey(projectId, filePath) {
  const safePath = String(filePath || '')
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '_')
    .split('/')
    .map(seg => seg.replace(/[^a-zA-Z0-9._\-]/g, '_'))
    .join('/')
  return `${projectId}/${safePath}`
}

// Mirrors persistContent's routing decision (without the actual Supabase
// upload). Returns the would-be row shape so callers can assert.
function decidePersist(filePath, content) {
  const text = typeof content === 'string' ? content : ''
  const bytes = Buffer.byteLength(text, 'utf8')
  const isAssetRow = String(filePath || '').startsWith('_assets/')
  const cap = isAssetRow ? MAX_ASSET_BYTES : MAX_FILE_BYTES
  if (bytes > cap) {
    return { error: 'FILE_TOO_LARGE', bytes, cap }
  }
  if (!isAssetRow) {
    return { inline: true, content: text, storage_path: null }
  }
  // Asset rows go to Storage with a stable key.
  return { inline: false, content: null, storage_path: storageKey('proj-x', filePath) }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── routing: text files always inline ──────────────────────────────
test('tiny text file (package.json) stays inline', () => {
  const r = decidePersist('package.json', '{"name":"tiny"}')
  assert.equal(r.inline, true)
  assert.equal(r.storage_path, null)
})

test('500KB text file stays inline (was previously routed to Storage)', () => {
  const r = decidePersist('app/page.jsx', 'x'.repeat(500 * 1024))
  assert.equal(r.inline, true)
  assert.equal(r.storage_path, null)
})

test('1.5MB text file still inline (under 2MB cap)', () => {
  const r = decidePersist('huge-component.jsx', 'x'.repeat(1.5 * 1024 * 1024))
  assert.equal(r.inline, true)
})

test('text file just over 2MB rejected with FILE_TOO_LARGE', () => {
  const r = decidePersist('runaway.js', 'x'.repeat(2 * 1024 * 1024 + 1))
  assert.equal(r.error, 'FILE_TOO_LARGE')
})

test('empty string stays inline (cheap NULL-safe path)', () => {
  const r = decidePersist('blank.txt', '')
  assert.equal(r.inline, true)
})

test('non-string (null/undefined) treated as empty inline', () => {
  assert.equal(decidePersist('a.js', null).inline, true)
  assert.equal(decidePersist('a.js', undefined).inline, true)
})

// ─── routing: asset rows go to Storage ──────────────────────────────
test('_assets/ row goes to Storage (binary image data URI)', () => {
  // 1MB base64 image data URI, well within MAX_ASSET_BYTES (8MB).
  const dataUri = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024)
  const r = decidePersist('_assets/hero-image.png', dataUri)
  assert.equal(r.inline, false)
  assert.match(r.storage_path, /^proj-x\/_assets\/hero-image\.png$/)
})

test('_assets/ row over 8MB rejected', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024)
  const r = decidePersist('_assets/oversized.png', big)
  assert.equal(r.error, 'FILE_TOO_LARGE')
})

test('multi-byte chars counted by bytes (not chars) for cap enforcement', () => {
  // 4-byte emoji × ~600k = ~2.4MB — should reject as text file.
  const r = decidePersist('big-emoji.txt', '🌟'.repeat(600 * 1024))
  assert.equal(r.error, 'FILE_TOO_LARGE')
})

// ─── storage key normalization (security: prevents bucket escape) ───
test('storageKey: simple project_id/path', () => {
  assert.equal(storageKey('proj-1', '_assets/index.png'), 'proj-1/_assets/index.png')
})

test('storageKey: strips leading slashes', () => {
  assert.equal(storageKey('proj-1', '/_assets/img.png'), 'proj-1/_assets/img.png')
  assert.equal(storageKey('proj-1', '///_assets/img.png'), 'proj-1/_assets/img.png')
})

test('storageKey: ../../ traversal sanitized to underscore', () => {
  assert.equal(storageKey('proj-1', '../etc/passwd'), 'proj-1/_/etc/passwd')
  assert.equal(storageKey('proj-1', '../../../../root/.ssh/id_rsa'), 'proj-1/_/_/_/_/root/.ssh/id_rsa')
})

test('storageKey: unicode in paths sanitized to underscores (Supabase rejects)', () => {
  assert.equal(storageKey('proj-1', '_assets/héllo.png'), 'proj-1/_assets/h_llo.png')
})

test('storageKey: spaces and special chars sanitized', () => {
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
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role'
  const mod = await import('../lib/supabase/file-storage.js')
  for (const name of [
    'STORAGE_BUCKET',
    'INLINE_SIZE_LIMIT',
    'MAX_FILE_BYTES',
    'MAX_ASSET_BYTES',
    'ensureBucket',
    'persistContent',
    'resolveContent',
    'resolveAllContent',
    'deleteStorageObject',
  ]) {
    assert.ok(name in mod, `missing export: ${name}`)
  }
  assert.equal(mod.STORAGE_BUCKET, 'project-files')
  // INLINE_SIZE_LIMIT is now Infinity — text files always inline.
  assert.equal(mod.INLINE_SIZE_LIMIT, Infinity)
  assert.equal(mod.MAX_FILE_BYTES, 2 * 1024 * 1024)
  assert.equal(mod.MAX_ASSET_BYTES, 8 * 1024 * 1024)
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
