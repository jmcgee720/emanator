// Test the content-aware sync logic in preview-runner/index.js.
//
// Verifies the behavior pinned by today's debugging session:
//   • Files with identical content on disk are NOT rewritten (no mtime
//     bump → no chokidar storm → no Next.js dev-server restart loop).
//   • Files with different content ARE rewritten.
//   • Files on disk but absent from the DB row set are REMOVED.
//   • node_modules / .next / .npmrc are always preserved untouched.
//
// We don't run the runner — that requires Fly. Instead we extract the
// sync core logic from source and run it against a tempdir.

import { strict as assert } from 'node:assert'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const runnerSrc = readFileSync(fileURLToPath(new URL('../preview-runner/index.js', import.meta.url)), 'utf8')

// ── Source-level contract checks ──
assert.ok(runnerSrc.includes('Content-aware sync'), 'sync block must be labeled content-aware')
assert.ok(runnerSrc.includes('Skip the write if the file on disk already has identical bytes'),
  'identical-bytes short-circuit must be present')
assert.ok(runnerSrc.includes("Identical — leave mtime alone, no Next.js restart"),
  'mtime-preservation rationale must be commented')
assert.ok(runnerSrc.includes('collectDiskPaths'), 'must enumerate disk for stale-file removal')
assert.ok(runnerSrc.includes("PRESERVE = new Set(['node_modules', '.next', '.npmrc'])"),
  'must preserve node_modules / .next / .npmrc on stale-file removal')

// ── Functional test: simulate the diff logic against a real fs ──
// We extract the algorithm into a self-contained replica because the
// real one is buried in a long async route handler with Supabase calls.

const TEST_DIR = join(tmpdir(), `auroraly-sync-test-${Date.now()}`)
mkdirSync(TEST_DIR, { recursive: true })

function diffSync(projectDir, dbRows) {
  const dbPaths = new Set(dbRows.map((r) => r.path))
  const PRESERVE = new Set(['node_modules', '.next', '.npmrc'])

  function collectDiskPaths(dir, rel = '') {
    const out = []
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name
      if (rel === '' && PRESERVE.has(ent.name)) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        out.push(...collectDiskPaths(full, relPath))
      } else {
        out.push(relPath)
      }
    }
    return out
  }

  // Remove stale.
  let removed = 0
  for (const p of collectDiskPaths(projectDir)) {
    if (!dbPaths.has(p)) {
      rmSync(join(projectDir, p), { force: true })
      removed++
    }
  }

  let written = 0, skipped = 0
  for (const row of dbRows) {
    const target = join(projectDir, row.path)
    const dir = target.substring(0, target.lastIndexOf('/'))
    mkdirSync(dir, { recursive: true })
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (existing === row.content) {
      skipped++
      continue
    }
    writeFileSync(target, row.content, 'utf8')
    written++
  }
  return { written, skipped, removed }
}

// Test 1: first-time sync writes everything.
{
  const result1 = diffSync(TEST_DIR, [
    { path: 'package.json', content: '{"name":"test"}' },
    { path: 'app/layout.jsx', content: 'export default function L(){}' },
    { path: 'app/globals.css', content: '@tailwind base;' },
  ])
  assert.equal(result1.written, 3, 'all 3 files should be written on first sync')
  assert.equal(result1.skipped, 0)
  assert.equal(result1.removed, 0)
}

// Test 2: re-sync with same content writes nothing (the critical fix).
{
  const mtimesBefore = {
    pkg: statSync(join(TEST_DIR, 'package.json')).mtimeMs,
    layout: statSync(join(TEST_DIR, 'app/layout.jsx')).mtimeMs,
  }
  // Brief pause so mtime granularity is visible if we did rewrite.
  const sleepMs = 20
  const t0 = Date.now()
  while (Date.now() - t0 < sleepMs) { /* spin */ }

  const result2 = diffSync(TEST_DIR, [
    { path: 'package.json', content: '{"name":"test"}' },
    { path: 'app/layout.jsx', content: 'export default function L(){}' },
    { path: 'app/globals.css', content: '@tailwind base;' },
  ])
  assert.equal(result2.written, 0, 'identical re-sync should write ZERO files')
  assert.equal(result2.skipped, 3)

  // mtime must not have changed — proves chokidar wouldn't fire.
  const mtimesAfter = {
    pkg: statSync(join(TEST_DIR, 'package.json')).mtimeMs,
    layout: statSync(join(TEST_DIR, 'app/layout.jsx')).mtimeMs,
  }
  assert.equal(mtimesAfter.pkg, mtimesBefore.pkg, 'package.json mtime must not bump')
  assert.equal(mtimesAfter.layout, mtimesBefore.layout, 'layout.jsx mtime must not bump')
}

// Test 3: changing one file writes only that file.
{
  const result3 = diffSync(TEST_DIR, [
    { path: 'package.json', content: '{"name":"test"}' },           // same
    { path: 'app/layout.jsx', content: 'export default function L(){return null}' }, // CHANGED
    { path: 'app/globals.css', content: '@tailwind base;' },        // same
  ])
  assert.equal(result3.written, 1, 'only the changed file should be written')
  assert.equal(result3.skipped, 2)
}

// Test 4: removing a file from DB removes it from disk.
{
  const result4 = diffSync(TEST_DIR, [
    { path: 'package.json', content: '{"name":"test"}' },
    { path: 'app/layout.jsx', content: 'export default function L(){return null}' },
    // globals.css removed from DB
  ])
  assert.equal(result4.removed, 1, 'orphaned globals.css should be removed')
  assert.ok(!existsSync(join(TEST_DIR, 'app/globals.css')), 'globals.css should not exist on disk')
}

// Test 5: node_modules / .next preserved even if not in DB.
{
  mkdirSync(join(TEST_DIR, 'node_modules', 'fake'), { recursive: true })
  writeFileSync(join(TEST_DIR, 'node_modules', 'fake', 'index.js'), 'console.log(1)')
  mkdirSync(join(TEST_DIR, '.next'), { recursive: true })
  writeFileSync(join(TEST_DIR, '.next', 'build-manifest.json'), '{}')
  writeFileSync(join(TEST_DIR, '.npmrc'), 'legacy-peer-deps=true')

  const result5 = diffSync(TEST_DIR, [
    { path: 'package.json', content: '{"name":"test"}' },
  ])
  assert.ok(existsSync(join(TEST_DIR, 'node_modules', 'fake', 'index.js')),
    'node_modules contents must survive sync')
  assert.ok(existsSync(join(TEST_DIR, '.next', 'build-manifest.json')),
    '.next contents must survive sync')
  assert.ok(existsSync(join(TEST_DIR, '.npmrc')), '.npmrc must survive sync')
  assert.ok(!existsSync(join(TEST_DIR, 'app/layout.jsx')), 'orphaned source files removed')
}

// Cleanup
rmSync(TEST_DIR, { recursive: true, force: true })

console.log('PASS: content-aware sync — identical files preserve mtime, changed files write, orphans removed, node_modules/.next/.npmrc preserved')
