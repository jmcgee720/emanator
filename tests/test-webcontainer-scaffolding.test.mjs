// Smoke tests for the WebContainer file-tree scaffolding logic.
// Run: node tests/test-webcontainer-scaffolding.test.mjs

import assert from 'node:assert/strict'
import {
  toWebContainerTree,
  ensureScaffolding,
  detectDevCommand,
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
  assert.deepEqual(detectDevCommand(treeWithDev), { cmd: 'npm', args: ['run', 'dev'] })

  const treeWithStartOnly = toWebContainerTree([
    { path: 'package.json', content: JSON.stringify({ scripts: { start: 'http-server' } }) },
  ])
  assert.deepEqual(detectDevCommand(treeWithStartOnly), { cmd: 'npm', args: ['start'] })

  const treeWithoutPkg = toWebContainerTree([
    { path: 'app/page.jsx', content: '' },
  ])
  assert.deepEqual(detectDevCommand(treeWithoutPkg), { cmd: 'npm', args: ['run', 'dev'] })
  console.log('✓ detectDevCommand picks the right script')
}

console.log('\nAll WebContainer scaffolding tests passed ✓')
