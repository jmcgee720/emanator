// ──────────────────────────────────────────────────────────────────────
// Tests: Fly machine staleness detection + Vercel timeout fix.
//
// Pins the contract that any machine spawned BEFORE SUPABASE_URL was
// injected (May 2026 fix) is detected as stale and recreated rather than
// silently failing /sync-from-supabase forever.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('isMachineConfigStale returns true when SUPABASE_URL missing', async () => {
  process.env.FLY_API_TOKEN = process.env.FLY_API_TOKEN || 'test-token'
  process.env.FLY_APP = process.env.FLY_APP || 'test-app'
  const { isMachineConfigStale } = await import('../lib/fly/machines.js')
  const old = { config: { env: { RUNNER_SHARED_SECRET: 'x', AURORALY_PROJECT_ID: 'p1' } } }
  assert.equal(isMachineConfigStale(old), true)
})

test('isMachineConfigStale returns false when both SUPABASE keys present', async () => {
  const { isMachineConfigStale } = await import('../lib/fly/machines.js')
  const fresh = { config: { env: { RUNNER_SHARED_SECRET: 'x', AURORALY_PROJECT_ID: 'p1', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' } } }
  assert.equal(isMachineConfigStale(fresh), false)
})

test('isMachineConfigStale handles missing config block gracefully', async () => {
  const { isMachineConfigStale } = await import('../lib/fly/machines.js')
  assert.equal(isMachineConfigStale({}), true, 'no config = stale')
  assert.equal(isMachineConfigStale(null), true, 'null = stale')
  assert.equal(isMachineConfigStale(undefined), true, 'undefined = stale')
})

test('isMachineConfigStale flags partial env (only one of two keys present)', async () => {
  const { isMachineConfigStale } = await import('../lib/fly/machines.js')
  const partial = { config: { env: { SUPABASE_URL: 'https://x.supabase.co' } } } // service-role missing
  assert.equal(isMachineConfigStale(partial), true)
})

test('createMachineForProject body includes SUPABASE_URL + SERVICE_ROLE_KEY + BUCKET', () => {
  // Source-level check — guards against a future refactor accidentally
  // dropping the env vars. The /sync-from-supabase endpoint is useless
  // if the runner can't reach Supabase.
  const text = readFileSync('/app/lib/fly/machines.js', 'utf8')
  assert.ok(text.includes('SUPABASE_URL'), 'machine env must include SUPABASE_URL')
  assert.ok(text.includes('SUPABASE_SERVICE_ROLE_KEY'), 'must include service role key')
  assert.ok(text.includes('SUPABASE_BUCKET'), 'must include bucket name')
})

test('preview-runner exposes /sync-from-supabase endpoint with the documented contract', () => {
  const text = readFileSync('/app/preview-runner/index.js', 'utf8')
  assert.ok(text.includes('/sync-from-supabase'), 'endpoint must exist')
  assert.ok(text.includes('rest/v1/project_files'), 'must hit Supabase REST for rows')
  assert.ok(text.includes('storage/v1/object/'), 'must hit Supabase Storage for bodies')
  assert.ok(text.includes('Promise.all(Array.from'), 'storage downloads must be parallelized')
  assert.ok(text.includes('decodedAssets'), 'must report decoded count for binary assets')
})

test('Vercel start route uses /sync-from-supabase first, falls back to /sync', () => {
  const text = readFileSync('/app/app/api/previews/[projectId]/start/route.js', 'utf8')
  assert.ok(text.includes('/sync-from-supabase'), 'must call new fast path')
  assert.ok(text.includes('falling back to /sync'), 'must have legacy fallback for old runner images')
  assert.ok(text.includes('isMachineConfigStale'), 'must check staleness on existing machines')
  assert.ok(text.includes('destroyMachine'), 'must recreate stale machines')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
