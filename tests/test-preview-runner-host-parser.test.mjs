// ──────────────────────────────────────────────────────────────────────
// preview-runner host-parser unit tests
// ──────────────────────────────────────────────────────────────────────
// The runner's :3000 project-routing proxy uses this function to decide:
//   (a) which projectId the inbound request is targeting
//   (b) which Fly machineId (if any) the iframe URL embeds for single-hop
//       `fly-replay: instance=<machineId>` recovery
//
// Bugs here cascade into "iframe loads CSS from a different user's
// project" symptoms in production. These tests pin every supported
// host shape so regressions are caught locally before any deploy.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectIdFromHost } from '../preview-runner/host-parser.js'

test('projectIdFromHost: empty / null host returns empty fields', () => {
  assert.deepEqual(projectIdFromHost(''), { projectId: '', machineId: '' })
  assert.deepEqual(projectIdFromHost(null), { projectId: '', machineId: '' })
  assert.deepEqual(projectIdFromHost(undefined), { projectId: '', machineId: '' })
})

test('projectIdFromHost: bare projectId subdomain (multi-hop replay path)', () => {
  // Default `publicDevUrl(projectId)` output. The proxy will fall back
  // to `fly-replay: elsewhere=true` because machineId is unknown.
  assert.deepEqual(
    projectIdFromHost('proj-xyz.preview.auroraly.co'),
    { projectId: 'proj-xyz', machineId: '' },
  )
})

test('projectIdFromHost: projectId--machineId subdomain (single-hop replay)', () => {
  // New `publicDevUrl(projectId, machineId)` output. The proxy uses
  // `fly-replay: instance=<machineId>` to bounce directly at the right
  // machine on the first wrong-machine hit.
  assert.deepEqual(
    projectIdFromHost('proj-xyz--mach-abc123.preview.auroraly.co'),
    { projectId: 'proj-xyz', machineId: 'mach-abc123' },
  )
})

test('projectIdFromHost: strips :port from Host header', () => {
  // Some upstream proxies pass `Host: foo:443` — must not pollute the
  // parsed projectId. Real Fly traffic does not include the port but
  // local Express dev test harnesses do.
  assert.deepEqual(
    projectIdFromHost('proj-xyz.preview.auroraly.co:3000'),
    { projectId: 'proj-xyz', machineId: '' },
  )
  assert.deepEqual(
    projectIdFromHost('proj-xyz--mach-abc.preview.auroraly.co:443'),
    { projectId: 'proj-xyz', machineId: 'mach-abc' },
  )
})

test('projectIdFromHost: lowercases hostname (DNS is case-insensitive)', () => {
  // Browsers may upcase if a user types the URL by hand. We compare
  // against AURORALY_PROJECT_ID which is always lowercase.
  assert.deepEqual(
    projectIdFromHost('Proj-XYZ--Mach-ABC.preview.auroraly.co'),
    { projectId: 'proj-xyz', machineId: 'mach-abc' },
  )
})

test('projectIdFromHost: ignores extra `--` segments beyond the first', () => {
  // We don't currently emit a third segment, but be defensive: if a
  // projectId or machineId ever contains `--`, we still get a clean
  // first-two split rather than dropping the machineId entirely.
  const out = projectIdFromHost('proj--with--extra.preview.auroraly.co')
  assert.equal(out.projectId, 'proj')
  assert.equal(out.machineId, 'with')
})

test('projectIdFromHost: 6PN internal fly-vm hostname returns vm-id as projectId', () => {
  // Debug / template machines hit at `<machine-id>.vm.<app>.internal`.
  // The proxy treats anything-not-matching its AURORALY_PROJECT_ID as
  // a mismatch → fly-replay. Just make sure parsing doesn't throw.
  const out = projectIdFromHost('e784954c1e1e87.vm.auroraly-preview-runner.internal')
  assert.equal(out.projectId, 'e784954c1e1e87')
  assert.equal(out.machineId, '')
})
