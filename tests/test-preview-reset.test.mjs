// ── Reset preview endpoint smoke test ──
// Module-level: makes sure the route exports POST + OPTIONS and
// the file is valid JS that Next can pick up. Full e2e against a
// real Fly machine is impractical to test here.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(new URL('..', import.meta.url).pathname)
const ROUTE = path.join(REPO, 'app/api/previews/[projectId]/reset/route.js')

describe('reset preview endpoint', () => {
  test('route file exists at app/api/previews/[projectId]/reset/route.js', () => {
    assert.ok(fs.existsSync(ROUTE))
  })

  test('exports POST handler', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    assert.match(src, /export\s+async\s+function\s+POST/)
  })

  test('exports OPTIONS handler for CORS preflight', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    assert.match(src, /export\s+(async\s+)?function\s+OPTIONS/)
  })

  test('uses destroyMachine from lib/fly/machines', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    assert.match(src, /destroyMachine/)
    assert.match(src, /@\/lib\/fly\/machines/)
  })

  test('idempotent: returns ok when no machine exists', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    assert.match(src, /alreadyClean/)
  })

  test('gates on auth + ownership', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    assert.match(src, /getAuthUser/)
    assert.match(src, /checkAllowlist/)
    assert.match(src, /project\.user_id !== dbUser\.id/)
  })

  test('marked as dynamic so Vercel does not try to prerender it', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    assert.match(src, /force-dynamic/)
  })
})

describe('ServerPreview UI — Hard Reset button', () => {
  const src = fs.readFileSync(path.join(REPO, 'components/dashboard/tabs/ServerPreview.jsx'), 'utf8')

  test('declares hardReset callback', () => {
    assert.match(src, /const\s+hardReset\s*=\s*useCallback/)
  })

  test('button uses the reset endpoint', () => {
    assert.match(src, /\/api\/previews\/\$\{projectId\}\/reset/)
  })

  test('button has test id', () => {
    assert.match(src, /data-testid="server-preview-hard-reset"/)
  })

  test('button only shows when preview is stopped/idle/errored', () => {
    // We do not want users blowing away a healthy running machine.
    assert.match(
      src,
      /\(status === 'idle' \|\| status === 'stopped' \|\| status === 'error'\)[\s\S]{0,200}onClick=\{hardReset\}/,
    )
  })
})
