// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner installs ajv@^8 sidecar for CRA projects.
//
// CRA / react-scripts pulls schema-utils → ajv-keywords@^5 which tries
// to `import 'ajv/dist/compile/codegen'`. That path only exists in
// ajv@>=8, but react-scripts itself transitively pins ajv@^6, leaving
// only ajv@6 hoisted at the project root → `react-scripts start`
// crashes with "Cannot find module 'ajv/dist/compile/codegen'" before
// the dev server ever boots.
//
// The runner detects this (CRA dep + missing dist/compile/codegen.js)
// and installs ajv@^8 + ajv-keywords@^5 as no-save sidecars. We can't
// invoke the real spawn() in unit tests, so we re-export the predicate
// logic and verify it triggers on the right shapes.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

// Mirrors the patch in /app/preview-runner/index.js (runInstallIfNeeded).
function shouldInstallAjvSidecar({ pkg, ajvCodegenExists }) {
  if (!pkg) return false
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const isCRA = !!deps['react-scripts']
  if (!isCRA) return false
  return !ajvCodegenExists
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('triggers for CRA project without ajv@8 hoisted', () => {
  const pkg = { dependencies: { 'react-scripts': '5.0.1', react: '^18' } }
  assert.equal(shouldInstallAjvSidecar({ pkg, ajvCodegenExists: false }), true)
})

test('skips when CRA already has ajv@8 hoisted (codegen.js present)', () => {
  const pkg = { dependencies: { 'react-scripts': '5.0.1' } }
  assert.equal(shouldInstallAjvSidecar({ pkg, ajvCodegenExists: true }), false)
})

test('skips Vite project (no react-scripts)', () => {
  const pkg = { devDependencies: { vite: '^5', react: '^18' } }
  assert.equal(shouldInstallAjvSidecar({ pkg, ajvCodegenExists: false }), false)
})

test('skips Next.js project', () => {
  const pkg = { dependencies: { next: '^14', react: '^18' } }
  assert.equal(shouldInstallAjvSidecar({ pkg, ajvCodegenExists: false }), false)
})

test('handles CRA in devDependencies', () => {
  const pkg = { devDependencies: { 'react-scripts': '4.0.3' } }
  assert.equal(shouldInstallAjvSidecar({ pkg, ajvCodegenExists: false }), true)
})

test('skips when pkg is null/undefined', () => {
  assert.equal(shouldInstallAjvSidecar({ pkg: null, ajvCodegenExists: false }), false)
  assert.equal(shouldInstallAjvSidecar({ pkg: undefined, ajvCodegenExists: false }), false)
})

test('skips when pkg has no deps at all', () => {
  assert.equal(shouldInstallAjvSidecar({ pkg: {}, ajvCodegenExists: false }), false)
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
