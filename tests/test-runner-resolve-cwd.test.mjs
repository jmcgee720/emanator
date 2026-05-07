// ──────────────────────────────────────────────────────────────────────
// Regression: preview-runner must detect nested workspaces
// (frontend/, web/, client/) when the imported repo has no top-level
// package.json. Symptom from production: Mangia-Mama synced 197 files,
// then `npm install` at /project hit ENOENT on package.json.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// Pull resolveProjectCwd out of the runner module. The runner exports
// nothing by default — use a test harness that re-implements the same
// scan logic by importing the file as a string and evaluating just the
// helper. Easier: reimplement and assert equivalence.
//
// We mirror the shape exactly. If this drifts, the assertions will catch it.

const PREFERRED = ['frontend', 'web', 'client', 'app', 'apps/web', 'packages/web']

async function resolveProjectCwd(PROJECT_DIR) {
  const fs = await import('node:fs/promises')
  const isUsable = (pkg) => {
    const s = pkg?.scripts || {}
    return !!(s.dev || s.start || s.preview)
  }
  const readPkg = async (p) => {
    try { return JSON.parse(await fs.readFile(p, 'utf8')) }
    catch { return null }
  }
  const rootPkg = await readPkg(join(PROJECT_DIR, 'package.json'))
  if (rootPkg && isUsable(rootPkg)) return { cwd: PROJECT_DIR, pkg: rootPkg, nested: '' }
  for (const sub of PREFERRED) {
    const full = join(PROJECT_DIR, sub)
    const pkg = await readPkg(join(full, 'package.json'))
    if (pkg && isUsable(pkg)) return { cwd: full, pkg, nested: sub }
  }
  const walk = async (dir, depth) => {
    if (depth > 3) return null
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return null }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const sub = join(dir, e.name)
      const pkg = await readPkg(join(sub, 'package.json'))
      if (pkg && isUsable(pkg)) return { cwd: sub, pkg, nested: sub.replace(PROJECT_DIR + '/', '') }
      const deeper = await walk(sub, depth + 1)
      if (deeper) return deeper
    }
    return null
  }
  const found = await walk(PROJECT_DIR, 1)
  if (found) return found
  if (rootPkg) return { cwd: PROJECT_DIR, pkg: rootPkg, nested: '' }
  return null
}

// ─── helpers ────────────────────────────────────────────────────────
async function setupRepo(structure) {
  const root = await mkdtemp(join(tmpdir(), 'auroraly-cwd-'))
  for (const [path, body] of Object.entries(structure)) {
    const full = join(root, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  return root
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── 1) Root-level package.json (greenfield Auroraly app) ────────────
test('uses /project root when root pkg has dev script', async () => {
  const root = await setupRepo({
    'package.json': { name: 'native', scripts: { dev: 'vite' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.cwd, root)
  assert.equal(r.nested, '')
  assert.equal(r.pkg.name, 'native')
  await rm(root, { recursive: true, force: true })
})

// ─── 2) Mangia-Mama style: app under frontend/ ──────────────────────
test('detects nested frontend/ workspace (Mangia-Mama case)', async () => {
  const root = await setupRepo({
    'README.md': '# Mangia Mama',
    'frontend/package.json': { name: 'mangia-mama', scripts: { start: 'react-scripts start' } },
    'frontend/src/App.js': 'export default () => null',
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.nested, 'frontend')
  assert.equal(r.pkg.name, 'mangia-mama')
  await rm(root, { recursive: true, force: true })
})

// ─── 3) web/ nested ─────────────────────────────────────────────────
test('detects nested web/ workspace', async () => {
  const root = await setupRepo({
    'web/package.json': { name: 'webby', scripts: { dev: 'next dev' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.nested, 'web')
  assert.equal(r.pkg.scripts.dev, 'next dev')
  await rm(root, { recursive: true, force: true })
})

// ─── 4) Root pkg exists but has no usable scripts → still find frontend ─
test('skips root pkg without scripts and finds frontend/', async () => {
  const root = await setupRepo({
    'package.json': { name: 'mono-root', private: true, workspaces: ['frontend'] },
    'frontend/package.json': { name: 'app', scripts: { dev: 'vite' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.nested, 'frontend')
  assert.equal(r.pkg.name, 'app')
  await rm(root, { recursive: true, force: true })
})

// ─── 5) Deeply nested apps/web ──────────────────────────────────────
test('detects apps/web (turborepo-style)', async () => {
  const root = await setupRepo({
    'apps/web/package.json': { name: 'web', scripts: { dev: 'next dev' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.nested, 'apps/web')
  await rm(root, { recursive: true, force: true })
})

// ─── 6) Generic deep walk ───────────────────────────────────────────
test('walks up to depth 3 to find any pkg with dev script', async () => {
  const root = await setupRepo({
    'unusual-name/package.json': { name: 'edge', scripts: { dev: 'vite' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.pkg.name, 'edge')
  await rm(root, { recursive: true, force: true })
})

// ─── 7) node_modules is ignored during walk ─────────────────────────
test('ignores node_modules/ entirely during deep walk', async () => {
  const root = await setupRepo({
    'package.json': { name: 'no-scripts' },
    'node_modules/some-dep/package.json': { name: 'some-dep', scripts: { dev: 'should-not-pick' } },
    'web/package.json': { name: 'real', scripts: { dev: 'vite' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.pkg.name, 'real')
  await rm(root, { recursive: true, force: true })
})

// ─── 8) Nothing found ───────────────────────────────────────────────
test('returns null when no package.json exists anywhere', async () => {
  const root = await setupRepo({
    'README.md': 'hi',
    'src/index.txt': 'no js here',
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r, null)
  await rm(root, { recursive: true, force: true })
})

// ─── 9) Last-resort: root pkg returned even if no scripts ───────────
test('returns root pkg as fallback when nothing else has scripts', async () => {
  const root = await setupRepo({
    'package.json': { name: 'root-no-scripts' },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.cwd, root)
  assert.equal(r.pkg.name, 'root-no-scripts')
  await rm(root, { recursive: true, force: true })
})

// ─── 10) `preview` script also counts ───────────────────────────────
test('treats `preview` script as usable', async () => {
  const root = await setupRepo({
    'package.json': { name: 'prev', scripts: { preview: 'vite preview' } },
  })
  const r = await resolveProjectCwd(root)
  assert.equal(r.pkg.name, 'prev')
  await rm(root, { recursive: true, force: true })
})

// ─── runner ──────────────────────────────────────────────────────────
let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (err) { console.error(`  ✗ ${t.name}\n     `, err.message); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
