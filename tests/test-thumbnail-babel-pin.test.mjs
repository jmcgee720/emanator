/**
 * Regression test for: dashboard thumbnails showing "Preview Compile Error"
 *
 * Root cause: `@babel/standalone` unpinned URL auto-served v8 which removed
 * the `isTSX` and `allExtensions` options on `@babel/preset-typescript`, so
 * every project that touches a .tsx file failed to compile and showed the
 * red error overlay in the thumbnail iframe.
 *
 * Fix: pin the script tag to `@babel/standalone@7` everywhere it is used.
 * v7.29.x still accepts isTSX/allExtensions.
 *
 * This test asserts the pin is in place across all 3 usage sites.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const files = [
  '/app/components/dashboard/tabs/PreviewTab.jsx',
  '/app/app/share/[token]/page.jsx',
  '/app/lib/api/routes/deployments.js',
]

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  // Find every reference to @babel/standalone in the file (must all be pinned)
  const refs = src.match(/@babel\/standalone(@[^/"' ]*)?\/babel\.min\.js/g) || []
  assert.ok(refs.length > 0, `${f} should reference @babel/standalone`)
  for (const ref of refs) {
    assert.ok(
      /@babel\/standalone@7/.test(ref),
      `${f} has unpinned @babel/standalone reference (${ref}). ` +
      `Pin to @7 — v8 removed isTSX/allExtensions options.`
    )
  }
  console.log(`OK ${f} — ${refs.length} ref(s) pinned to v7`)
}

// Live compile test: confirm v7 still parses .tsx with the current preset options
const vm = await import('node:vm')
const babelSrc = fs.readFileSync('/tmp/babel7.js', 'utf8')
const ctx = { window: {}, self: {}, global: {} }
ctx.window = ctx; ctx.self = ctx; ctx.global = ctx
vm.createContext(ctx)
vm.runInContext(babelSrc, ctx)
const Babel = ctx.Babel || ctx.window.Babel
assert.ok(Babel, 'Babel global must be available')
assert.match(Babel.version, /^7\./, `expected Babel v7, got ${Babel.version}`)

const out = Babel.transform(
  'const x: number = 5; const C = () => <div>{x}</div>; export default C;',
  {
    presets: ['env', 'react', ['typescript', { isTSX: true, allExtensions: true }]],
    filename: 'test.tsx',
  }
)
assert.ok(out.code.length > 100, 'compile should produce real output')
assert.ok(!/Preview Compile Error/.test(out.code), 'no error overlay text in compiled output')
console.log('OK Babel v7 compiles .tsx with isTSX/allExtensions — version', Babel.version)
console.log('\nAll thumbnail regression checks passed.')
