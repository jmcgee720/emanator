// ──────────────────────────────────────────────────────────────────────
// Unit tests for /app/lib/fly/machines.js
//
// These DO NOT hit Fly's real API. We monkey-patch `globalThis.fetch`
// to simulate the responses we discovered during live debugging:
//   1) `:latest` tag doesn't exist after deploy — must fall back to
//      reusing a deployed machine's image (regression for `manifest unknown`).
//   2) `/wait?timeout=X` rejects X > 60 — must clamp + loop (regression
//      for `value must be inside range [1s, 1m0s]`).
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

// We import the module fresh each test so env reads pick up the
// fake creds we set below.
process.env.FLY_API_TOKEN = 'fake-token-for-tests'
process.env.FLY_PREVIEW_APP_NAME = 'auroraly-preview-runner'
process.env.FLY_REGION = 'iad'

let realFetch
function withFetchMock(mock, fn) {
  realFetch = globalThis.fetch
  globalThis.fetch = mock
  return fn().finally(() => { globalThis.fetch = realFetch })
}

function ok(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function err(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── 1) resolveDeployedImage prefers releases API, then template machine ─
test('resolveDeployedImage: returns image from releases API (preferred)', async () => {
  const fly = await import('../lib/fly/machines.js')
  const calls = []
  await withFetchMock(async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/releases')) {
      return ok([
        { version: 5, image_ref: { registry: 'registry.fly.io', repository: 'auroraly-preview-runner', tag: 'deployment-NEW' } },
        { version: 4, image_ref: { registry: 'registry.fly.io', repository: 'auroraly-preview-runner', tag: 'deployment-OLD' } },
      ])
    }
    if (String(url).endsWith('/machines')) return ok([])
    throw new Error('unexpected fetch ' + url)
  }, async () => {
    const img = await fly.resolveDeployedImage()
    assert.equal(img, 'registry.fly.io/auroraly-preview-runner:deployment-NEW')
  })
  assert.ok(calls.some(u => u.endsWith('/releases')), 'releases API must be checked first')
})

test('resolveDeployedImage: falls back to template machine when releases unavailable', async () => {
  const fly = await import('../lib/fly/machines.js')
  await withFetchMock(async (url) => {
    if (String(url).endsWith('/releases')) return err({ error: 'unavailable' }, 500)
    if (String(url).endsWith('/machines')) {
      return ok([
        // Project machine (stale — should be skipped).
        { id: 'proj1', config: { image: 'registry.fly.io/x:STALE', metadata: { auroraly_project_id: 'p1' } } },
        // Template machine (no project tag — preferred fallback).
        { id: 'tmpl', config: { image: 'registry.fly.io/x:LIVE' } },
      ])
    }
    throw new Error('unexpected ' + url)
  }, async () => {
    const img = await fly.resolveDeployedImage()
    assert.equal(img, 'registry.fly.io/x:LIVE', 'must prefer template (no project tag) over stale project machine')
  })
})

test('resolveDeployedImage: falls back to any machine image as last resort', async () => {
  const fly = await import('../lib/fly/machines.js')
  await withFetchMock(async (url) => {
    if (String(url).endsWith('/releases')) return err({ error: 'fail' }, 500)
    if (String(url).endsWith('/machines')) {
      return ok([{ id: 'any', config: { image: 'registry.fly.io/x:any', metadata: { auroraly_project_id: 'p1' } } }])
    }
    throw new Error('unexpected ' + url)
  }, async () => {
    const img = await fly.resolveDeployedImage()
    assert.equal(img, 'registry.fly.io/x:any')
  })
})

test('resolveDeployedImage: throws clearly when nothing deployed', async () => {
  const fly = await import('../lib/fly/machines.js')
  await withFetchMock(async (url) => {
    if (String(url).endsWith('/releases')) return err({ error: 'fail' }, 500)
    if (String(url).endsWith('/machines')) return ok([])
    throw new Error('unexpected ' + url)
  }, async () => {
    await assert.rejects(() => fly.resolveDeployedImage(), /no deployed image found/i)
  })
})

// ─── 2) waitForMachineState clamps the per-call timeout to 60s ───────
test('waitForMachineState: clamps timeout to 60s per call', async () => {
  const fly = await import('../lib/fly/machines.js')
  const seen = []
  await withFetchMock(async (url) => {
    seen.push(String(url))
    return ok({ ok: true, state: 'started' })
  }, async () => {
    await fly.waitForMachineState('m1', 'started', 90_000)
  })
  // Should never request a timeout > 60.
  for (const u of seen) {
    const m = u.match(/timeout=(\d+)/)
    assert.ok(m, 'wait URL must include timeout param')
    assert.ok(+m[1] <= 60, `timeout must be <=60, got ${m[1]} in ${u}`)
  }
})

