// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner pre-install package.json `overrides.ajv = ^8`
// patch. Canonical npm fix for the CRA `Cannot find module
// 'ajv/dist/compile/codegen'` crash.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

// Mirrors the patch logic in /app/preview-runner/index.js (runInstallIfNeeded).
function patchOverrides(pkgIn) {
  const pkg = JSON.parse(JSON.stringify(pkgIn)) // clone
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const isCRA = !!deps['react-scripts']
  if (!isCRA) return { pkg, patched: false }
  const overrides = pkg.overrides || {}
  const desired = { ajv: '^8', 'ajv-keywords': '^5', 'schema-utils': '^4' }
  let changed = false
  for (const [k, v] of Object.entries(desired)) {
    if (overrides[k] !== v) { overrides[k] = v; changed = true }
  }
  if (!changed) return { pkg, patched: false }
  pkg.overrides = overrides
  return { pkg, patched: true }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('patches CRA project that lacks overrides', () => {
  const r = patchOverrides({ dependencies: { 'react-scripts': '5.0.1' } })
  assert.equal(r.patched, true)
  assert.equal(r.pkg.overrides.ajv, '^8')
  assert.equal(r.pkg.overrides['ajv-keywords'], '^5')
  assert.equal(r.pkg.overrides['schema-utils'], '^4')
})

test('preserves existing overrides while adding all three', () => {
  const r = patchOverrides({
    dependencies: { 'react-scripts': '5.0.1' },
    overrides: { lodash: '^4' },
  })
  assert.equal(r.patched, true)
  assert.equal(r.pkg.overrides.ajv, '^8')
  assert.equal(r.pkg.overrides['ajv-keywords'], '^5')
  assert.equal(r.pkg.overrides['schema-utils'], '^4')
  assert.equal(r.pkg.overrides.lodash, '^4')
})

test('idempotent — does not re-patch when all overrides already correct', () => {
  const r = patchOverrides({
    dependencies: { 'react-scripts': '5.0.1' },
    overrides: { ajv: '^8', 'ajv-keywords': '^5', 'schema-utils': '^4' },
  })
  assert.equal(r.patched, false)
})

test('repatches if any one override is wrong', () => {
  const r = patchOverrides({
    dependencies: { 'react-scripts': '5.0.1' },
    overrides: { ajv: '^8', 'ajv-keywords': '^5' }, // missing schema-utils
  })
  assert.equal(r.patched, true)
  assert.equal(r.pkg.overrides['schema-utils'], '^4')
})

test('skips non-CRA projects', () => {
  const r = patchOverrides({ devDependencies: { vite: '^5' } })
  assert.equal(r.patched, false)
  assert.equal(r.pkg.overrides, undefined)
})

test('CRA in devDependencies still triggers patch', () => {
  const r = patchOverrides({ devDependencies: { 'react-scripts': '4.0.3' } })
  assert.equal(r.patched, true)
  assert.equal(r.pkg.overrides.ajv, '^8')
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed === 0 ? 0 : 1)
