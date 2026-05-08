// ──────────────────────────────────────────────────────────────────────
// Test: tolerant JSON parser used by Phase 1/2/3 of the AI pipeline.
//
// Each test reproduces a failure mode we've actually seen in production
// (or one we want to guard against). Pinning these means a future LLM
// regression doesn't silently break the wizard.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { safeParseJson } from '../lib/ai/safe-json.js'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('strict valid JSON parses on first try', () => {
  const r = safeParseJson('{"a":1,"b":[1,2,3]}')
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { a: 1, b: [1, 2, 3] })
  assert.deepEqual(r.attempts, ['strict'])
})

test('strips ```json … ``` markdown fences', () => {
  const r = safeParseJson('```json\n{"hello":"world"}\n```')
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { hello: 'world' })
})

test('strips surrounding prose ("Here is your plan: { ... }")', () => {
  const r = safeParseJson('Here is your plan: {"archetype":"saas_tool"} Hope this helps!')
  assert.equal(r.ok, true)
  assert.equal(r.value.archetype, 'saas_tool')
})

test('strips // line comments leaked from few-shot examples', () => {
  // This is the exact pattern we saw in Phase 1 with the new fullstack
  // dataModel example: AI copied the // comments into its output.
  const raw = `{
    "archetype": "fullstack_app",
    "files": [
      "app/page.jsx" // the home page
    ]
  }`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.files, ['app/page.jsx'])
})

test('strips /* block comments */', () => {
  const raw = `{ /* TODO */ "a": 1 }`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.equal(r.value.a, 1)
})

test('does NOT strip "//" or "/*" inside string values', () => {
  // Protocol relative URL should survive the comment-stripper.
  const raw = `{"url": "https://example.com/path", "regex": "a/*b"}`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.equal(r.value.url, 'https://example.com/path')
  assert.equal(r.value.regex, 'a/*b')
})

test('drops trailing commas in objects and arrays', () => {
  const raw = `{ "a": [1, 2, 3,], "b": { "c": 1, }, }`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { a: [1, 2, 3], b: { c: 1 } })
})

test('auto-closes truncated arrays (the Nexsara plan failure mode)', () => {
  // Real failure: AI output ended at "line 123 column 8" mid-array
  // because max_tokens was exceeded. Closing braces never arrived.
  const raw = `{
    "archetype": "fullstack_app",
    "brand": { "name": "Nexsara", "tagline": "AI marketing copilot" },
    "sections": [
      { "id": "nav", "purpose": "site nav" },
      { "id": "hero", "purpose": "main pitch" }`
  // Note: above is intentionally NOT closed — no `]` and no `}`.
  const r = safeParseJson(raw)
  assert.equal(r.ok, true, `should auto-close, got: ${r.error?.message}`)
  assert.equal(r.value.archetype, 'fullstack_app')
  assert.equal(r.value.brand.name, 'Nexsara')
  assert.equal(r.value.sections.length, 2)
})

test('auto-closes truncated mid-object', () => {
  const raw = `{ "a": 1, "b": { "c": 2`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { a: 1, b: { c: 2 } })
})

test('auto-close + trailing comma combo (`{a:1,b:2,`)', () => {
  const raw = `{"a": 1, "b": 2,`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { a: 1, b: 2 })
})

test('normalizes smart quotes to straight quotes', () => {
  const raw = '\u201Carchetype\u201D: \u201Csaas_tool\u201D'
  // We need full JSON for this to parse. Test the helper indirectly:
  const r = safeParseJson(`{${raw}}`)
  assert.equal(r.ok, true)
  assert.equal(r.value.archetype, 'saas_tool')
})

test('salvages longest valid prefix when content after garbage', () => {
  const raw = `{"a":1, "b": [1,2]} GARBAGE TEXT AFTER`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { a: 1, b: [1, 2] })
})

test('rejects pure garbage with a useful error', () => {
  const r = safeParseJson('not json at all 🚫')
  assert.equal(r.ok, false)
  assert.ok(r.error.message.includes('failed'))
  assert.ok(Array.isArray(r.attempts))
  assert.ok(r.attempts.length > 1)
})

test('rejects empty string', () => {
  const r = safeParseJson('')
  assert.equal(r.ok, false)
  assert.match(r.error.message, /empty/)
})

test('handles string with escaped quotes correctly', () => {
  const raw = `{"quote": "She said \\"hi\\" to me"}`
  const r = safeParseJson(raw)
  assert.equal(r.ok, true)
  assert.equal(r.value.quote, 'She said "hi" to me')
})

test('large payload: 10,800 char fullstack plan with token-budget truncation', () => {
  // Reproduces the exact Nexsara failure: a long fullstack plan that
  // hits the token budget mid-imageManifest array.
  const sections = Array.from({ length: 10 }, (_, i) => `{ "id": "s${i}", "purpose": "purpose ${i} ${'x'.repeat(50)}" }`).join(',\n      ')
  const images = Array.from({ length: 10 }, (_, i) => `{ "role": "img${i}", "subject": "${'a'.repeat(80)}" }`).join(',\n      ')
  const raw = `{
    "archetype": "fullstack_app",
    "brand": { "name": "Test", "tagline": "x", "mood": "x", "audience": "x", "tone": "x" },
    "sections": [
      ${sections}
    ],
    "imageManifest": [
      ${images.slice(0, 600)}` // truncate mid-imageManifest array
  const r = safeParseJson(raw)
  assert.equal(r.ok, true, `should recover, got: ${r.error?.message}`)
  assert.equal(r.value.archetype, 'fullstack_app')
  assert.ok(Array.isArray(r.value.sections))
  assert.equal(r.value.sections.length, 10)
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
