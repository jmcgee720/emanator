// ──────────────────────────────────────────────────────────────────────
// Unit tests for /app/lib/fly/apps.js
//
// The One-App-Per-Project refactor depends on:
//   1) previewAppName() being deterministic + DNS-safe + ≤30 chars
//   2) ensurePreviewApp() being idempotent under races (existing app,
//      422 "taken", 409 etc all collapse to "ok, return the name")
//   3) previewAppPublicUrl() returning the deterministic .fly.dev URL
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

process.env.FLY_API_TOKEN = 'fake-token-for-tests'
process.env.FLY_ORG_SLUG = 'auroraly'

const { previewAppName, ensurePreviewApp, previewAppPublicUrl, destroyPreviewApp } =
  await import('../lib/fly/apps.js')

let realFetch
function withFetchMock(mock, fn) {
  realFetch = globalThis.fetch
  globalThis.fetch = mock
  return fn().finally(() => { globalThis.fetch = realFetch })
}
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Mock that handles both Machines REST API + GraphQL IP allocation endpoint.
// Pass a `machinesHandler` that handles only the REST machine API calls;
// GraphQL alloc calls are auto-stubbed to a successful response.
function makeMock(machinesHandler) {
  return async (url, init) => {
    const u = String(url)
    if (u.includes('api.fly.io/graphql')) {
      // Default: return success for shared_v4/v6 alloc.
      return ok({ data: { allocateIpAddress: { ipAddress: { address: '66.241.124.5', type: 'shared_v4' } } } })
    }
    return machinesHandler(url, init)
  }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── previewAppName ──────────────────────────────────────────────────
test('previewAppName: deterministic for same projectId', () => {
  const a = previewAppName('e5e4f1f4-3b5e-4c55-b2dc-655f483ef3e0')
  const b = previewAppName('e5e4f1f4-3b5e-4c55-b2dc-655f483ef3e0')
  assert.equal(a, b)
})

test('previewAppName: different projects → different names', () => {
  const a = previewAppName('e5e4f1f4-3b5e-4c55-b2dc-655f483ef3e0')
  const b = previewAppName('c7cbb299-a688-4dd8-b846-8b82edba9ac9')
  assert.notEqual(a, b)
})

test('previewAppName: respects Fly 30-char limit', () => {
  // Long, ugly projectIds shouldn't blow the limit.
  const huge = 'a'.repeat(200)
  const name = previewAppName(huge)
  assert.ok(name.length <= 30, `expected ≤30 chars, got ${name.length}: ${name}`)
})

test('previewAppName: starts with a letter (DNS-safe)', () => {
  const name = previewAppName('99999999-9999-9999-9999-999999999999')
  assert.match(name[0], /[a-z]/, `must start with letter, got: ${name}`)
})

test('previewAppName: only lowercase alphanumerics + dashes', () => {
  const name = previewAppName('My_Project!! @WeirdInput')
  assert.match(name, /^[a-z][a-z0-9-]+$/, `not DNS-safe: ${name}`)
})

test('previewAppName: throws on empty input', () => {
  assert.throws(() => previewAppName(''), /projectId/)
  assert.throws(() => previewAppName(null), /projectId/)
  assert.throws(() => previewAppName(undefined), /projectId/)
})

// ─── previewAppPublicUrl ─────────────────────────────────────────────
test('previewAppPublicUrl: <app>.fly.dev, no machineId, no path', () => {
  const url = previewAppPublicUrl('e5e4f1f4-3b5e-4c55-b2dc-655f483ef3e0')
  assert.match(url, /^https:\/\/auroraly-prv-[a-f0-9]{16}\.fly\.dev$/)
})

// ─── ensurePreviewApp: idempotency under all race outcomes ───────────
test('ensurePreviewApp: returns name when app already exists (GET 200) and re-ensures IPs', async () => {
  const calls = []
  let graphqlCalled = false
  const name = await withFetchMock(async (url, init) => {
    const u = String(url)
    if (u.includes('api.fly.io/graphql')) {
      graphqlCalled = true
      return ok({ data: { allocateIpAddress: { ipAddress: { address: '66.241.124.5', type: 'shared_v4' } } } })
    }
    calls.push({ url: u, method: init?.method || 'GET' })
    if (!init?.method || init.method === 'GET') return ok({ name: 'whatever' })
    throw new Error('should not POST to /apps when GET succeeds')
  }, () => ensurePreviewApp('proj-1'))
  assert.equal(name, previewAppName('proj-1'))
  assert.equal(calls.length, 1, 'only the GET probe should hit /apps')
  assert.equal(calls[0].method, 'GET')
  assert.equal(graphqlCalled, true, 'must ensure IPs are allocated even for pre-existing apps')
})

test('ensurePreviewApp: creates app on cold start (GET 404 → POST 201) AND allocates IPs', async () => {
  const calls = []
  const graphqlInputs = []
  const name = await withFetchMock(async (url, init) => {
    const u = String(url)
    if (u.includes('api.fly.io/graphql')) {
      const body = JSON.parse(init.body)
      graphqlInputs.push(body.variables.input)
      return ok({ data: { allocateIpAddress: { ipAddress: { address: 'shared', type: body.variables.input.type } } } })
    }
    calls.push({ url: u, method: init?.method || 'GET' })
    if (!init?.method || init.method === 'GET') return ok({ error: 'not found' }, 404)
    if (init.method === 'POST') return ok({ name: 'whatever' }, 201)
    throw new Error('unexpected method')
  }, () => ensurePreviewApp('proj-2'))
  assert.equal(name, previewAppName('proj-2'))
  assert.equal(calls.length, 2)
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[1].method, 'POST')
  assert.equal(graphqlInputs.length, 2, 'must allocate both shared_v4 and v6')
  assert.deepEqual(graphqlInputs.map(i => i.type).sort(), ['shared_v4', 'v6'])
  assert.equal(graphqlInputs[0].appId, name, 'GraphQL call must reference the new app name')
})

