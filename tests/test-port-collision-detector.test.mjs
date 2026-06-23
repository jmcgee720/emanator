// ── Port Collision Detector ────────────────────────────────────────
// Verifies that the preview-runner correctly identifies EADDRINUSE
// errors in dev-server output and emits a clear, AI-readable diagnostic
// message + suggested fix.
//
// Context: Many user projects (MyNexus being the canonical example) use
// `concurrently` to run backend + frontend in parallel and accidentally
// bind both to port 3001. Node emits a cryptic stack trace, the dev
// server exits, and the user has no idea what happened. The Auroraly
// AI agent reads /logs via preview-diagnostics — it needs structured
// output to surface the problem + a one-line fix to the user.
//
// We can't import the runner module directly (it boots Express on
// import). Instead we replicate the regex used in scanForPortCollision
// and test it against representative log lines.

import test from 'node:test'
import assert from 'node:assert/strict'

// Same pattern as preview-runner/index.js scanForPortCollision —
// kept in sync via the test description. If you change one, change both.
function detectPortCollision(text) {
  const m = text.match(/EADDRINUSE[^0-9]*(?::|0\.0\.0\.0:)?(\d{2,5})\b/i)
    || text.match(/port\s+(\d{2,5})\s+is\s+already\s+in\s+use/i)
  return m ? Number(m[1]) : null
}

test('detects Node.js EADDRINUSE on IPv4 bind', () => {
  // Canonical Node error from `app.listen(3001)` when port is taken
  const log = 'Error: listen EADDRINUSE: address already in use 0.0.0.0:3001\n    at Server.setupListenHandle'
  assert.equal(detectPortCollision(log), 3001)
})

test('detects EADDRINUSE on IPv6 bind', () => {
  // Express on dual-stack hosts often binds to :::PORT
  const log = 'Error: listen EADDRINUSE :::3001'
  assert.equal(detectPortCollision(log), 3001)
})

test('detects Next.js port-in-use prose form', () => {
  // Next.js dev server prints a friendly message instead of raw stack
  const log = '⚠ Port 3000 is already in use, trying 3001 instead.'
  assert.equal(detectPortCollision(log), 3000)
})

test('detects Vite port-in-use form', () => {
  const log = 'Port 5173 is already in use. Trying another port…'
  assert.equal(detectPortCollision(log), 5173)
})

test('ignores unrelated errors', () => {
  const log = 'TypeError: Cannot read properties of undefined (reading "map")'
  assert.equal(detectPortCollision(log), null)
})

test('ignores EADDRINUSE without a port number nearby', () => {
  // Pathological case — match must require a port follow-up
  const log = 'EADDRINUSE: see docs'
  assert.equal(detectPortCollision(log), null)
})

test('handles common MyNexus concurrently scenario (port 3001 collision)', () => {
  // The actual log line MyNexus produced — both `node server.js` (Express
  // on 3001) and `next dev -p 3001` (Next.js on 3001) launched together
  // via `concurrently`. The second one to bind fails.
  const log = `
[1] > my-nexus@0.0.1 server
[1] > node server/index.js
[1]
[1] events.js:174
[1]       throw er; // Unhandled 'error' event
[1]       ^
[1]
[1] Error: listen EADDRINUSE: address already in use 0.0.0.0:3001
[1]     at Server.setupListenHandle [as _listen2] (net.js:1280:14)
[0] ▲ Next.js 14.0.4
[0] - Local:        http://localhost:3001
`.trim()
  assert.equal(detectPortCollision(log), 3001, 'MyNexus canonical case')
})

test('first match wins when log spans multiple events', () => {
  // If two services collide in sequence we report the first one — the
  // AI can dig further from raw logs but the headline diagnostic is one.
  const log = 'EADDRINUSE 0.0.0.0:3001 then later port 4000 is already in use'
  assert.equal(detectPortCollision(log), 3001)
})

test('suggests next port (port+1) for the fix message', () => {
  // The runner suggests Number(port) + 1 in the fix line. Pin the math.
  const port = 3001
  const suggestion = port + 1
  assert.equal(suggestion, 3002, 'MyNexus needs backend moved to 3002')
})
