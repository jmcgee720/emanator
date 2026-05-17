// Test the 529 / overloaded retry logic in phase-5-compose.
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const target = resolve(__dirname, '../lib/ai/phased-pipeline/phase-5-compose.js')
const src = readFileSync(target, 'utf8')

assert.ok(src.includes('function isOverloadedError'), 'isOverloadedError must exist')
assert.ok(src.includes('function withOverloadedRetry'), 'withOverloadedRetry must exist')
assert.ok(src.includes('withOverloadedRetry'), 'compose must call withOverloadedRetry')

function extractFn(name) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\b[\\s\\S]*?\\n\\}\\n`))
  if (!m) throw new Error(`could not extract ${name}`)
  return m[0]
}
const helperSrc = `${extractFn('isOverloadedError')}\n${extractFn('withOverloadedRetry')}\nreturn { isOverloadedError, withOverloadedRetry }`
const { isOverloadedError, withOverloadedRetry } = new Function(helperSrc)()

// ── isOverloadedError detection ──
assert.equal(isOverloadedError({ status: 529 }), true, '529 status → overloaded')
assert.equal(isOverloadedError({ statusCode: 503 }), true, '503 → overloaded')
assert.equal(isOverloadedError({ message: 'Anthropic 529 overloaded_error' }), true, 'message-text match')
assert.equal(isOverloadedError({ message: 'overloaded' }), true, 'message overloaded')
assert.equal(isOverloadedError({ status: 400 }), false, '400 is not overloaded')
assert.equal(isOverloadedError({ message: 'bad tool args' }), false, 'parse error not overloaded')
assert.equal(isOverloadedError(null), false, 'null safe')

// ── withOverloadedRetry: succeeds after 529s ──
{
  let calls = 0
  const fn = async () => {
    calls++
    if (calls < 3) throw Object.assign(new Error('overloaded'), { status: 529 })
    return 'ok'
  }
  const t0 = Date.now()
  const result = await withOverloadedRetry(fn, 'test', 5)
  const elapsed = Date.now() - t0
  assert.equal(result, 'ok')
  assert.equal(calls, 3, 'should retry until success')
  // After 2 retries: 1s + 2s = ~3s minimum (plus jitter)
  assert.ok(elapsed >= 2500, `expected >=2500ms backoff, got ${elapsed}ms`)
}

// ── withOverloadedRetry: short-circuits on non-overloaded errors ──
{
  let calls = 0
  const fn = async () => {
    calls++
    throw new Error('parse failure')
  }
  let caught = null
  try { await withOverloadedRetry(fn, 'test', 5) } catch (e) { caught = e }
  assert.ok(caught, 'should rethrow')
  assert.equal(calls, 1, 'should NOT retry on parse errors')
}

// ── withOverloadedRetry: bounded retries ──
{
  let calls = 0
  const fn = async () => {
    calls++
    throw Object.assign(new Error('overloaded'), { status: 529 })
  }
  let caught = null
  try { await withOverloadedRetry(fn, 'test', 2) } catch (e) { caught = e }
  assert.ok(caught, 'should give up after maxRetries')
  assert.equal(calls, 3, 'maxRetries=2 → 1 initial + 2 retries = 3 calls')
}

console.log('PASS: phase-5-compose 529 retry logic works for success, bounded retries, and non-overloaded short-circuit')
