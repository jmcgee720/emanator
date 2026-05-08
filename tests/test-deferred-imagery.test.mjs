// ──────────────────────────────────────────────────────────────────────
// Unit tests for Lever 2: deferred imagery in the phased pipeline.
//
// We can't easily run the real Phase 4 (it needs Gemini + Supabase),
// so we exercise the deferred short-circuit logic by stubbing the
// runtime context. The behavior we lock in:
//
//   • imageMode === 'defer' → returns { images: [], deferred: true }
//     WITHOUT calling Nano Banana / OpenAI / stock fallbacks.
//   • imageMode === 'full' (or undefined) → falls through to the normal
//     generation path (we don't run it in tests, just verify the branch).
//   • Empty manifest is handled before the deferred branch (no images
//     to defer in the first place).
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

// Drain an async generator and return { events, returnValue }
async function drain(gen) {
  const events = []
  let returnValue = null
  while (true) {
    const { value, done } = await gen.next()
    if (done) { returnValue = value; break }
    events.push(value)
  }
  return { events, returnValue }
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test("imageMode='defer' short-circuits before any provider call", async () => {
  const { runPhaseImages } = await import('../lib/ai/phased-pipeline/phase-4-images.js')
  // Spies — these throw if called. Confirms the deferred path bypasses them.
  const exploding = {
    generateImage: () => { throw new Error('SHOULD NOT BE CALLED in deferred mode') },
  }
  const { events, returnValue } = await drain(runPhaseImages({
    geminiProvider: exploding,
    openaiImageProvider: exploding,
    priorResults: {
      plan: { imageManifest: [
        { role: 'hero', subject: 'a coffee shop' },
        { role: 'feature_1', subject: 'a barista pouring' },
      ] },
      design_tokens: { tokens: { imageryTreatment: 'photographic_warm' } },
    },
    attachments: [],
    imageMode: 'defer',
  }))
  assert.equal(returnValue.deferred, true, 'flag is set so orchestrator can stamp project settings')
  assert.deepEqual(returnValue.images, [], 'no images returned (Phase 5 falls back to placeholders)')
  // We expect exactly one "status" event explaining the skip — never an
  // images_ready event (that would imply we actually generated something).
  const statuses = events.filter(e => e.event === 'status')
  const ready = events.filter(e => e.event === 'images_ready')
  assert.equal(statuses.length, 1, 'one status event explaining the skip')
  assert.equal(ready.length, 0, 'no images_ready event in deferred mode')
})

test('empty imageManifest returns immediately (no deferred flag needed)', async () => {
  const { runPhaseImages } = await import('../lib/ai/phased-pipeline/phase-4-images.js')
  const { returnValue } = await drain(runPhaseImages({
    priorResults: { plan: { imageManifest: [] }, design_tokens: { tokens: {} } },
    attachments: [],
    imageMode: 'defer',
  }))
  assert.deepEqual(returnValue.images, [])
  // deferred not set — there was nothing to defer.
  assert.notEqual(returnValue.deferred, true)
})

test("imageMode='full' falls through (no early return on the defer branch)", async () => {
  // We don't run real generation here — we just verify the deferred
  // branch is NOT taken. Implementation detail: with no providers and an
  // empty manifest, we'd still get an early-return on manifest. Use a
  // populated manifest + no providers + check that we DIDN'T return the
  // deferred sentinel.
  const { runPhaseImages } = await import('../lib/ai/phased-pipeline/phase-4-images.js')
  const { returnValue } = await drain(runPhaseImages({
    priorResults: {
      plan: { imageManifest: [{ role: 'hero', subject: 'a coffee shop' }] },
      design_tokens: { tokens: {} },
    },
    attachments: [],
    imageMode: 'full',
  }))
  assert.notEqual(returnValue.deferred, true,
    'full mode does NOT return the deferred sentinel even when fallbacks fail')
})

test("imageMode undefined (legacy callers) does NOT trigger defer", async () => {
  const { runPhaseImages } = await import('../lib/ai/phased-pipeline/phase-4-images.js')
  const { returnValue } = await drain(runPhaseImages({
    priorResults: {
      plan: { imageManifest: [{ role: 'hero', subject: 'a coffee shop' }] },
      design_tokens: { tokens: {} },
    },
    attachments: [],
    // imageMode omitted — backward compat with build-steps.js callers.
  }))
  assert.notEqual(returnValue.deferred, true,
    'omitting imageMode preserves the original full-generation behavior')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
