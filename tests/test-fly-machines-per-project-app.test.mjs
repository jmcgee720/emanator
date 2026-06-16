// ──────────────────────────────────────────────────────────────────────
// Unit tests for the refactored /app/lib/fly/machines.js
//
// Post One-App-Per-Project, every machine function:
//   • Scopes its Fly API path to a per-project app (auroraly-prv-<hash>)
//   • Falls back to the legacy shared app (FLY_PREVIEW_APP_NAME) for
//     LAZY MIGRATION — machines found there carry `_isLegacy = true`.
//   • Returns machines annotated with `_appName` so downstream
//     destroy/start/stop calls know which app to hit.
//
// publicDevUrl now returns `<dedicated-app>.fly.dev` regardless of
// machineId — there's exactly one machine per app, so the URL is
// deterministic by construction. No fly-replay, no 6PN, no ambiguity.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

process.env.FLY_API_TOKEN = 'fake-token'
process.env.FLY_PREVIEW_APP_NAME = 'auroraly-preview-runner' // legacy shared app
process.env.FLY_ORG_SLUG = 'auroraly'
process.env.FLY_REGION = 'iad'

const PROJ = 'e5e4f1f4-3b5e-4c55-b2dc-655f483ef3e0'
const { previewAppName } = await import('../lib/fly/apps.js')
const DEDICATED = previewAppName(PROJ)

const {
  findMachineForProject,
  destroyMachine,
  startMachine,
  stopMachine,
  publicDevUrl,
  machineControlUrl,
  resolveDeployedImage,
  isMachineImageStale,
} = await import('../lib/fly/machines.js')

let realFetch
function withFetchMock(mock, fn) {
  realFetch = globalThis.fetch
  globalThis.fetch = mock
  return fn().finally(() => { globalThis.fetch = realFetch })
}
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── publicDevUrl ────────────────────────────────────────────────────
test('publicDevUrl: returns <dedicated-app>.fly.dev (no machineId in URL)', () => {
  const url = publicDevUrl(PROJ, 'whatever-machine-id')
  assert.equal(url, `https://${DEDICATED}.fly.dev`, 'machineId must not affect URL')
})

test('publicDevUrl: works without machineId arg', () => {
  const url = publicDevUrl(PROJ)
  assert.equal(url, `https://${DEDICATED}.fly.dev`)
})

// ─── machineControlUrl ───────────────────────────────────────────────
test('machineControlUrl: builds <dedicated-app>.fly.dev/__runner__ (no port, no Fly-Force-Instance-Id)', () => {
  const { url, headers } = machineControlUrl({ id: 'mach-1', _appName: DEDICATED })
  assert.equal(url, `https://${DEDICATED}.fly.dev/__runner__`)
  // No Fly-Force-Instance-Id needed: each app has exactly one machine.
  assert.equal(headers['Fly-Force-Instance-Id'], undefined)
})

test('machineControlUrl: throws when called with bare machineId (missing _appName)', () => {
  assert.throws(() => machineControlUrl('bare-id'), /_appName/)
})

// ─── findMachineForProject: dedicated app hit ────────────────────────
test('findMachineForProject: returns dedicated-app machine with _appName annotation', async () => {
  const machine = { id: 'mach-A', config: { metadata: { auroraly_project_id: PROJ } }, state: 'started' }
  const found = await withFetchMock(async (url) => {
    if (String(url).includes(`/apps/${DEDICATED}/machines`)) return ok([machine])
    if (String(url).includes(`/apps/auroraly-preview-runner/machines`)) return ok([])
    throw new Error('unexpected ' + url)
  }, () => findMachineForProject(PROJ))
  assert.ok(found, 'should find the machine')
  assert.equal(found.id, 'mach-A')
  assert.equal(found._appName, DEDICATED, 'must annotate _appName')
  assert.notEqual(found._isLegacy, true, 'not a legacy machine')
})

// ─── findMachineForProject: lazy migration path ──────────────────────
test('findMachineForProject: falls back to legacy shared app and marks _isLegacy', async () => {
  const legacyMachine = { id: 'mach-LEGACY', config: { metadata: { auroraly_project_id: PROJ } }, state: 'started' }
  const found = await withFetchMock(async (url) => {
    if (String(url).includes(`/apps/${DEDICATED}/machines`)) return ok([])  // empty dedicated app
    if (String(url).includes(`/apps/auroraly-preview-runner/machines`)) return ok([legacyMachine])
    throw new Error('unexpected ' + url)
  }, () => findMachineForProject(PROJ))
  assert.ok(found, 'should find legacy machine')
  assert.equal(found.id, 'mach-LEGACY')
  assert.equal(found._appName, 'auroraly-preview-runner', 'legacy app name')
  assert.equal(found._isLegacy, true, 'must flag as legacy for migration')
})

