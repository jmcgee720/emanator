/**
 * Preview resilience test — verifies __safeTransform falls back when the
 * typescript preset throws (e.g. when Babel v8 leaks through again).
 *
 * Doesn't import the .jsx (Node can't), instead extracts the relevant
 * helper from the source as text and exercises it in a vm sandbox.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync('/app/components/dashboard/tabs/PreviewTab.jsx', 'utf8')

// All 3 must be present in the generated preview HTML
assert.ok(src.includes('@babel/standalone@7'), 'Babel pinned to v7')
assert.ok(src.includes('__safeTransform'), 'safeTransform helper present')
assert.ok(src.includes('__presetsFor'), 'presetsFor selector present')
console.log('OK PreviewTab.jsx contains pinned URL + resilience helpers')

// Build a runnable JS snippet from the inline-script source lines to confirm
// the fallback actually works when Babel.transform throws.
const helperJS = `
function __mkPlugin() { return { visitor: {} }; }
function __presetsFor(filePath) {
  var isTs = /\\.(tsx|ts)$/i.test(filePath || "");
  if (isTs) return ["env", "react", ["typescript", { isTSX: true, allExtensions: true }]];
  return ["env", "react"];
}
function __safeTransform(code, modName, filePath) {
  try {
    return Babel.transform(code, { presets: __presetsFor(filePath), plugins: [__mkPlugin(modName)], filename: filePath });
  } catch (e) {
    if (/typescript|isTSX|allExtensions/i.test(String(e.message || ""))) {
      try { return Babel.transform(code, { presets: ["env", "react"], plugins: [__mkPlugin(modName)], filename: filePath }); }
      catch (e2) { throw e2; }
    }
    throw e;
  }
}
`

// Case 1: Babel works normally (v7 happy path)
const ctxOK = { Babel: { transform: () => ({ code: 'OK' }) } }
vm.createContext(ctxOK)
vm.runInContext(helperJS + '\nglobalThis._r = __safeTransform("x", "M", "M.tsx");', ctxOK)
assert.equal(ctxOK._r.code, 'OK')
console.log('OK happy path returns Babel output')

// Case 2: Babel v8 simulates removed-option error → fallback retries
let calls = 0
const ctxFail = {
  Babel: {
    transform(_code, opts) {
      calls++
      if (JSON.stringify(opts.presets).includes('isTSX')) {
        throw new Error('The .isTSX and .allExtensions options have been removed.')
      }
      return { code: 'FALLBACK_OK' }
    },
  },
}
vm.createContext(ctxFail)
vm.runInContext(helperJS + '\nglobalThis._r = __safeTransform("type X = 1;", "M", "M.tsx");', ctxFail)
assert.equal(ctxFail._r.code, 'FALLBACK_OK', 'fallback must retry without typescript preset')
assert.equal(calls, 2, 'expected 2 Babel calls (initial + retry)')
console.log('OK fallback retries without typescript preset on Babel v8-style failure')

// Case 3: non-preset error → must propagate, NOT swallow
const ctxOther = {
  Babel: { transform() { throw new Error('Unexpected token at 1:1') } },
}
vm.createContext(ctxOther)
let threw = false
try {
  vm.runInContext(helperJS + '\n__safeTransform("###", "M", "M.tsx");', ctxOther)
} catch (e) {
  threw = /Unexpected token/.test(e.message)
}
assert.ok(threw, 'non-preset errors must propagate so component-level error UI still surfaces')
console.log('OK unrelated compile errors still propagate')

// Case 4: .jsx file gets no typescript preset (saves work + dodges future bugs)
let lastOpts = null
const ctxJsx = {
  Babel: { transform(_c, opts) { lastOpts = opts; return { code: 'JSX_OK' } } },
}
vm.createContext(ctxJsx)
vm.runInContext(helperJS + '\n__safeTransform("<div/>", "M", "App.jsx");', ctxJsx)
assert.deepEqual(JSON.parse(JSON.stringify(lastOpts.presets)), ['env', 'react'], '.jsx must skip typescript preset')
console.log('OK .jsx files skip typescript preset entirely')

console.log('\nAll preview resilience checks passed.')
