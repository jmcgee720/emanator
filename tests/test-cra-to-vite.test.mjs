// CRA → Vite converter tests
// Run: node tests/test-cra-to-vite.test.mjs

import assert from 'node:assert/strict'
import {
  isCraPackage,
  rewritePackageJson,
  rewriteIndexHtml,
  buildViteConfig,
  convertCraToVite,
} from '../lib/webcontainer/cra-to-vite.js'
import { toWebContainerTree, ensureScaffolding, detectDevCommand, detectProjectLayout } from '../lib/webcontainer/file-tree.js'

// 1) isCraPackage detection.
{
  assert.equal(isCraPackage(null), false)
  assert.equal(isCraPackage({}), false)
  assert.equal(isCraPackage({ dependencies: { react: '18' } }), false)
  assert.equal(isCraPackage({ dependencies: { 'react-scripts': '5.0.1' } }), true)
  assert.equal(isCraPackage({ devDependencies: { '@craco/craco': '^7' } }), true)
  console.log('✓ isCraPackage detects CRA + craco')
}

// 2) rewritePackageJson swaps scripts + deps.
{
  const before = {
    name: 'mangia-mama',
    scripts: { start: 'craco start', build: 'craco build', test: 'craco test' },
    dependencies: {
      react: '18.3.1',
      'react-dom': '18.3.1',
      'react-scripts': '5.0.1',
      '@craco/craco': '^7.1.0',
      'react-router-dom': '6.28.0',
    },
    devDependencies: {
      'eslint-config-react-app': '^7.0.1',
    },
  }
  const after = rewritePackageJson(before)

  // Scripts swapped to Vite (with --host 0.0.0.0 + --logLevel info so the
  // WebContainer port-forwarder sees the ready signal).
  assert.match(after.scripts.dev,   /^vite --port 3000\b/, 'dev script uses vite on 3000')
  assert.match(after.scripts.start, /^vite --port 3000\b/, 'start script (CRA compat) uses vite on 3000')
  assert.match(after.scripts.dev,   /--host 0\.0\.0\.0/,   'dev script binds 0.0.0.0 for WebContainer port detection')
  assert.equal(after.scripts.build, 'vite build', 'build script set')

  // CRA deps removed.
  assert.equal(after.dependencies['react-scripts'], undefined, 'react-scripts dropped')
  assert.equal(after.dependencies['@craco/craco'], undefined, 'craco dropped')
  assert.equal(after.devDependencies['eslint-config-react-app'], undefined, 'cra eslint dropped')

  // User deps preserved.
  assert.equal(after.dependencies.react, '18.3.1', 'react preserved')
  assert.equal(after.dependencies['react-router-dom'], '6.28.0', 'user deps preserved')

  // Vite deps injected.
  assert.ok(after.devDependencies.vite, 'vite added')
  assert.ok(after.devDependencies['@vitejs/plugin-react'], 'plugin-react added')
  assert.equal(after.type, 'module', 'type:module set for Vite')
  console.log('✓ rewritePackageJson swaps CRA → Vite cleanly')
}

// 3) rewriteIndexHtml strips CRA placeholders + injects entry script.
{
  const cra = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
  const out = rewriteIndexHtml(cra, 'src/index.js')
  assert.equal(out.includes('%PUBLIC_URL%'), false, '%PUBLIC_URL% stripped')
  assert.ok(out.includes('<script type="module" src="/src/index.js">'), 'entry script injected')
  assert.ok(out.includes('href="/favicon.ico"'), 'favicon path normalized')
  console.log('✓ rewriteIndexHtml strips placeholders + injects entry')
}

