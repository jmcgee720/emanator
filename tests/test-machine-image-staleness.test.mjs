// ──────────────────────────────────────────────────────────────────────
// Test: orchestrator detects + recycles machines running a stale runner
// image after `preview-runner` redeploys.
//
// Background: Fly Machines pin to a specific image at create time and do
// not auto-update. Every time we ship runner-side fixes (e.g. Vite alias
// auto-injection, CRA compile-ready log probe), existing user preview
// machines silently keep serving the OLD image — meaning the user's
// "still broken" report is technically correct: their machine never
// picked up our fix.
//
// The fix: `isMachineImageStale(machine, deployedImage)` compares the
// machine's current image against the canonical deployed image, and the
// start route destroys+recreates when they differ. Pure function so we
// can unit-test the comparison logic without hitting the Fly API.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Re-import the real function from the lib so the test breaks if it
// ever regresses or gets renamed.
const { isMachineImageStale } = await import('../lib/fly/machines.js')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('flags a machine running an older image SHA as stale', () => {
  const machine = { config: { image: 'registry.fly.io/auroraly-preview:deployment-OLD' } }
  const deployedImage = 'registry.fly.io/auroraly-preview:deployment-NEW'
  assert.equal(isMachineImageStale(machine, deployedImage), true)
})

test('returns false when machine and deployed image match', () => {
  const machine = { config: { image: 'registry.fly.io/auroraly-preview:deployment-NEW' } }
  assert.equal(isMachineImageStale(machine, 'registry.fly.io/auroraly-preview:deployment-NEW'), false)
})

test('returns false when machine has no image (safer not to recycle)', () => {
  assert.equal(isMachineImageStale({ config: {} }, 'registry.fly.io/auroraly-preview:deployment-NEW'), false)
  assert.equal(isMachineImageStale(null, 'registry.fly.io/auroraly-preview:deployment-NEW'), false)
  assert.equal(isMachineImageStale(undefined, 'registry.fly.io/auroraly-preview:deployment-NEW'), false)
})

test('returns false when deployedImage is missing (transient Fly API failure)', () => {
  const machine = { config: { image: 'registry.fly.io/auroraly-preview:deployment-OLD' } }
  assert.equal(isMachineImageStale(machine, null), false)
  assert.equal(isMachineImageStale(machine, undefined), false)
  assert.equal(isMachineImageStale(machine, ''), false)
})

test('case-sensitive image SHA comparison (Fly tags include lowercase ULIDs)', () => {
  const a = { config: { image: 'registry.fly.io/auroraly-preview:deployment-01HVK7XYZ' } }
  // Different case = different image
  assert.equal(isMachineImageStale(a, 'registry.fly.io/auroraly-preview:deployment-01hvk7xyz'), true)
})

// ─── source-level guards: make sure the start route uses the function ─

test('start route imports isMachineImageStale + resolveDeployedImage', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/start/route.js', 'utf8')
  assert.match(src, /isMachineImageStale/, 'start route must import isMachineImageStale')
  assert.match(src, /resolveDeployedImage/, 'start route must import resolveDeployedImage')
})

test('start route checks image staleness BEFORE env staleness', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/start/route.js', 'utf8')
  // Skip past the imports block, then match actual call sites only
  // (function name followed by an open paren). Comments / imports
  // shouldn't influence the ordering check.
  const afterImports = src.split(/from\s+['"]@\/lib\/fly\/machines['"]/)[1] || ''
  const imageMatch = afterImports.match(/isMachineImageStale\s*\(/)
  const envMatch = afterImports.match(/isMachineConfigStale\s*\(/)
  assert.ok(imageMatch && envMatch, 'both call sites must exist')
  assert.ok(imageMatch.index < envMatch.index, 'image check must be invoked before env check (image is a stronger staleness signal — env updates would be a wasted in-place restart on a machine we are about to destroy anyway)')
})

test('start route destroys (not env-updates) when image is stale', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/start/route.js', 'utf8')
  // The stale-image branch must call destroyMachine, not updateMachineEnv —
  // Fly's in-place machine update DOES restart but does NOT swap image.
  const block = src.match(/isMachineImageStale[\s\S]{0,800}/)
  assert.ok(block, 'expected stale-image branch in start route')
  assert.match(block[0], /destroyMachine/, 'stale-image branch must call destroyMachine')
})

test('start route tolerates resolveDeployedImage failures (no recycle on transient errors)', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/start/route.js', 'utf8')
  // The check must be wrapped in try/catch so a Fly API hiccup doesn't
  // kill the user's machine.
  const block = src.match(/resolveDeployedImage[\s\S]{0,500}/)
  assert.ok(block, 'expected resolveDeployedImage call')
  assert.match(src, /catch \(imgErr\)/, 'image-staleness check must be wrapped in try/catch')
})

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${name}\n    ${err.message}`)
    }
  }
  if (failed) {
    console.error(`\n${failed} test(s) failed`)
    process.exit(1)
  }
  console.log(`\n${tests.length} test(s) passed`)
})()
