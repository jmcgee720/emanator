// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner auto-injects `@` → `./src` alias into the
// generated `vite.config.runner.mjs`.
//
// Mangia-Mama (and most CRA-to-Vite imports) reference assets via the
// conventional `@/foo` alias. Without the alias declared at the runner
// level, Vite's import-analysis plugin throws:
//
//     [plugin:vite:import-analysis] Failed to resolve import "@/index.css"
//
// rendering the user a red error overlay instead of their app.
//
// The runner detects a `src/` dir and bakes the alias into BOTH the
// user-config-merge branch and the minimal-fallback branch.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mirror the alias-block builder from /app/preview-runner/index.js
function buildAliasBlocks(dir, USER_DEV_PORT = 5173) {
  let srcAliasPath = null
  const srcDir = join(dir, 'src')
  if (existsSync(srcDir)) srcAliasPath = srcDir
  const aliasBlock = srcAliasPath
    ? `  resolve: {
    alias: {
      ...(userConfig?.resolve?.alias || {}),
      '@': ${JSON.stringify(srcAliasPath)},
    },
  },\n`
    : ''
  const aliasBlockMinimal = srcAliasPath
    ? `  resolve: {
    alias: {
      '@': ${JSON.stringify(srcAliasPath)},
    },
  },\n`
    : ''
  return { srcAliasPath, aliasBlock, aliasBlockMinimal }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('detects src/ and injects `@` alias in minimal-fallback config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-vite-'))
  try {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'index.css'), '/* */')
    const { srcAliasPath, aliasBlockMinimal } = buildAliasBlocks(dir)
    assert.equal(srcAliasPath, join(dir, 'src'))
    assert.match(aliasBlockMinimal, /'@':/)
    assert.match(aliasBlockMinimal, /resolve: \{/)
    assert.match(aliasBlockMinimal, /alias: \{/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('merges with userConfig.resolve.alias in user-config branch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-vite-'))
  try {
    mkdirSync(join(dir, 'src'))
    const { aliasBlock } = buildAliasBlocks(dir)
    assert.match(aliasBlock, /\.\.\.\(userConfig\?\.resolve\?\.alias \|\| \{\}\)/)
    assert.match(aliasBlock, /'@':/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('emits empty alias block when no src/ dir exists (static html, etc.)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-vite-'))
  try {
    const { srcAliasPath, aliasBlock, aliasBlockMinimal } = buildAliasBlocks(dir)
    assert.equal(srcAliasPath, null)
    assert.equal(aliasBlock, '')
    assert.equal(aliasBlockMinimal, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uses absolute path so Vite resolves regardless of process.cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-vite-'))
  try {
    mkdirSync(join(dir, 'src'))
    const { srcAliasPath } = buildAliasBlocks(dir)
    assert.ok(srcAliasPath.startsWith('/'), `expected absolute path, got ${srcAliasPath}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Also assert that the LIVE runner source contains the alias injection
// blocks (guards against accidental removal in future refactors).
test('preview-runner source still wires alias blocks into both branches', async () => {
  const src = readFileSync('/app/preview-runner/index.js', 'utf8')
  assert.match(src, /aliasBlock\s*=\s*srcAliasPath/, 'aliasBlock builder must exist')
  assert.match(src, /aliasBlockMinimal\s*=\s*srcAliasPath/, 'aliasBlockMinimal builder must exist')
  // Templated into the merged-config branch
  assert.match(src, /\.\.\.userConfig,\n\$\{aliasBlock\}/, 'aliasBlock must be templated next to userConfig spread')
  // Templated into the fallback branch
  assert.match(src, /defineConfig\(\{\n\$\{aliasBlockMinimal\}/, 'aliasBlockMinimal must be templated into fallback')
})

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${name}\n    ${err.message}`)
    }
  }
  if (failed) {
    console.error(`\n${failed} test(s) failed`)
    process.exit(1)
  }
  console.log(`\n${tests.length} test(s) passed`)
})()
