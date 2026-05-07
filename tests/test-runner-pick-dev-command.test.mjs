// ──────────────────────────────────────────────────────────────────────
// Regression: preview-runner must handle imported projects whose
// `scripts.start` references a binary that wasn't actually installed
// (Mangia-Mama / Dopples both have `"start": "craco start"` but never
// declared @craco/craco — npm install succeeds, then `npm run start`
// dies with `craco: not found`, exit 127).
//
// Fix verified here: when the script binary is missing, the runner
// must fall back to the framework default (react-scripts / vite / next)
// based on what's actually installed in node_modules/.bin.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// Mirror of preview-runner/index.js's pickDevCommand. If they drift,
// these assertions fail loudly.
const USER_DEV_PORT = 3000

function pickDevCommand(pkg, cwd) {
  const scripts = pkg?.scripts || {}
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const isVite = !!deps.vite || /\bvite\b/.test(scripts.dev || '')
  const isNext = !!deps.next
  const isCRA = !!deps['react-scripts']
  const binDir = cwd ? join(cwd, 'node_modules', '.bin') : null
  const binExists = (name) => !!binDir && existsSync(join(binDir, name))
  const scriptIsRunnable = (script) => {
    if (!script) return false
    const stripped = script.replace(/^(\s*[A-Z_][A-Z0-9_]*=\S+\s+)+/, '').trim()
    const firstWord = stripped.split(/\s+/)[0]
    if (!firstWord) return false
    if (/^(node|npm|npx|yarn|pnpm)$/.test(firstWord)) return true
    return binExists(firstWord)
  }
  if (scripts.dev) {
    if (isVite) return ['npx', ['--no-install', 'vite', '--config', 'vite.config.runner.mjs', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    if (isNext) return ['npx', ['--no-install', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    if (scriptIsRunnable(scripts.dev)) return ['npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
  }
  if (scripts.start) {
    if (scriptIsRunnable(scripts.start)) return ['npm', ['run', 'start']]
  }
  if (scripts.preview && scriptIsRunnable(scripts.preview)) return ['npm', ['run', 'preview']]
  if (isVite && binExists('vite')) return ['npx', ['--no-install', 'vite', '--config', 'vite.config.runner.mjs', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
  if (isNext && binExists('next')) return ['npx', ['--no-install', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
  if (isCRA && binExists('react-scripts')) return ['npx', ['--no-install', 'react-scripts', 'start']]
  return null
}

// ─── helpers ────────────────────────────────────────────────────────
async function setupCwd({ pkg, bins = [] }) {
  const root = await mkdtemp(join(tmpdir(), 'auroraly-pick-'))
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg))
  await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
  for (const b of bins) {
    await writeFile(join(root, 'node_modules', '.bin', b), '#!/bin/sh\nexit 0\n')
  }
  return root
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── 1) Mangia-Mama / Dopples regression: craco missing, react-scripts present
test('falls back to react-scripts when scripts.start references missing craco binary', async () => {
  const cwd = await setupCwd({
    pkg: {
      scripts: { start: 'craco start' },
      dependencies: { 'react-scripts': '5.0.1', react: '^18.0.0' },
    },
    bins: ['react-scripts'], // craco intentionally missing!
  })
  const cmd = pickDevCommand({
    scripts: { start: 'craco start' },
    dependencies: { 'react-scripts': '5.0.1' },
  }, cwd)
  assert.deepEqual(cmd, ['npx', ['--no-install', 'react-scripts', 'start']])
  await rm(cwd, { recursive: true, force: true })
})

// ─── 2) Healthy scripts.dev uses npm run dev
test('uses scripts.dev when its binary is installed', async () => {
  const cwd = await setupCwd({
    pkg: { scripts: { dev: 'vite' }, dependencies: { vite: '^5.0.0' } },
    bins: ['vite'],
  })
  const cmd = pickDevCommand({
    scripts: { dev: 'vite' },
    dependencies: { vite: '^5.0.0' },
  }, cwd)
  // Vite-aware path overrides plain npm-run-dev with our config flag.
  assert.equal(cmd[0], 'npx')
  assert.ok(cmd[1].includes('vite'))
  assert.ok(cmd[1].includes('vite.config.runner.mjs'))
  await rm(cwd, { recursive: true, force: true })
})

// ─── 3) Vite preserved when scripts.start uses craco but vite IS in deps
test('vite dep wins over broken craco script', async () => {
  const cwd = await setupCwd({
    pkg: { scripts: { start: 'craco start' }, dependencies: { vite: '^5.0.0' } },
    bins: ['vite'],
  })
  const cmd = pickDevCommand({
    scripts: { start: 'craco start' },
    dependencies: { vite: '^5.0.0' },
  }, cwd)
  assert.equal(cmd[0], 'npx')
  assert.ok(cmd[1].includes('vite'))
  await rm(cwd, { recursive: true, force: true })
})

// ─── 4) Next.js fallback
test('falls back to next dev when scripts are broken but next is installed', async () => {
  const cwd = await setupCwd({
    pkg: { scripts: { start: 'broken-thing' }, dependencies: { next: '^14.0.0' } },
    bins: ['next'],
  })
  const cmd = pickDevCommand({
    scripts: { start: 'broken-thing' },
    dependencies: { next: '^14.0.0' },
  }, cwd)
  assert.deepEqual(cmd, ['npx', ['--no-install', 'next', 'dev', '--hostname', '0.0.0.0', '--port', '3000']])
  await rm(cwd, { recursive: true, force: true })
})

// ─── 5) Env-prefixed scripts: BROWSER=none craco start should still detect craco
test('strips env prefixes when checking script runnability', async () => {
  const cwd = await setupCwd({
    pkg: {
      scripts: { start: 'BROWSER=none HOST=0.0.0.0 craco start' },
      dependencies: { 'react-scripts': '5.0.1' },
    },
    bins: ['react-scripts'],
  })
  const cmd = pickDevCommand({
    scripts: { start: 'BROWSER=none HOST=0.0.0.0 craco start' },
    dependencies: { 'react-scripts': '5.0.1' },
  }, cwd)
  // craco still missing → should fall back to react-scripts
  assert.deepEqual(cmd, ['npx', ['--no-install', 'react-scripts', 'start']])
  await rm(cwd, { recursive: true, force: true })
})

// ─── 6) node/npm/npx/yarn are always considered runnable (system shell builtins)
test('accepts node/npm/npx/yarn as always-runnable', async () => {
  const cwd = await setupCwd({
    pkg: { scripts: { start: 'node server.js' } },
    bins: [], // empty
  })
  const cmd = pickDevCommand({ scripts: { start: 'node server.js' } }, cwd)
  assert.deepEqual(cmd, ['npm', ['run', 'start']])
  await rm(cwd, { recursive: true, force: true })
})

// ─── 7) Returns null when nothing works
test('returns null when no scripts work and no framework matches', async () => {
  const cwd = await setupCwd({
    pkg: { scripts: { start: 'craco start' }, dependencies: { weirdlib: '*' } },
    bins: [],
  })
  const cmd = pickDevCommand({
    scripts: { start: 'craco start' },
    dependencies: { weirdlib: '*' },
  }, cwd)
  assert.equal(cmd, null)
  await rm(cwd, { recursive: true, force: true })
})

// ─── runner ──────────────────────────────────────────────────────────
let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (err) { console.error(`  ✗ ${t.name}\n     `, err.message); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
