// Smoke tests for the WebContainer file-tree scaffolding logic.
// Run: node tests/test-webcontainer-scaffolding.test.mjs

import assert from 'node:assert/strict'
import {
  toWebContainerTree,
  ensureScaffolding,
  detectDevCommand,
  detectProjectLayout,
} from '../lib/webcontainer/file-tree.js'

const has = (tree, path) => {
  const parts = path.split('/')
  let cursor = tree
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    const isLeaf = i === parts.length - 1
    if (!cursor || typeof cursor !== 'object') return false
    if (isLeaf) return !!(cursor[seg] && cursor[seg].file)
    if (!cursor[seg] || !cursor[seg].directory) return false
    cursor = cursor[seg].directory
  }
  return false
}

// 1) Auroraly-generated project (no package.json) → full scaffolding injected.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'app/page.jsx', content: 'export default () => <div>hi</div>' },
  ]))
  assert.ok(has(tree, 'package.json'), 'auroraly: package.json injected')
  assert.ok(has(tree, 'next.config.js'), 'auroraly: next.config injected')
  assert.ok(has(tree, 'tailwind.config.js'), 'auroraly: tailwind config injected')
  assert.ok(has(tree, 'postcss.config.js'), 'auroraly: postcss config injected')
  assert.ok(has(tree, 'app/layout.jsx'), 'auroraly: app/layout.jsx injected')
  assert.ok(has(tree, 'app/globals.css'), 'auroraly: globals.css injected')
  console.log('✓ auroraly project gets full scaffolding')
}

// 2) Imported Pages-router project → no app/layout.jsx injection.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({ scripts: { dev: 'next dev' }, dependencies: {} }) },
    { path: 'pages/index.js', content: 'export default function Home() { return null }' },
    { path: 'pages/_app.js', content: '' },
  ]))
  assert.equal(has(tree, 'app/layout.jsx'), false, 'pages-router: app/layout NOT injected')
  assert.equal(has(tree, 'app/globals.css'), false, 'pages-router: globals.css NOT injected')
  // Self-contained → we don't add tailwind/postcss either (project owns its build chain).
  assert.equal(has(tree, 'next.config.js'), false, 'pages-router self-contained: scaffolding skipped')
  console.log('✓ pages-router import is left intact')
}

// 3) Imported App-router project with own layout → scaffolding stays away.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({ scripts: { dev: 'next dev -p 3000' } }) },
    { path: 'app/layout.tsx', content: 'export default function RootLayout({children}) { return children }' },
    { path: 'app/page.tsx', content: 'export default () => null' },
  ]))
  // Imported layout.tsx must remain — app/layout.jsx must NOT be added.
  assert.ok(has(tree, 'app/layout.tsx'), 'imported layout preserved')
  assert.equal(has(tree, 'app/layout.jsx'), false, 'no duplicate layout injected')
  console.log('✓ app-router import keeps its own layout')
}

// 4) Imported Vite project → fully self-contained.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({ scripts: { dev: 'vite' } }) },
    { path: 'index.html', content: '<!doctype html>' },
    { path: 'vite.config.js', content: 'export default {}' },
  ]))
  assert.equal(has(tree, 'next.config.js'), false, 'vite: no Next config injected')
  assert.equal(has(tree, 'tailwind.config.js'), false, 'vite: no tailwind config injected')
  assert.equal(has(tree, 'app/layout.jsx'), false, 'vite: no app/layout injected')
  console.log('✓ vite import is left fully alone')
}

// 5) detectDevCommand respects imported scripts.
{
  const treeWithDev = toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({ scripts: { dev: 'next dev' } }) },
  ])
  assert.deepEqual(detectDevCommand(treeWithDev), { cmd: 'npm', args: ['run', 'dev'], cwd: '' })

  const treeWithStartOnly = toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({ scripts: { start: 'http-server' } }) },
  ])
  assert.deepEqual(detectDevCommand(treeWithStartOnly), { cmd: 'npm', args: ['start'], cwd: '' })

  const treeWithoutPkg = toWebContainerTree([
    { path: 'app/page.jsx', content: '' },
  ])
  assert.deepEqual(detectDevCommand(treeWithoutPkg), { cmd: 'npm', args: ['run', 'dev'], cwd: '' })
  console.log('✓ detectDevCommand picks the right script')
}

// 6) Imported Next.js project gets @next/swc-wasm-nodejs + .babelrc patched in.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({
      scripts: { dev: 'next dev' },
      dependencies: { next: '14.2.3', react: '18.3.1' },
    }) },
    { path: 'pages/index.js', content: '' },
  ]))
  const pkg = JSON.parse(tree['package.json'].file.contents)
  assert.equal(pkg.dependencies['@next/swc-wasm-nodejs'], '14.2.3', 'wasm SWC pinned')
  assert.ok(tree['.babelrc']?.file, '.babelrc injected for Next.js imports')
  const babelConfig = JSON.parse(tree['.babelrc'].file.contents)
  assert.deepEqual(babelConfig.presets, ['next/babel'], '.babelrc has next/babel preset')
  console.log('✓ imported Next.js gets wasm SWC + .babelrc')
}