// 4) buildViteConfig contains the right pieces.
{
  const cfg = buildViteConfig()
  assert.ok(cfg.includes('@vitejs/plugin-react'), 'imports plugin-react')
  assert.ok(cfg.includes("envPrefix: 'REACT_APP_'"), 'CRA env prefix preserved')
  assert.ok(cfg.includes('port: 3000'), 'port matches CRA default')
  assert.ok(cfg.includes("outDir: 'build'"), 'CRA build dir preserved')
  // CRA puts JSX in `.js` — plugin-react MUST be told to include `.js` or
  // import-analysis crashes with "Unexpected token '<'".
  assert.ok(/react\(\s*\{\s*include:[^}]*\\\.\(mjs\|cjs\|js\|jsx\|ts\|tsx\)/.test(cfg),
    'plugin-react include covers .js/.mjs/.cjs (CRA JSX-in-.js compat)')
  // WebContainers crash esbuild WASM on large dep graphs — pre-bundling MUST
  // be disabled at dev time or Mangia-Mama (~500 deps) will gopark-panic
  // / hang at boot. We use `disabled: 'dev'` rather than `disabled: true`
  // because it preserves prod-build pre-bundling.
  assert.ok(cfg.includes('optimizeDeps'), 'optimizeDeps block present')
  assert.ok(/disabled:\s*['"]dev['"]/m.test(cfg) || /disabled:\s*true/m.test(cfg) || /noDiscovery:\s*true/m.test(cfg), 'optimizeDeps disables pre-bundling for WebContainer (esbuild WASM crash workaround)')
  assert.ok(/host:\s*true/.test(cfg), 'server.host=true so WebContainer port-forwarder sees ready signal')
  assert.ok(/usePolling:\s*true/.test(cfg), 'WebContainer-friendly polling watcher')
  console.log('✓ buildViteConfig has the right shape (incl. WebContainer + esbuild + JSX-in-.js workarounds)')
}

// 5) convertCraToVite end-to-end on a CRA scope.
{
  const tree = toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({
      name: 'app',
      scripts: { start: 'craco start' },
      dependencies: { react: '18.3.1', 'react-scripts': '5.0.1', '@craco/craco': '^7' },
    }) },
    { path: 'craco.config.js', content: 'module.exports = {}' },
    { path: 'public/index.html', content: '<html><body><div id="root"></div></body></html>' },
    { path: 'src/index.js', content: '// entry' },
    { path: 'src/App.js', content: 'export default function App() { return null }' },
  ])

  convertCraToVite(tree)

  const pkg = JSON.parse(tree['package.json'].file.contents)
  assert.equal(pkg.dependencies['react-scripts'], undefined, 'react-scripts dropped')
  assert.ok(pkg.devDependencies.vite, 'vite added')

  // Root index.html created from public/index.html
  assert.ok(tree['index.html']?.file, 'root index.html created')
  assert.ok(tree['index.html'].file.contents.includes('/src/index.js'), 'entry detected')

  // vite.config.js created
  assert.ok(tree['vite.config.js']?.file, 'vite.config.js created')

  // craco.config.js renamed to .bak
  assert.equal(tree['craco.config.js'], undefined, 'craco config moved aside')
  assert.ok(tree['craco.config.js.bak']?.file, 'craco config kept as .bak')

  // User code untouched
  assert.equal(tree.src.directory['App.js'].file.contents, 'export default function App() { return null }', 'App.js untouched')
  console.log('✓ convertCraToVite transforms CRA → Vite without touching user code')
}

// 6) Mangia Mama scenario — nested workspace + CRA → ensureScaffolding
//    runs convert + detectDevCommand picks the new vite scripts.
{
  const tree = toWebContainerTree([
    { path: 'README.md', content: '' },
    { path: 'backend/server.py', content: '' },
    { path: 'frontend/package.json', content: JSON.stringify({
      scripts: { start: 'craco start' },
      dependencies: { react: '18.3.1', 'react-scripts': '5.0.1', '@craco/craco': '^7' },
    }) },
    { path: 'frontend/craco.config.js', content: '' },
    { path: 'frontend/public/index.html', content: '<html><body><div id="root"></div></body></html>' },
    { path: 'frontend/src/index.js', content: '' },
  ])

  const scaffolded = ensureScaffolding(tree)
  const frontendPkg = JSON.parse(scaffolded.frontend.directory['package.json'].file.contents)
  assert.ok(frontendPkg.devDependencies.vite, 'frontend now uses vite')
  assert.equal(frontendPkg.dependencies['react-scripts'], undefined, 'react-scripts removed')

  const dev = detectDevCommand(scaffolded)
  assert.equal(dev.cwd, 'frontend', 'cwd still points to frontend')
  assert.deepEqual(dev.args, ['run', 'dev'], 'dev script kicks in (vite added it)')

  const layout = detectProjectLayout(scaffolded)
  // After conversion the framework is no longer 'cra' — it's whatever the
  // post-transform package classifies as. Vite deps + index.html → 'vite'.
  assert.equal(layout.framework, 'vite', 'post-conversion framework reads as vite')
  console.log('✓ Mangia Mama nested CRA auto-converts to Vite end-to-end')
}

