// ──────────────────────────────────────────────────────────────────────
// Self-edit watchdog — unit tests
// ──────────────────────────────────────────────────────────────────────
// The watchdog is the safety-of-last-resort: if Core System commits
// something that builds successfully but breaks the deploy at runtime,
// this is what force-reverts main back to a known-good SHA.
//
// We exercise the public API with stubbed fetch so no real GitHub /
// Vercel calls happen. The internal POST_DEPLOY_INITIAL_WAIT_MS is too
// long to wait in unit tests, so we monkey-patch global fetch and pass
// healthUrl='inline-test://...' which our stubbed fetch resolves
// synchronously.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureBeforeSha, scheduleHealthCheck } from '../lib/ai/self-edit-watchdog.js'

const REAL_FETCH = globalThis.fetch

function buildFakeFetch({ branchHeadShas, healthResults, patchResult, onPatch }) {
  // branchHeadShas is an array consumed in order on each /git/ref/heads call.
  // healthResults is an array consumed in order on each healthUrl call.
  let refCallCount = 0
  let healthCallCount = 0
  let patchCallCount = 0
  return async function fakeFetch(url, opts) {
    if (typeof url === 'string' && url.includes('/git/ref/heads/')) {
      const sha = branchHeadShas[Math.min(refCallCount, branchHeadShas.length - 1)]
      refCallCount += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({ object: { sha } }),
        text: async () => '',
      }
    }
    if (typeof url === 'string' && url.includes('/git/refs/heads/') && opts?.method === 'PATCH') {
      patchCallCount += 1
      if (onPatch) onPatch(JSON.parse(opts.body))
      if (patchResult === 'fail') {
        return { ok: false, status: 422, text: async () => 'ref moved' }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: JSON.parse(opts.body).sha } }),
        text: async () => '',
      }
    }
    if (typeof url === 'string' && url.startsWith('inline-test://health')) {
      const r = healthResults[Math.min(healthCallCount, healthResults.length - 1)]
      healthCallCount += 1
      if (r === 'throw') throw new Error('network down')
      return { ok: r < 400, status: r, text: async () => `status ${r}` }
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }
}

function patchFetch(fn) {
  globalThis.fetch = fn
}
function restoreFetch() {
  globalThis.fetch = REAL_FETCH
}

test('captureBeforeSha: returns null when GITHUB_TOKEN missing', async () => {
  const saved = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  try {
    const sha = await captureBeforeSha({ repo: 'jmcgee720/emanator', branch: 'main' })
    assert.equal(sha, null)
  } finally {
    if (saved) process.env.GITHUB_TOKEN = saved
  }
})

test('captureBeforeSha: returns the SHA from GitHub on success', async () => {
  patchFetch(buildFakeFetch({ branchHeadShas: ['abcdef1234567'], healthResults: [], patchResult: 'ok' }))
  try {
    const sha = await captureBeforeSha({ repo: 'fake/repo', branch: 'main', token: 'fake-token' })
    assert.equal(sha, 'abcdef1234567')
  } finally {
    restoreFetch()
  }
})

test('scheduleHealthCheck: skips when no beforeSha was captured', async () => {
  const events = []
  const out = await scheduleHealthCheck({
    repo: 'fake/repo',
    beforeSha: null,
    healthUrl: 'inline-test://health',
    token: 'fake-token',
    onStatus: (e) => events.push(e),
  })
  assert.deepEqual(out, { skipped: true })
  assert.ok(events.find((e) => e.stage === 'watchdog_skipped'))
})

