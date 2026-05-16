// Smoke test for the preview-runner Next.js headers override.
// We can't import the runner module directly (it boots an Express app
// on module-eval), so this test mirrors the helper's logic against a
// throwaway temp directory and asserts the output files look right.

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// Recreate the relevant helper here, mirroring preview-runner/index.js.
// Keeping the test self-contained avoids importing the express boot side
// effects.
async function ensureNextHeadersOverride(pkg, dir) {
  const fs = await import('node:fs/promises')
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  if (!deps.next) return false

  const candidates = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts']
  let userCfg = null
  for (const c of candidates) {
    if (existsSync(join(dir, c))) { userCfg = c; break }
  }

  const HEADERS_JSON = JSON.stringify([
    { source: '/:path*', headers: [
      { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
      { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
    ] },
  ])

  const wrapperBody = userCfg
    ? `import userCfg from './${userCfg}'\nconst base = (typeof userCfg === 'function') ? await userCfg() : userCfg\nconst extraHeaders = ${HEADERS_JSON}\nexport default {\n  ...(base || {}),\n  async headers() {\n    const userHeaders = typeof base?.headers === 'function' ? (await base.headers()) : []\n    return [...(userHeaders || []), ...extraHeaders]\n  },\n}\n`
    : `const extraHeaders = ${HEADERS_JSON}\nexport default {\n  async headers() { return extraHeaders },\n}\n`

  await fs.writeFile(join(dir, 'next.config.runner.mjs'), wrapperBody, 'utf8')
  if (!userCfg) {
    await fs.writeFile(join(dir, 'next.config.mjs'), `export { default } from './next.config.runner.mjs'\n`, 'utf8')
  } else if (userCfg !== 'next.config.mjs') {
    await fs.writeFile(join(dir, 'next.config.mjs'), `export { default } from './next.config.runner.mjs'\n`, 'utf8')
  } else {
    const userBody = await fs.readFile(join(dir, 'next.config.mjs'), 'utf8')
    await fs.writeFile(join(dir, 'next.config.user.mjs'), userBody, 'utf8')
    const fixedWrapper = wrapperBody.replace(`from './${userCfg}'`, `from './next.config.user.mjs'`)
    await fs.writeFile(join(dir, 'next.config.runner.mjs'), fixedWrapper, 'utf8')
    await fs.writeFile(join(dir, 'next.config.mjs'), `export { default } from './next.config.runner.mjs'\n`, 'utf8')
  }
  return true
}

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'next-hdr-'))
}

test('no-op when project is not Next.js', async () => {
  const dir = freshDir()
  try {
    const result = await ensureNextHeadersOverride({ dependencies: { vite: '^5' } }, dir)
    assert.equal(result, false)
    assert.equal(existsSync(join(dir, 'next.config.runner.mjs')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fresh next project: writes both wrapper + next.config.mjs', async () => {
  const dir = freshDir()
  try {
    const result = await ensureNextHeadersOverride({ dependencies: { next: '^14' } }, dir)
    assert.equal(result, true)
    const wrapper = readFileSync(join(dir, 'next.config.runner.mjs'), 'utf8')
    const entry = readFileSync(join(dir, 'next.config.mjs'), 'utf8')
    assert.match(wrapper, /Cross-Origin-Embedder-Policy/)
    assert.match(wrapper, /credentialless/)
    assert.match(wrapper, /frame-ancestors \*/)
    assert.match(entry, /export \{ default \} from '\.\/next\.config\.runner\.mjs'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('wraps existing next.config.js into runner.mjs via shim', async () => {
  const dir = freshDir()
  try {
    writeFileSync(join(dir, 'next.config.js'), 'module.exports = { reactStrictMode: true }\n', 'utf8')
    await ensureNextHeadersOverride({ dependencies: { next: '^14' } }, dir)
    const wrapper = readFileSync(join(dir, 'next.config.runner.mjs'), 'utf8')
    assert.match(wrapper, /from '\.\/next\.config\.js'/)
    const entry = readFileSync(join(dir, 'next.config.mjs'), 'utf8')
    assert.match(entry, /from '\.\/next\.config\.runner\.mjs'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('relocates conflicting next.config.mjs to next.config.user.mjs', async () => {
  const dir = freshDir()
  try {
    writeFileSync(join(dir, 'next.config.mjs'), 'export default { reactStrictMode: true }\n', 'utf8')
    await ensureNextHeadersOverride({ dependencies: { next: '^14' } }, dir)
    // Original content survives under .user.mjs
    const userBody = readFileSync(join(dir, 'next.config.user.mjs'), 'utf8')
    assert.match(userBody, /reactStrictMode: true/)
    // Wrapper now imports the relocated file
    const wrapper = readFileSync(join(dir, 'next.config.runner.mjs'), 'utf8')
    assert.match(wrapper, /from '\.\/next\.config\.user\.mjs'/)
    // Entry re-exports the wrapper
    const entry = readFileSync(join(dir, 'next.config.mjs'), 'utf8')
    assert.match(entry, /from '\.\/next\.config\.runner\.mjs'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
