// Quick unit test of the converter's pure-function correctness.
// (E2E test is in test-cra-to-vite-e2e.test.mjs.)

import assert from 'node:assert/strict'
import {
  isCRAProject,
  findCRARoot,
  findEntryFile,
  parseCRACoAliases,
  generateRootIndexHtml,
  transformPackageJson,
  cleanEntryImports,
  convertCRAtoVite,
} from '/app/lib/import/cra-to-vite.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

// ── isCRAProject / findCRARoot ──
test('isCRAProject: detects react-scripts at root', () => {
  const files = [{ path: 'package.json', content: JSON.stringify({ dependencies: { 'react-scripts': '5.0.1' } }) }]
  assert.equal(isCRAProject(files), true)
  assert.equal(findCRARoot(files), '')
})

test('isCRAProject: detects react-scripts in nested frontend/', () => {
  const files = [{ path: 'frontend/package.json', content: JSON.stringify({ dependencies: { 'react-scripts': '5.0.1' } }) }]
  assert.equal(isCRAProject(files), true)
  assert.equal(findCRARoot(files), 'frontend/')
})

test('isCRAProject: skips Vite project', () => {
  const files = [{ path: 'package.json', content: JSON.stringify({ devDependencies: { vite: '^5' } }) }]
  assert.equal(isCRAProject(files), false)
})

// ── findEntryFile ──
test('findEntryFile: prefers .tsx if present', () => {
  const files = [
    { path: 'src/index.tsx', content: '' },
    { path: 'src/index.js', content: '' },
  ]
  assert.equal(findEntryFile(files, ''), 'src/index.tsx')
})

test('findEntryFile: falls back to src/index.jsx default', () => {
  assert.equal(findEntryFile([], ''), 'src/index.jsx')
})

// ── parseCRACoAliases ──
test('parseCRACoAliases: extracts @ → src alias', () => {
  const cracoSource = `module.exports = { webpack: { alias: { '@': path.resolve(__dirname, 'src') } } }`
  const aliases = parseCRACoAliases(cracoSource)
  assert.equal(aliases['@'], './src')
})

test('parseCRACoAliases: handles double-quoted keys + nested paths', () => {
  const cracoSource = `module.exports = { webpack: { alias: { "@components": path.resolve(__dirname, "src/components") } } }`
  const aliases = parseCRACoAliases(cracoSource)
  assert.equal(aliases['@components'], './src/components')
})

// ── transformPackageJson ──
test('transformPackageJson: removes react-scripts, adds vite', () => {
  const pkg = transformPackageJson({
    dependencies: { 'react-scripts': '5.0.1', react: '^18' },
    devDependencies: { '@craco/craco': '^7' },
    scripts: { start: 'craco start', eject: 'react-scripts eject' },
  }, false)
  assert.ok(!pkg.dependencies['react-scripts'])
  assert.ok(!pkg.devDependencies['@craco/craco'])
  assert.ok(pkg.devDependencies['vite'])
  assert.ok(pkg.devDependencies['@vitejs/plugin-react'])
  assert.equal(pkg.scripts.dev, 'vite')
  assert.equal(pkg.scripts.start, 'vite')
  assert.equal(pkg.scripts.build, 'vite build')
  assert.ok(!pkg.scripts.eject)
})

test('transformPackageJson: adds typescript when project has .tsx', () => {
  const pkg = transformPackageJson({ dependencies: { 'react-scripts': '5.0.1' } }, true)
  assert.ok(pkg.devDependencies['typescript'])
})

test('transformPackageJson: drops eslintConfig with react-app extends', () => {
  const pkg = transformPackageJson({
    dependencies: { 'react-scripts': '5.0.1' },
    eslintConfig: { extends: ['react-app'] },
  }, false)
  assert.equal(pkg.eslintConfig, undefined)
})

// ── cleanEntryImports ──
test('cleanEntryImports: removes reportWebVitals import + call', () => {
  const before = `import reportWebVitals from './reportWebVitals';\nReactDOM.render(<App />);\nreportWebVitals();\n`
  const after = cleanEntryImports(before)
  assert.ok(!after.includes('reportWebVitals'))
})

test('cleanEntryImports: rewrites REACT_APP_FOO → import.meta.env.VITE_FOO', () => {
  const before = `const url = process.env.REACT_APP_API_URL;`
  const after = cleanEntryImports(before)
  assert.ok(after.includes('import.meta.env.VITE_API_URL'))
  assert.ok(!after.includes('REACT_APP_'))
})

// ── generateRootIndexHtml ──
test('generateRootIndexHtml: strips %PUBLIC_URL% template tag', () => {
  const cra = `<head><link rel="icon" href="%PUBLIC_URL%/favicon.ico" /></head><body><div id="root"></div></body>`
  const out = generateRootIndexHtml(cra, 'src/index.jsx')
  assert.ok(!out.includes('%PUBLIC_URL%'))
})

test('generateRootIndexHtml: injects module script tag', () => {
  const cra = `<body><div id="root"></div></body>`
  const out = generateRootIndexHtml(cra, 'src/main.tsx')
  assert.ok(out.includes('<script type="module" src="/src/main.tsx">'))
})

test('generateRootIndexHtml: works with empty input', () => {
  const out = generateRootIndexHtml('', 'src/index.jsx')
  assert.ok(out.includes('<div id="root">'))
  assert.ok(out.includes('type="module"'))
})

// ── convertCRAtoVite end-to-end ──
test('convertCRAtoVite: returns { converted: false } for non-CRA project', () => {
  const r = convertCRAtoVite([{ path: 'package.json', content: JSON.stringify({ devDependencies: { vite: '^5' } }) }])
  assert.equal(r.converted, false)
})

test('convertCRAtoVite: removes craco.config.js + public/index.html, adds vite.config.js + index.html', () => {
  const r = convertCRAtoVite([
    { path: 'package.json', content: JSON.stringify({ dependencies: { 'react-scripts': '5.0.1' } }) },
    { path: 'craco.config.js', content: 'module.exports = {}' },
    { path: 'public/index.html', content: '<html><body><div id="root"></div></body></html>' },
    { path: 'src/index.js', content: 'console.log("ok")' },
  ])
  assert.equal(r.converted, true)
  const findFile = p => r.files.find(f => f.path === p)
  assert.ok(findFile('vite.config.js'))
  assert.ok(findFile('index.html'))
  assert.ok(!findFile('craco.config.js'))
  assert.ok(!findFile('public/index.html'))
})

let failed = 0
for (const { name, fn } of tests) {
  try { fn(); console.log(`  ✓ ${name}`) }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`) }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed === 0 ? 0 : 1)