test('ensurePreviewApp: handles "name taken" race (POST 422) and still allocates IPs', async () => {
  let graphqlCalls = 0
  const name = await withFetchMock(makeMock(async (url, init) => {
    if (!init?.method || init.method === 'GET') return ok({}, 404)
    if (init.method === 'POST') return ok({ error: 'name has already been taken' }, 422)
    throw new Error('unexpected')
  }), () => ensurePreviewApp('proj-3'))
  assert.equal(name, previewAppName('proj-3'))
})

test('ensurePreviewApp: handles 409 conflict (race variant)', async () => {
  const name = await withFetchMock(makeMock(async (url, init) => {
    if (!init?.method || init.method === 'GET') return ok({}, 404)
    if (init.method === 'POST') return ok({ error: 'conflict' }, 409)
    throw new Error('unexpected')
  }), () => ensurePreviewApp('proj-4'))
  assert.equal(name, previewAppName('proj-4'))
})

test('ensurePreviewApp: throws on real 500 errors', async () => {
  let threw = false
  try {
    await withFetchMock(makeMock(async (url, init) => {
      if (!init?.method || init.method === 'GET') return ok({}, 404)
      if (init.method === 'POST') return ok({ error: 'fly is on fire' }, 500)
      throw new Error('unexpected')
    }), () => ensurePreviewApp('proj-5'))
  } catch (err) {
    threw = true
    assert.match(err.message, /ensurePreviewApp/, 'should mention the function')
  }
  assert.equal(threw, true, 'expected throw on 500')
})

test('ensurePreviewApp: IP-alloc GraphQL "already allocated" is benign (idempotent)', async () => {
  // Migrating-back case: app was created previously but never had IPs
  // assigned. On next ensure, GraphQL returns errors:[{message:"...already allocated..."}]
  // — we MUST swallow this and treat the app as ready.
  const name = await withFetchMock(async (url) => {
    const u = String(url)
    if (u.includes('api.fly.io/graphql')) {
      return ok({ data: null, errors: [{ message: 'shared_v4 already allocated to app' }] })
    }
    // App already exists.
    return ok({ name: 'preexisting' })
  }, () => ensurePreviewApp('proj-already-has-ip'))
  assert.equal(name, previewAppName('proj-already-has-ip'))
})

test('ensurePreviewApp: IP-alloc GraphQL hard error is logged but does not fail the start path', async () => {
  // Network blip during IP alloc shouldn't block the whole preview start.
  // We log and continue — the GET probe on the next /start call will
  // re-attempt the alloc.
  const name = await withFetchMock(async (url) => {
    if (String(url).includes('api.fly.io/graphql')) {
      return new Response('Bad gateway', { status: 502 })
    }
    return ok({ name: 'preexisting' })
  }, () => ensurePreviewApp('proj-flaky-alloc'))
  assert.equal(name, previewAppName('proj-flaky-alloc'))
})

// ─── destroyPreviewApp ───────────────────────────────────────────────
test('destroyPreviewApp: idempotent — 404 means already gone', async () => {
  const result = await withFetchMock(async () => ok({}, 404), () => destroyPreviewApp('proj-6'))
  assert.equal(result.ok, true)
  assert.equal(result.deleted, false)
})

test('destroyPreviewApp: returns deleted:true on 200', async () => {
  const result = await withFetchMock(async () => ok({}, 200), () => destroyPreviewApp('proj-7'))
  assert.equal(result.ok, true)
  assert.equal(result.deleted, true)
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
