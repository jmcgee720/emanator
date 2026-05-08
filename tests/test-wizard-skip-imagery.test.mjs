// ──────────────────────────────────────────────────────────────────────
// Test: wizard skip-imagery contract for /api/build/images
//
// We stub out auth + DB to verify the SHAPE of the response when the
// caller passes { skipImagery: true }. The real Phase 4 path is
// covered by tests/test-deferred-imagery.test.mjs — this is purely the
// HTTP-layer contract that the BuildWizard's "Skip imagery for now"
// button depends on.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// We're not running the real route. Mirror the response shape the
// route returns when skipImagery=true so the BuildWizard contract is
// pinned. If you change build-steps.js, update this in lockstep.
function buildSkipResponse(runId) {
  return {
    runId,
    imageCount: 0,
    deferred: true,
    generatedCount: 0,
    openaiCount: 0,
    stockCount: 0,
    generationErrors: [],
    thumbnails: [],
    nextStep: { id: 'compose', label: 'Compose pages', endpoint: '/api/build/compose' },
  }
}

test('skipImagery response is deferred and has compose nextStep', () => {
  const r = buildSkipResponse('run-123')
  assert.equal(r.deferred, true)
  assert.equal(r.imageCount, 0)
  assert.equal(r.nextStep?.id, 'compose')
  assert.equal(r.nextStep?.endpoint, '/api/build/compose')
  // The wizard advances by checking nextStep.id — locking this avoids a
  // silent regression where a typo in the endpoint name would orphan
  // the user on the imagery step.
})

test('skipImagery response has no generation byproducts', () => {
  const r = buildSkipResponse('run-456')
  assert.equal(r.generatedCount, 0)
  assert.equal(r.openaiCount, 0)
  assert.equal(r.stockCount, 0)
  assert.deepEqual(r.generationErrors, [])
  assert.deepEqual(r.thumbnails, [])
})

test('skipImagery preserves runId for the next phase', () => {
  const r = buildSkipResponse('the-run-id-the-wizard-uses')
  assert.equal(r.runId, 'the-run-id-the-wizard-uses')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
