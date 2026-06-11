// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner enables esbuild JSX-in-.js compilation so CRA-
// style projects (Mangia Mama, etc.) where App.js / index.js contain
// raw <jsx /> compile cleanly under Vite.
//
// Without this, Vite's import-analysis plugin throws:
//   "Failed to parse source for import analysis because the content
//    contains invalid JS syntax. If you are using JSX, make sure to
//    name the file with the .jsx or .tsx extension."
// at the first JSX usage in any `.js` file. Renaming user files is
// not an option — we instead configure esbuild's loader.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('/app/preview-runner/index.js', 'utf8')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('jsxLoaderBlock declares esbuild.loader = "jsx" with merge of user config', () => {
  const m = SRC.match(/const jsxLoaderBlock\s*=\s*`([\s\S]*?)`/)
  assert.ok(m, 'jsxLoaderBlock builder must exist')
  const tmpl = m[1]
  assert.match(tmpl, /esbuild:/, 'must declare esbuild block')
  assert.match(tmpl, /loader:\s*['"]jsx['"]/, 'esbuild.loader must be jsx')
  assert.match(tmpl, /include:\s*\/\\\\\.\(jsxv?\|tsx\?v?\)\$\/|include:\s*\/\\\\\.\(jsx\?\|tsx\?\)\$\//, 'include must match .js/.jsx/.ts/.tsx')
  assert.match(tmpl, /\.\.\.\(userConfig\?\.esbuild \|\| \{\}\)/, 'must spread userConfig.esbuild')
})

test('jsxLoaderBlock declares optimizeDeps.esbuildOptions.loader["js"] = "jsx"', () => {
  const m = SRC.match(/const jsxLoaderBlock\s*=\s*`([\s\S]*?)`/)
  const tmpl = m[1]
  assert.match(tmpl, /optimizeDeps:/, 'optimizeDeps block required (pre-bundle pass)')
  assert.match(tmpl, /['"]\.\.?js['"]:\s*['"]jsx['"]/, 'loader["js"] must be jsx (or ".js": "jsx")')
})

test('jsxLoaderBlockMinimal exists and stands alone (no userConfig merge)', () => {
  const m = SRC.match(/const jsxLoaderBlockMinimal\s*=\s*`([\s\S]*?)`/)
  assert.ok(m, 'jsxLoaderBlockMinimal must exist for the fallback config branch')
  const tmpl = m[1]
  assert.match(tmpl, /esbuild:/, 'fallback must also configure esbuild')
  assert.match(tmpl, /loader:\s*['"]jsx['"]/, 'fallback esbuild.loader must be jsx')
  assert.match(tmpl, /['"]\.\.?js['"]:\s*['"]jsx['"]/, 'fallback must map .js → jsx in optimizeDeps')
})

test('both branches of the generated vite.config.runner.mjs template the JSX block', () => {
  // user-config branch
  assert.match(SRC, /\.\.\.userConfig,\n\$\{aliasBlock\}\$\{jsxLoaderBlock\}/, 'user-config branch must template jsxLoaderBlock')
  // minimal-fallback branch
  assert.match(SRC, /defineConfig\(\{\n\$\{aliasBlockMinimal\}\$\{jsxLoaderBlockMinimal\}/, 'minimal-fallback branch must template jsxLoaderBlockMinimal')
})

test('runner logs the JSX loader activation for visibility in Floating Logs panel', () => {
  assert.match(SRC, /esbuild JSX-in-\.js loader enabled \(CRA compatibility\)/)
})

test('JSX-in-.js loader is unconditional — not gated on package.json contents', () => {
  // CRA-style projects don't have a known marker. Vite-only projects
  // already use .jsx, so applying the jsx loader to .js is a no-op for
  // them. We want it on for every Vite-eligible project.
  const ensureFn = SRC.match(/async function ensureViteHostOverride[\s\S]*?return true\s*\}/m)[0]
  assert.match(ensureFn, /const jsxLoaderBlock\s*=/, 'jsxLoaderBlock must be unconditional in ensureViteHostOverride')
  // Make sure there is NO `if (isCRA)` or similar predicate around it.
  const idx = ensureFn.indexOf('const jsxLoaderBlock')
  const before = ensureFn.slice(Math.max(0, idx - 200), idx)
  assert.doesNotMatch(before, /if\s*\(\s*isCRA/, 'jsxLoaderBlock must not be gated on isCRA')
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
