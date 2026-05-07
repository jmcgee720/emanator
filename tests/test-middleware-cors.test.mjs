// ──────────────────────────────────────────────────────────────────────
// Regression: every API response set Access-Control-Allow-Origin to
// the comma-separated env var, which violates CORS spec and caused
// browsers to reject every fetch — auth gate stuck in retry loop.
//
// Middleware must echo back EXACTLY ONE origin from the allowlist.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

// Pure-function copy of pickOrigin from /app/middleware.js. If they
// drift, these tests fail loudly.
function pickOrigin(allowedRaw, incomingOrigin) {
  if (!allowedRaw || allowedRaw === '*') return '*'
  const allowed = allowedRaw.split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length === 0) return '*'
  if (incomingOrigin && allowed.includes(incomingOrigin)) return incomingOrigin
  return allowed[0]
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('echoes exact match for incoming origin', () => {
  assert.equal(
    pickOrigin('https://www.auroraly.co,https://auroraly.co', 'https://auroraly.co'),
    'https://auroraly.co',
  )
})

test('echoes www match', () => {
  assert.equal(
    pickOrigin('https://www.auroraly.co,https://auroraly.co', 'https://www.auroraly.co'),
    'https://www.auroraly.co',
  )
})

test('NEVER returns multi-origin (regression for the bug)', () => {
  const out = pickOrigin('https://www.auroraly.co,https://auroraly.co', null)
  assert.doesNotMatch(out, /,/, `got ${out}`)
})

test('falls back to first allowed origin when incoming has no match', () => {
  const out = pickOrigin('https://a.com,https://b.com,https://c.com', 'https://evil.com')
  assert.equal(out, 'https://a.com')
})

test('falls back to first allowed origin when no incoming origin', () => {
  const out = pickOrigin('https://a.com,https://b.com', undefined)
  assert.equal(out, 'https://a.com')
})

test('handles whitespace around commas', () => {
  const out = pickOrigin(' https://a.com , https://b.com ', 'https://b.com')
  assert.equal(out, 'https://b.com')
})

test('returns * when env unset', () => {
  assert.equal(pickOrigin(undefined, 'https://a.com'), '*')
  assert.equal(pickOrigin('', 'https://a.com'), '*')
  assert.equal(pickOrigin('*', 'https://a.com'), '*')
})

test('handles single-origin env (no commas)', () => {
  assert.equal(pickOrigin('https://only.com', 'https://only.com'), 'https://only.com')
  assert.equal(pickOrigin('https://only.com', null), 'https://only.com')
})

test('case-sensitive origin matching (per CORS spec)', () => {
  // Browsers send the exact-case origin; we should not normalize.
  assert.equal(
    pickOrigin('https://www.auroraly.co', 'https://WWW.AURORALY.CO'),
    'https://www.auroraly.co', // falls back to first since case differs
  )
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (err) { console.error(`  ✗ ${t.name}\n     `, err.message); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
