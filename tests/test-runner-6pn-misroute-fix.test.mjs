// ──────────────────────────────────────────────────────────────────────
// Test: misrouted preview requests are silently corrected via Fly's
// internal 6PN network instead of relying on fly-replay headers (which
// Fly's edge does not honor reliably for our wildcard subdomain setup).
//
// Before: half of page loads landed on a sibling project's machine.
// The runner returned `fly-replay: instance=<right-machine>` but Fly
// surfaced the response BODY to the browser as content instead of
// replaying. User saw the literal text "auroraly-routing: this
// machine serves X, request was for Y" in the preview iframe.
//
// After: when the runner detects a misroute AND the Host embeds the
// target machineId (which orchestrator-generated URLs always do), the
// runner proxies the request directly to that machine via 6PN at
// `<machineId>.vm.<app>.internal:3000`. ONE hop, deterministic, the
// browser gets the right response every time. fly-replay is kept only
// as a last-resort for bare/unscoped URLs.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('/app/preview-runner/index.js', 'utf8')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('runner declares internalProxy (separate from devProxy) for 6PN forwarding', () => {
  assert.match(SRC, /const internalProxy\s*=\s*httpProxy\.createProxyServer/, 'must create a dedicated proxy instance')
  assert.match(SRC, /internalProxy\.on\(['"]error['"]/, 'must wire error handler to avoid hung sockets')
})

test('internalTargetFor builds <machineId>.vm.<app>.internal:3000 URL', () => {
  const m = SRC.match(/function internalTargetFor[\s\S]*?\n\}/)
  assert.ok(m, 'internalTargetFor helper must exist')
  const body = m[0]
  assert.match(body, /\.vm\.\$\{FLY_APP_NAME\}\.internal:3000/, 'must use Fly 6PN hostname format')
})

test('HTTP misroute with machineId in Host forwards via internalProxy.web', () => {
  // The if-block for misroute must check reqMachine and call .web(req,res,{target})
  const block = SRC.match(/if \(!myProject \|\| reqProject !== myProject\)[\s\S]*?devProxy\.web\(req, res\)/)
  assert.ok(block, 'misroute branch must exist')
  assert.match(block[0], /if \(reqMachine && reqMachine !== process\.env\.FLY_MACHINE_ID\)/,
    'must skip self-proxy (avoid infinite loop) when reqMachine matches this machine')
  assert.match(block[0], /internalProxy\.web\(req, res, \{ target \}\)/,
    'must forward over 6PN via internalProxy.web')
})

test('HTTP misroute WITHOUT machineId falls back to fly-replay elsewhere=true', () => {
  const block = SRC.match(/if \(!myProject \|\| reqProject !== myProject\)[\s\S]*?devProxy\.web\(req, res\)/)[0]
  assert.match(block, /['"]fly-replay['"]:\s*['"]elsewhere=true['"]/, 'bare URLs still use fly-replay fallback')
  assert.doesNotMatch(block, /instance=\$\{reqMachine\}/, 'must NOT use instance= replay (proves we removed the broken path)')
})

test('WebSocket misroute with machineId also forwards via 6PN (HMR support)', () => {
  const block = SRC.match(/proxyServer\.on\(['"]upgrade['"][\s\S]*?devProxy\.ws\(req, socket, head\)/)
  assert.ok(block)
  assert.match(block[0], /internalProxy\.ws\(req, socket, head, \{ target \}\)/,
    'WS misroute must use 6PN proxy too')
})

test('FLY_APP_NAME defaults to auroraly-preview-runner', () => {
  assert.match(SRC, /FLY_APP_NAME\s*=\s*process\.env\.FLY_APP_NAME\s*\|\|\s*['"]auroraly-preview-runner['"]/)
})

test('No duplicate httpProxy module imports', () => {
  const imports = SRC.match(/import\s+httpProxy/g) || []
  assert.equal(imports.length, 1, `expected exactly 1 http-proxy import, found ${imports.length}`)
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
  if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
  console.log(`\n${tests.length} test(s) passed`)
})()