// 7) Non-Next imports (Vite) do NOT get @next/swc-wasm-nodejs or .babelrc.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({
      scripts: { dev: 'vite' },
      dependencies: { vite: '^5.0.0' },
    }) },
    { path: 'index.html', content: '<!doctype html>' },
  ]))
  const pkg = JSON.parse(tree['package.json'].file.contents)
  assert.equal(pkg.dependencies['@next/swc-wasm-nodejs'], undefined, 'no wasm SWC for vite')
  assert.equal(tree['.babelrc'], undefined, 'no .babelrc for vite')
  console.log('✓ non-Next imports left alone')
}

// 8) Caret/tilde version specifiers are normalized to exact pins.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({
      scripts: { dev: 'next dev' },
      dependencies: { next: '^14.1.0' },
    }) },
    { path: 'pages/index.js', content: '' },
  ]))
  const pkg = JSON.parse(tree['package.json'].file.contents)
  assert.equal(pkg.dependencies['@next/swc-wasm-nodejs'], '14.1.0', 'caret stripped to exact')
  console.log('✓ caret version strips to exact pin')
}

// 9) Existing .babelrc is preserved (we never overwrite project's babel config).
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({
      scripts: { dev: 'next dev' },
      dependencies: { next: '14.2.3' },
    }) },
    { path: '.babelrc', content: '{"presets": ["custom-preset"]}' },
    { path: 'pages/index.js', content: '' },
  ]))
  const babel = JSON.parse(tree['.babelrc'].file.contents)
  assert.deepEqual(babel.presets, ['custom-preset'], 'existing .babelrc preserved')
  console.log('✓ existing .babelrc preserved')
}

// 10) Auroraly-generated projects get .babelrc too.
{
  const tree = ensureScaffolding(toWebContainerTree([
    { path: 'app/page.jsx', content: 'export default () => null' },
  ]))
  assert.ok(tree['.babelrc']?.file, 'auroraly: .babelrc injected')
  console.log('✓ auroraly default also gets .babelrc')
}

// 11) Mangia Mama style — backend/ + frontend/ workspace, no root package.json.
//     This is the bug we hit: previously the code injected a Next.js shell at
//     root and ran `next dev` against an empty project. The actual React app
//     lived in frontend/ with craco. Detection should now point cwd → 'frontend'.
{
  const tree = toWebContainerTree([
    { path: 'README.md', content: '# Mangia Mama' },
    { path: 'backend/server.py', content: '' },
    { path: 'backend/requirements.txt', content: '' },
    { path: 'frontend/package.json', content: JSON.stringify({
      scripts: { start: 'craco start', build: 'craco build' },
      dependencies: { react: '18.3.1', '@craco/craco': '^7.0.0' },
    }) },
    { path: 'frontend/craco.config.js', content: 'module.exports = {}' },
    { path: 'frontend/public/index.html', content: '<html></html>' },
    { path: 'frontend/src/App.js', content: 'export default () => null' },
  ])
  const layout = detectProjectLayout(tree)
  assert.equal(layout.cwd, 'frontend', 'cwd resolves to frontend')
  assert.equal(layout.framework, 'cra', 'framework detected as CRA')
  assert.ok(layout.packageJson, 'packageJson resolved from frontend/')

  const dev = detectDevCommand(tree)
  assert.deepEqual(dev, { cmd: 'npm', args: ['start'], cwd: 'frontend' })

  // ensureScaffolding must NOT inject Next.js scaffolding at root.
  const scaffolded = ensureScaffolding(tree)
  assert.equal(scaffolded['package.json'], undefined, 'no root package.json injected')
  assert.equal(scaffolded['next.config.js'], undefined, 'no root next.config injected')
  assert.equal(scaffolded['.babelrc'], undefined, 'no root .babelrc injected')
  console.log('✓ Mangia Mama nested workspace detected — cwd=frontend, no fake scaffolding')
}

// 12) Monorepo apps/web layout.
{
  const tree = toWebContainerTree([
    { path: 'apps/web/package.json', content: JSON.stringify({
      scripts: { dev: 'next dev' },
      dependencies: { next: '14.2.3' },
    }) },
    { path: 'apps/web/app/layout.tsx', content: '' },
  ])
  const layout = detectProjectLayout(tree)
  assert.equal(layout.cwd, 'apps/web', 'cwd resolves to apps/web')
  assert.equal(layout.framework, 'next')
  console.log('✓ monorepo apps/web layout detected')
}

// 13) Auroraly-only content (no package.json anywhere) still falls through.
{
  const tree = toWebContainerTree([
    { path: 'app/page.jsx', content: '' },
    { path: 'components/hero.jsx', content: '' },
  ])
  const layout = detectProjectLayout(tree)
  assert.equal(layout.cwd, '', 'cwd is root for auroraly')
  assert.equal(layout.framework, 'auroraly')
  assert.equal(layout.packageJson, null)
  console.log('✓ auroraly content falls through to default scaffolding path')
}

console.log('\nAll WebContainer scaffolding tests passed ✓')
