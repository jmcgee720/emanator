// ──────────────────────────────────────────────────────────────────────
// Unit tests for /app/lib/supabase/error-utils.js
//
// Regression for the Spyrals bug: Cloudflare 520 HTML was being dumped
// into JSON error responses, then rendered into the import UI.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { cleanSupabaseError, withRetry } from '../lib/supabase/error-utils.js'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── cleanSupabaseError ───────────────────────────────────────────────
test('cleans a Cloudflare 520 HTML error into a friendly message', () => {
  const err = new Error('<!DOCTYPE html><html><head><title>error 520</title></head><body><h1>Error 520</h1><p>cf-ray: abc</p></body></html>')
  const c = cleanSupabaseError(err)
  assert.match(c.message, /Supabase is temporarily unreachable/)
  assert.equal(c.transient, true)
  assert.equal(c.retryable, true)
  assert.equal(c.status, 520)
  assert.doesNotMatch(c.message, /<html|<body|cf-ray/i, 'must not leak HTML')
})

test('cleans a 521 error', () => {
  const err = { message: '<html>error 521 web server is down</html>' }
  const c = cleanSupabaseError(err)
  assert.match(c.message, /Supabase is offline/)
  assert.equal(c.status, 521)
  assert.equal(c.transient, true)
})

test('cleans a 504 timeout', () => {
  const err = { message: '<html>error 504 Gateway timeout</html>' }
  const c = cleanSupabaseError(err)
  assert.match(c.message, /timed out/i)
  assert.equal(c.transient, true)
})

test('treats fetch failed as transient network error', () => {
  const err = new Error('fetch failed: ECONNRESET')
  const c = cleanSupabaseError(err)
  assert.match(c.message, /Lost connection/)
  assert.equal(c.transient, true)
})

test('passes through a normal PostgREST error verbatim', () => {
  const err = { message: 'duplicate key value violates unique constraint "project_files_pkey"' }
  const c = cleanSupabaseError(err)
  assert.match(c.message, /duplicate key/)
  assert.equal(c.transient, false)
  assert.equal(c.retryable, false)
})

test('caps absurdly long error messages at 500 chars', () => {
  const err = { message: 'x'.repeat(2000) }
  const c = cleanSupabaseError(err)
  assert.ok(c.message.length <= 510, `got ${c.message.length}`)
})

test('handles null / undefined inputs without crashing', () => {
  assert.equal(cleanSupabaseError(null).message, 'Unknown error')
  assert.equal(cleanSupabaseError(undefined).message, 'Unknown error')
})

test('handles string-only errors', () => {
  const c = cleanSupabaseError('<html>error 520</html>')
  assert.match(c.message, /temporarily unreachable/)
})

// ─── withRetry ───────────────────────────────────────────────────────
test('withRetry: returns immediately on success', async () => {
  let n = 0
  const r = await withRetry(async () => { n++; return 'ok' })
  assert.equal(r, 'ok')
  assert.equal(n, 1)
})

test('withRetry: retries transient 520 errors and eventually succeeds', async () => {
  let n = 0
  const r = await withRetry(async () => {
    n++
    if (n < 3) throw new Error('<html>error 520 origin unreachable</html>')
    return 'ok'
  }, { baseDelayMs: 10 })
  assert.equal(r, 'ok')
  assert.equal(n, 3)
})

test('withRetry: does NOT retry non-transient errors', async () => {
  let n = 0
  await assert.rejects(() => withRetry(async () => {
    n++
    throw new Error('duplicate key')
  }, { baseDelayMs: 10 }), /duplicate key/)
  assert.equal(n, 1)
})

test('withRetry: throws clean message after exhausting retries', async () => {
  let n = 0
  await assert.rejects(() => withRetry(async () => {
    n++
    throw new Error('<html>error 520</html>')
  }, { retries: 2, baseDelayMs: 10, label: 'test' }), (err) => {
    assert.equal(err.transient, true)
    assert.equal(err.status, 520)
    assert.match(err.message, /\[test\]/)
    assert.match(err.message, /temporarily unreachable/)
    assert.doesNotMatch(err.message, /<html/i, 'must not leak HTML')
    return true
  })
  assert.equal(n, 3) // 1 initial + 2 retries
})

test('withRetry: respects custom retries count', async () => {
  let n = 0
  await assert.rejects(() => withRetry(async () => {
    n++
    throw new Error('fetch failed')
  }, { retries: 1, baseDelayMs: 5 }), /Lost connection/)
  assert.equal(n, 2)
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