test('findMachineForProject: returns null when no machine in either app', async () => {
  const found = await withFetchMock(async () => ok([]), () => findMachineForProject(PROJ))
  assert.equal(found, null)
})

test('findMachineForProject: returns null when dedicated app 404s and legacy empty', async () => {
  // 404 = app doesn't exist yet (first-ever start for this project).
  const found = await withFetchMock(async (url) => {
    if (String(url).includes(`/apps/${DEDICATED}/machines`)) return ok({ error: 'not found' }, 404)
    return ok([])
  }, () => findMachineForProject(PROJ))
  assert.equal(found, null)
})

// ─── destroyMachine / startMachine / stopMachine: routes to correct app ─
test('destroyMachine: hits the per-machine _appName, not the legacy env app', async () => {
  let hit = null
  await withFetchMock(async (url, init) => {
    hit = { url: String(url), method: init?.method }
    return ok({})
  }, () => destroyMachine({ id: 'mach-X', _appName: DEDICATED }))
  assert.ok(hit.url.includes(`/apps/${DEDICATED}/machines/mach-X`), `hit ${hit.url}`)
  assert.equal(hit.method, 'DELETE')
})

test('destroyMachine: throws when machine lacks _appName', async () => {
  let threw = false
  try {
    await destroyMachine({ id: 'mach-X' })
  } catch (err) {
    threw = true
    assert.match(err.message, /_appName/)
  }
  assert.equal(threw, true)
})

test('startMachine: routes to per-app /start endpoint', async () => {
  let hit = null
  await withFetchMock(async (url, init) => {
    hit = { url: String(url), method: init?.method }
    return ok({})
  }, () => startMachine({ id: 'mach-Y', _appName: DEDICATED }))
  assert.ok(hit.url.includes(`/apps/${DEDICATED}/machines/mach-Y/start`))
  assert.equal(hit.method, 'POST')
})

test('stopMachine: routes to per-app /stop endpoint', async () => {
  let hit = null
  await withFetchMock(async (url, init) => {
    hit = { url: String(url), method: init?.method }
    return ok({})
  }, () => stopMachine({ id: 'mach-Z', _appName: DEDICATED }))
  assert.ok(hit.url.includes(`/apps/${DEDICATED}/machines/mach-Z/stop`))
  assert.equal(hit.method, 'POST')
})

// ─── resolveDeployedImage: still reads from template/shared app ──────
test('resolveDeployedImage: pulls image from FLY_PREVIEW_APP_NAME (template app)', async () => {
  const calls = []
  const img = await withFetchMock(async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/auroraly-preview-runner/releases')) {
      return ok([
        { version: 5, image_ref: { registry: 'registry.fly.io', repository: 'auroraly-preview-runner', tag: 'deployment-NEW' } },
      ])
    }
    return ok([])
  }, () => resolveDeployedImage())
  assert.equal(img, 'registry.fly.io/auroraly-preview-runner:deployment-NEW')
  assert.ok(calls.some(c => c.includes('/auroraly-preview-runner/releases')), 'must hit template app releases endpoint')
  assert.ok(!calls.some(c => c.includes(DEDICATED)), 'must NOT hit per-project app')
})

// ─── isMachineImageStale (unchanged, smoke test) ─────────────────────
test('isMachineImageStale: same image → false', () => {
  assert.equal(
    isMachineImageStale({ config: { image: 'registry.fly.io/x:abc' } }, 'registry.fly.io/x:abc'),
    false
  )
})

test('isMachineImageStale: different image → true', () => {
  assert.equal(
    isMachineImageStale({ config: { image: 'registry.fly.io/x:OLD' } }, 'registry.fly.io/x:NEW'),
    true
  )
})

// ─── run ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0
for (const t of tests) {
  try {
    await t.fn()
    pass++
    console.log(`✓ ${t.name}`)
  } catch (err) {
    fail++
    console.error(`✗ ${t.name}\n  ${err?.stack || err}`)
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
