// Locks in the readiness fix shipped 2026-02 after diagnosing a race
// condition that masqueraded as "preview crashed".
//
// Symptom: CRA projects showed "● Ready" badge but the iframe rendered
//   dev server not ready: connect ECONNREFUSED 127.0.0.1:3001
//
// Root cause: the runner's /status endpoint reported `running: true`
// as soon as `devProc !== null` — but `devProc` only signals that
// the process was *spawned*, not that it had bound to the listening
// port. react-scripts in particular has a 30-90 second compile window
// between "starting the development server" and the actual port-bind.
// During that window, the dashboard flipped to "ready" and the proxy
// returned ECONNREFUSED.
//
// Fix: TCP-probe USER_DEV_PORT and only report `running: true` when
// the probe succeeds. Cached for 500ms to avoid hot-loop sockets.
//
// Bonus fix: keep build logs accessible after status flips to ready
// via a FloatingLogsPanel so users can debug situations where the
// dev server reports ready but the iframe still errors out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('preview-runner imports node:net for TCP probing', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  assert.match(src, /import net from 'node:net'/, 'must import net for TCP probe')
})

test('preview-runner /status reports running only when dev port is listening', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // The probe function exists with cache+timeout semantics
  assert.match(src, /function probeDevPortListening/, 'must define a TCP probe function')
  assert.match(src, /devPortListening = false/, 'must default to not-listening')
  assert.match(src, /devPortLastProbe/, 'must throttle probes')
  // /status calls the probe and combines with devProc check
  assert.match(
    src,
    /running:\s*!!devProc && portOpen/,
    '/status must require BOTH process alive AND port open',
  )
  // 250ms probe timeout — fast enough not to slow polling
  assert.match(src, /setTimeout\(\(\) => finish\(false\), 250\)/, 'must time out probes at 250ms')
})

test('preview-runner /status exposes processAlive vs portListening separately', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // Surfacing both signals lets the dashboard distinguish "still
  // compiling" from "crashed" — process alive but port closed for
  // 60+ seconds = stuck/crashed; both true = healthy.
  assert.match(src, /processAlive:\s*!!devProc/)
  assert.match(src, /portListening:\s*portOpen/)
})

test('ServerPreview renders a FloatingLogsPanel when status is ready', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/tabs/ServerPreview.jsx'), 'utf8')
  // Only mounts when status === 'ready' (and logs are non-empty so
  // we don't render a useless empty pill on a clean static-site boot).
  assert.match(
    src,
    /status === 'ready' && logs\.length > 0 && \(\s*<FloatingLogsPanel/,
    'must gate FloatingLogsPanel on ready + non-empty logs',
  )
  // Exposes its own test ids for the testing agent + manual QA
  assert.match(src, /data-testid="server-preview-floating-logs"/)
  assert.match(src, /data-testid="server-preview-floating-logs-open"/)
  assert.match(src, /data-testid="server-preview-floating-logs-close"/)
  assert.match(src, /data-testid="server-preview-floating-logs-copy"/)
})

test('FloatingLogsPanel renders the actual log entries (not just a stub)', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/tabs/ServerPreview.jsx'), 'utf8')
  // The panel must iterate logs.slice(...) — verifies it's a real
  // viewer, not an empty container that future refactors might leave
  // behind by accident.
  assert.match(
    src,
    /function FloatingLogsPanel[\s\S]*?logs\.slice\(-300\)\.map/,
    'panel must render up to 300 log entries',
  )
})
