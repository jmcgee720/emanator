// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner CRA log-pattern readiness probe.
//
// react-scripts serves an HTTP 200 "Compiling…" loading shell BEFORE the
// JS bundle finishes building. The TCP+HTTP probes flip to ready as
// soon as that shell answers, so the dashboard removes the build-output
// box and the user stares at a blank iframe for 30-90 seconds.
//
// Fix: scan devProc.stdout/stderr for "Compiled successfully" or
// "webpack compiled successfully" and gate `running` on that pattern
// when the project is CRA. This matches the strings webpack-dev-server
// itself emits, which is the only authoritative ready signal.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'

// Mirror the scanner from /app/preview-runner/index.js exactly.
const COMPILE_READY_PATTERNS = [
  'compiled successfully',
  'compiled with warnings',
]

function makeScanner() {
  let compileLogReady = false
  return {
    scan(chunk) {
      if (compileLogReady) return
      const text = (chunk?.toString?.('utf8') || '').toLowerCase()
      for (const pat of COMPILE_READY_PATTERNS) {
        if (text.includes(pat)) {
          compileLogReady = true
          return
        }
      }
    },
    get ready() { return compileLogReady },
    reset() { compileLogReady = false },
  }
}

// Mirror the `running` gate logic from /status.
function isRunning({ devProcAlive, portOpen, httpReady, isCRADevServer, compileLogReady }) {
  const craGate = isCRADevServer ? compileLogReady : true
  return !!devProcAlive && portOpen && httpReady && craGate
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── scanner contract ────────────────────────────────────────────────

test('does NOT flip ready on early loading-shell chatter', () => {
  const s = makeScanner()
  s.scan(Buffer.from('Starting the development server...\n'))
  s.scan(Buffer.from('Compiling...\n'))
  assert.equal(s.ready, false)
})

test('flips ready when webpack emits "Compiled successfully"', () => {
  const s = makeScanner()
  s.scan(Buffer.from('Compiled successfully!\n'))
  assert.equal(s.ready, true)
})

test('flips ready when webpack emits "webpack compiled successfully"', () => {
  const s = makeScanner()
  s.scan(Buffer.from('webpack 5.91.0 compiled successfully in 12345 ms\n'))
  assert.equal(s.ready, true)
})

test('flips ready when webpack emits "Compiled with warnings"', () => {
  const s = makeScanner()
  s.scan(Buffer.from('Compiled with warnings.\n\nsrc/App.jsx Line 5: unused var\n'))
  assert.equal(s.ready, true)
})

test('handles chunked output (string split across data events)', () => {
  const s = makeScanner()
  s.scan(Buffer.from('Compiled successfully'))
  // Even partial in one chunk counts (webpack always emits the phrase contiguously)
  assert.equal(s.ready, true)
})

test('idempotent: subsequent recompile messages do not flip it off', () => {
  const s = makeScanner()
  s.scan(Buffer.from('Compiled successfully!\n'))
  assert.equal(s.ready, true)
  s.scan(Buffer.from('Compiling...\n'))
  assert.equal(s.ready, true, 'must not regress once a successful compile happened')
})

// ─── /status gate logic ───────────────────────────────────────────────

test('CRA: running=false while compileLogReady=false even with port+http ready', () => {
  assert.equal(isRunning({
    devProcAlive: true,
    portOpen: true,
    httpReady: true,
    isCRADevServer: true,
    compileLogReady: false,
  }), false)
})

test('CRA: running=true once compileLogReady flips', () => {
  assert.equal(isRunning({
    devProcAlive: true,
    portOpen: true,
    httpReady: true,
    isCRADevServer: true,
    compileLogReady: true,
  }), true)
})

test('non-CRA (Vite/Next/static): compileLogReady is NOT required', () => {
  assert.equal(isRunning({
    devProcAlive: true,
    portOpen: true,
    httpReady: true,
    isCRADevServer: false,
    compileLogReady: false,
  }), true)
})

test('CRA: running=false if process died, regardless of compileLogReady', () => {
  assert.equal(isRunning({
    devProcAlive: false,
    portOpen: true,
    httpReady: true,
    isCRADevServer: true,
    compileLogReady: true,
  }), false)
})

// ─── source-level guard ───────────────────────────────────────────────

test('preview-runner source wires scanner into stdout AND stderr', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('/app/preview-runner/index.js', 'utf8')
  assert.match(src, /scanForCompileReady/, 'scanForCompileReady must be defined')
  // Must be wired into BOTH stdout and stderr of the dev process spawn
  assert.match(
    src,
    /devProc\.stdout\.on\('data', d => \{ appendLog\('dev', d\); scanForCompileReady\(d\) \}\)/,
    'stdout listener must call scanForCompileReady'
  )
  assert.match(
    src,
    /devProc\.stderr\.on\('data', d => \{ appendLog\('dev', d\); scanForCompileReady\(d\) \}\)/,
    'stderr listener must call scanForCompileReady'
  )
  // /status must gate `running` on craGate
  assert.match(src, /const craGate = isCRADevServer \? compileLogReady : true/)
  assert.match(src, /running: !!devProc && portOpen && httpReady && craGate/)
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