test('scheduleHealthCheck: skips when no commits happened (HEAD unchanged)', async () => {
  patchFetch(buildFakeFetch({
    branchHeadShas: ['samesha123'], // after-SHA == before-SHA → no commits
    healthResults: [],
    patchResult: 'ok',
  }))
  try {
    const events = []
    const out = await scheduleHealthCheck({
      repo: 'fake/repo',
      beforeSha: 'samesha123',
      healthUrl: 'inline-test://health',
      token: 'fake-token',
      onStatus: (e) => events.push(e),
    })
    assert.equal(out.skipped, true)
    assert.ok(events.find((e) => e.stage === 'watchdog_skipped' && /no commits/i.test(e.reason || '')))
  } finally {
    restoreFetch()
  }
})

// The remaining tests exercise the polling loop, which sleeps real time
// (45s initial + N×5s poll). We monkey-patch setTimeout to no-op so the
// whole test completes in milliseconds.
function silenceTimeouts(t) {
  const realSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 0 }
  t.after(() => { global.setTimeout = realSetTimeout })
}

test('scheduleHealthCheck: HEAD changed + healthy probe → no revert', async (t) => {
  silenceTimeouts(t)
  patchFetch(buildFakeFetch({
    branchHeadShas: ['NEW_SHA'],   // after-SHA different = commits happened
    healthResults: [200],          // first probe healthy
    patchResult: 'ok',
  }))
  try {
    const events = []
    const out = await scheduleHealthCheck({
      repo: 'fake/repo',
      beforeSha: 'BEFORE_SHA',
      healthUrl: 'inline-test://health',
      token: 'fake-token',
      onStatus: (e) => events.push(e),
    })
    assert.equal(out.reverted, false)
    assert.equal(out.healthy, true)
    assert.ok(events.find((e) => e.stage === 'watchdog_armed'))
    assert.ok(events.find((e) => e.stage === 'watchdog_healthy'))
    assert.ok(!events.find((e) => e.stage === 'watchdog_reverted'))
  } finally {
    restoreFetch()
  }
})

test('scheduleHealthCheck: HEAD changed + 3 consecutive 500s → auto-revert', async (t) => {
  silenceTimeouts(t)
  let patchPayload = null
  patchFetch(buildFakeFetch({
    // Sequence: capture after-SHA (1), then re-check before revert (2)
    branchHeadShas: ['NEW_SHA', 'NEW_SHA'],
    healthResults: [500, 503, 502, 200],
    patchResult: 'ok',
    onPatch: (b) => { patchPayload = b },
  }))
  try {
    const events = []
    const out = await scheduleHealthCheck({
      repo: 'fake/repo',
      beforeSha: 'BEFORE_SHA',
      healthUrl: 'inline-test://health',
      token: 'fake-token',
      onStatus: (e) => events.push(e),
    })
    assert.equal(out.reverted, true, 'must revert after 3 consecutive 5xx')
    assert.deepEqual(patchPayload, { sha: 'BEFORE_SHA', force: true })
    assert.ok(events.find((e) => e.stage === 'watchdog_unhealthy_triggered_revert'))
    assert.ok(events.find((e) => e.stage === 'watchdog_reverted'))
  } finally {
    restoreFetch()
  }
})

test('scheduleHealthCheck: refuses to revert if a newer commit landed since the bad one', async (t) => {
  silenceTimeouts(t)
  patchFetch(buildFakeFetch({
    // Initial after-SHA = BAD_SHA, then before revert check returns NEWER_SHA
    // → user already pushed a fix → watchdog must NOT force-revert over it.
    branchHeadShas: ['BAD_SHA', 'NEWER_SHA'],
    healthResults: [500, 500, 500],
    patchResult: 'ok',
  }))
  try {
    const events = []
    const out = await scheduleHealthCheck({
      repo: 'fake/repo',
      beforeSha: 'BEFORE_SHA',
      healthUrl: 'inline-test://health',
      token: 'fake-token',
      onStatus: (e) => events.push(e),
    })
    assert.equal(out.reverted, false)
    assert.equal(out.reason, 'HEAD moved')
    assert.ok(events.find((e) => e.stage === 'watchdog_revert_aborted'))
  } finally {
    restoreFetch()
  }
})
