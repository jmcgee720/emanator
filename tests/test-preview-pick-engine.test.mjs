/**
 * Regression tests for the preview engine picker.
 *
 * Rule: WebContainer for everything by default. Escape hatch to
 * server-engine (Fly) ONLY when the project imports a package that's
 * known to break inside WebContainers.
 */
import assert from 'node:assert/strict'
import { pickPreviewEngine, serverModeReasons } from '../lib/preview/pick-engine.js'

function pkg(overrides = {}) {
  return {
    path: 'package.json',
    content: JSON.stringify({ name: 'test', version: '0.0.0', ...overrides }),
  }
}

// Empty project = WebContainer (static preview)
assert.equal(pickPreviewEngine([]), 'webcontainer')
assert.equal(pickPreviewEngine(null), 'webcontainer')
console.log('OK empty project → webcontainer')

// Vite + React project → WebContainer
assert.equal(
  pickPreviewEngine([pkg({ dependencies: { react: '18.2.0', vite: '5.0.0' } })]),
  'webcontainer'
)
console.log('OK Vite+React → webcontainer')

// Next.js project → WebContainer
assert.equal(
  pickPreviewEngine([pkg({ dependencies: { next: '14.0.0', react: '18.2.0' } })]),
  'webcontainer'
)
console.log('OK Next.js → webcontainer')

// firebase-admin escape hatch → server
assert.equal(
  pickPreviewEngine([pkg({ dependencies: { 'firebase-admin': '11.0.0' } })]),
  'server'
)
console.log('OK firebase-admin → server')

// prisma escape hatch → server
assert.equal(
  pickPreviewEngine([pkg({ dependencies: { '@prisma/client': '5.0.0' } })]),
  'server'
)
console.log('OK prisma → server')

// puppeteer escape hatch → server
assert.equal(
  pickPreviewEngine([pkg({ devDependencies: { puppeteer: '21.0.0' } })]),
  'server'
)
console.log('OK puppeteer → server')

// sharp / canvas → server
assert.equal(
  pickPreviewEngine([pkg({ dependencies: { sharp: '0.33.0' } })]),
  'server'
)
console.log('OK sharp → server')

// bcryptjs (JS impl, no native binary) → WebContainer
assert.equal(
  pickPreviewEngine([pkg({ dependencies: { bcryptjs: '2.4.3' } })]),
  'webcontainer'
)
console.log('OK bcryptjs (pure JS) → webcontainer')

// Nested workspace with a backend that uses prisma → server
assert.equal(
  pickPreviewEngine([
    { path: 'frontend/package.json', content: JSON.stringify({ dependencies: { react: '18.2.0' } }) },
    { path: 'backend/package.json', content: JSON.stringify({ dependencies: { '@prisma/client': '5.0.0' } }) },
  ]),
  'server'
)
console.log('OK nested workspace with prisma in backend → server')

// serverModeReasons returns the offending packages
const reasons = serverModeReasons([pkg({ dependencies: { 'firebase-admin': '11.0.0', 'sharp': '0.33.0' } })])
assert.deepEqual(reasons.map(r => r.package).sort(), ['firebase-admin', 'sharp'])
console.log('OK serverModeReasons lists offending packages')

// Files without content are safely ignored (don't crash)
assert.equal(pickPreviewEngine([{ path: 'package.json' }]), 'webcontainer')
console.log('OK files without content are safely ignored')

console.log('\nAll pick-engine checks passed.')
