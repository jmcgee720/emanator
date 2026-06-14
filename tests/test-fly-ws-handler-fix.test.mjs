// ──────────────────────────────────────────────────────────────────────
// Test: Fly service config for user dev port (3000) uses handler chain
// `['tls']` — NOT `['tls', 'http']` — so WebSocket Upgrade requests
// (Vite HMR, Next.js HMR) survive Fly's edge instead of 502'ing.
//
// Background: Fly's `http` handler does HTTP/2 multiplexing internally
// and breaks the HTTP/1.1 Upgrade flow that WebSocket needs. Result:
// every `wss://…preview.auroraly.co/?token=…` connection from Vite HMR
// returned `HTTP 502 Bad Gateway` from Fly's edge directly (confirmed
// by `via: 1.1 fly.io` in the response). The Vite client then enters
// an infinite "server connection lost. Polling for restart…" reload
// loop and the user sees a blank iframe.
//
// Standard Fly recommendation for WS-heavy apps: terminate TLS at the
// edge but let your app handle HTTP/Upgrade parsing — handlers: ['tls'].
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('/app/lib/fly/machines.js', 'utf8')
// Re-import so the *runtime* code is what's tested, not a copy.
const { isMachineConfigStale } = await import('../lib/fly/machines.js')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── createMachineForProject service config ──────────────────────────

test('user dev service (port 443) uses handlers: [tls] (no http)', () => {
  // Find the port: 443 line in the source and check its handlers.
  // Use a lax match to tolerate trailing commas, comments, etc.
  const lines = SRC.split('\n')
  const portLines = lines.filter(l => /port:\s*443\b/.test(l))
  assert.ok(portLines.length >= 1, 'must declare port 443 at least once')
  // The FIRST port:443 line is for the user dev service. It must NOT
  // contain 'http' in its handlers.
  const userDevPort443 = portLines[0]
  assert.match(userDevPort443, /handlers:\s*\['tls'\]/, "user dev port 443 must use ['tls'] only")
  assert.doesNotMatch(userDevPort443, /['"]http['"]/, "user dev port 443 must NOT include the http handler")
})

test('control-plane service (port 8443) keeps handlers: [tls, http]', () => {
  // The runner-control-plane 8443 service stays on the full HTTP chain;
  // it never sees WebSockets so multiplexing is fine and we want HTTP/2.
  assert.match(SRC, /\{\s*port:\s*8443,\s*handlers:\s*\['tls',\s*'http'\]\s*\}/,
    'port 8443 must KEEP the http handler — control plane is plain JSON')
})

test('no other internal-port-3000 service still declares the http handler on 443', () => {
  // Defensive: any future copy of the service block must not regress.
  // Count occurrences of "handlers: ['tls', 'http']" in port 443 lines.
  // Allow at most 0 in the user-dev (3000) service block.
  const userDevBlock = SRC.match(/internal_port:\s*3000[\s\S]*?services?.[\s\S]*?(?=internal_port:|\},)/)
  // The block before port 8443 should not mention 'tls', 'http'
  const before8443 = SRC.split(/internal_port:\s*8080/)[0]
  // After our fix, before8443 should NOT contain "['tls', 'http']" in any 443 context.
  assert.doesNotMatch(before8443, /port:\s*443,\s*handlers:\s*\['tls',\s*'http'\]/,
    'user dev service must not regress to ["tls","http"] on port 443')
})

// ─── isMachineConfigStale also flags old handler chain ───────────────

test('isMachineConfigStale flags machine with http handler on 443', () => {
  const machine = {
    config: {
      env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', PREVIEW_BASE_DOMAIN: 'z' },
      services: [
        { internal_port: 3000, ports: [
          { port: 80, handlers: ['http'] },
          { port: 443, handlers: ['tls', 'http'] }, // ← old, broken-for-WS
        ]},
        { internal_port: 8080, ports: [{ port: 8443, handlers: ['tls', 'http'] }] },
      ],
    }
  }
  assert.equal(isMachineConfigStale(machine), true,
    'machine with old [tls,http] handler on user dev port 443 must be flagged stale')
})

test('isMachineConfigStale does NOT flag machine with fresh [tls] handler', () => {
  const machine = {
    config: {
      env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', PREVIEW_BASE_DOMAIN: 'z' },
      services: [
        { internal_port: 3000, ports: [
          { port: 80, handlers: ['http'] },
          { port: 443, handlers: ['tls'] }, // ← fresh
        ]},
        { internal_port: 8080, ports: [{ port: 8443, handlers: ['tls', 'http'] }] },
      ],
    }
  }
  assert.equal(isMachineConfigStale(machine), false,
    'machine with fresh [tls] handler must NOT be flagged stale')
})

test('isMachineConfigStale ignores http handler on control-plane port 8443', () => {
  // Only the user-dev port matters for WebSocket support. The control
  // plane keeps the http handler.
  const machine = {
    config: {
      env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', PREVIEW_BASE_DOMAIN: 'z' },
      services: [
        { internal_port: 3000, ports: [{ port: 443, handlers: ['tls'] }] },
        { internal_port: 8080, ports: [{ port: 8443, handlers: ['tls', 'http'] }] },
      ],
    }
  }
  assert.equal(isMachineConfigStale(machine), false)
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