// 7) Non-CRA imports unaffected (Vite import stays Vite, Next.js stays Next.js).
{
  const viteTree = toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({
      scripts: { dev: 'vite' },
      dependencies: { vite: '^5.0.0', react: '18.3.1' },
    }) },
    { path: 'index.html', content: '<html></html>' },
  ])
  ensureScaffolding(viteTree)
  const pkg = JSON.parse(viteTree['package.json'].file.contents)
  assert.equal(pkg.scripts.dev, 'vite', 'vite project unchanged')
  console.log('✓ non-CRA imports passed through unchanged')
}

// 8) Mangia Mama regression: postcss.config.js + tailwind.config.js using
//    module.exports must be renamed to .cjs when we flip package.json to
//    "type": "module". Otherwise WebContainer crashes with
//    "module is not defined in ES module scope" at dev server boot.
{
  const tree = toWebContainerTree([
    { path: 'frontend/package.json', content: JSON.stringify({
      scripts: { start: 'react-scripts start' },
      dependencies: { react: '18.3.1', 'react-scripts': '5.0.1' },
    }) },
    { path: 'frontend/public/index.html', content: '<html><body><div id="root"></div></body></html>' },
    { path: 'frontend/src/index.js', content: '' },
    { path: 'frontend/postcss.config.js', content: `module.exports = {\n  plugins: { tailwindcss: {}, autoprefixer: {} },\n}\n` },
    { path: 'frontend/tailwind.config.js', content: `module.exports = { content: ['./src/**/*.{js,jsx}'] }\n` },
    // An ESM-style config must NOT be renamed.
    { path: 'frontend/prettier.config.js', content: `export default { semi: false }\n` },
  ])

  const scaffolded = ensureScaffolding(tree)
  const frontend = scaffolded.frontend.directory

  assert.equal(frontend['postcss.config.js'], undefined, 'postcss.config.js renamed away')
  assert.ok(frontend['postcss.config.cjs']?.file, 'postcss.config.cjs created')
  assert.equal(frontend['tailwind.config.js'], undefined, 'tailwind.config.js renamed away')
  assert.ok(frontend['tailwind.config.cjs']?.file, 'tailwind.config.cjs created')

  // ESM config stays as-is.
  assert.ok(frontend['prettier.config.js']?.file, 'ESM prettier config left alone')
  assert.equal(frontend['prettier.config.cjs'], undefined, 'ESM configs not renamed')
  console.log('✓ CommonJS configs (postcss/tailwind) renamed to .cjs; ESM configs untouched')
}

// 9) Re-import regression: a project that was ALREADY converted in a
//    previous session (no react-scripts, type:module set) but still has
//    a leftover postcss.config.js using module.exports — the ensureScaffolding
//    safety net must rename it even though convertCraToVite is skipped.
{
  const tree = toWebContainerTree([
    { path: 'frontend/package.json', content: JSON.stringify({
      name: 'frontend',
      type: 'module',
      scripts: { dev: 'vite --port 3000 --host 0.0.0.0 --logLevel info' },
      dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
      devDependencies: { vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.0' },
    }) },
    { path: 'frontend/index.html', content: '<html><body><div id="root"></div><script type="module" src="/src/index.js"></script></body></html>' },
    { path: 'frontend/vite.config.js', content: `export default { plugins: [] }\n` },
    { path: 'frontend/src/index.js', content: '' },
    { path: 'frontend/postcss.config.js', content: `module.exports = {\n  plugins: { tailwindcss: {}, autoprefixer: {} },\n}\n` },
  ])

  const scaffolded = ensureScaffolding(tree)
  const frontend = scaffolded.frontend.directory

  // CRA conversion does NOT run (no react-scripts), but the safety net
  // must still rename postcss.config.js because type:module is set.
  assert.equal(frontend['postcss.config.js'], undefined, 'safety net renames postcss.config.js even on already-converted projects')
  assert.ok(frontend['postcss.config.cjs']?.file, 'postcss.config.cjs created by safety net')
  console.log('✓ already-converted projects (Mangia-Mama re-import) get the postcss safety-net rename')
}

console.log('\nAll CRA → Vite converter tests passed ✓')