test('waitForMachineState: loops until state reached if first call times out', async () => {
  const fly = await import('../lib/fly/machines.js')
  let n = 0
  await withFetchMock(async () => {
    n++
    if (n === 1) return ok({ ok: false }) // not yet started
    return ok({ ok: true, state: 'started' })
  }, async () => {
    const r = await fly.waitForMachineState('m1', 'started', 90_000)
    assert.equal(r.ok, true)
  })
  assert.ok(n >= 2, 'should retry until ok=true')
})

// ─── 3) createMachineForProject sends the resolved image, not :latest ─
test('createMachineForProject: uses resolved image (regression for :latest)', async () => {
  const fly = await import('../lib/fly/machines.js')
  let postBody
  await withFetchMock(async (url, init) => {
    if (init?.method === 'POST' && String(url).endsWith('/machines')) {
      postBody = JSON.parse(init.body)
      return ok({ id: 'new-machine', state: 'created' })
    }
    if (String(url).endsWith('/releases')) {
      return ok([{ version: 1, image_ref: { registry: 'registry.fly.io', repository: 'auroraly-preview-runner', tag: 'deployment-LIVE' } }])
    }
    if (String(url).endsWith('/machines')) {
      return ok([{ id: 'tmpl', config: { image: 'registry.fly.io/auroraly-preview-runner:deployment-OLD' } }])
    }
    throw new Error('unexpected ' + url)
  }, async () => {
    const m = await fly.createMachineForProject('proj-123', 'shared-secret')
    assert.equal(m.id, 'new-machine')
  })
  assert.equal(postBody.config.image, 'registry.fly.io/auroraly-preview-runner:deployment-LIVE')
  assert.notEqual(postBody.config.image, 'registry.fly.io/auroraly-preview-runner:latest')
  assert.equal(postBody.config.metadata.auroraly_project_id, 'proj-123')
  assert.equal(postBody.config.env.AURORALY_PROJECT_ID, 'proj-123')
  assert.equal(postBody.config.env.RUNNER_SHARED_SECRET, 'shared-secret')
})

// ─── 4) publicDevUrl uses PREVIEW_BASE_DOMAIN ───────────────────────
test('publicDevUrl: assembles wildcard subdomain', async () => {
  process.env.PREVIEW_BASE_DOMAIN = 'preview.auroraly.co'
  const fly = await import('../lib/fly/machines.js')
  assert.equal(fly.publicDevUrl('proj-xyz'), 'https://proj-xyz.preview.auroraly.co')
})

test('publicDevUrl: embeds machineId for single-hop fly-replay', async () => {
  process.env.PREVIEW_BASE_DOMAIN = 'preview.auroraly.co'
  const fly = await import('../lib/fly/machines.js')
  // When the orchestrator knows which Fly machine serves this project,
  // it passes the machineId so the runner's :3000 proxy can emit
  // `fly-replay: instance=<machineId>` (single-hop) instead of the
  // multi-hop `elsewhere=true` fallback.
  assert.equal(
    fly.publicDevUrl('proj-xyz', 'mach-abc'),
    'https://proj-xyz--mach-abc.preview.auroraly.co',
  )
  // Falsy machineId → plain subdomain (orchestrator's GET poll path
  // before the machine is known).
  assert.equal(fly.publicDevUrl('proj-xyz', ''), 'https://proj-xyz.preview.auroraly.co')
  assert.equal(fly.publicDevUrl('proj-xyz', undefined), 'https://proj-xyz.preview.auroraly.co')
})

test('machineControlUrl: uses Fly-Force-Instance-Id header for routing', async () => {
  const fly = await import('../lib/fly/machines.js')
  const { url, headers } = fly.machineControlUrl('mach-abc')
  assert.equal(url, 'https://auroraly-preview-runner.fly.dev:8443')
  assert.equal(headers['Fly-Force-Instance-Id'], 'mach-abc')
})

// ─── runner ──────────────────────────────────────────────────────────
let pass = 0, fail = 0
for (const t of tests) {
  try {
    await t.fn()
    console.log(`  ✓ ${t.name}`)
    pass++
  } catch (err) {
    console.error(`  ✗ ${t.name}`)
    console.error('     ', err.message)
    fail++
  }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
