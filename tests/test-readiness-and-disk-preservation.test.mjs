// Locks in two Feb 2026 fixes to address the "Ready badge + blank/broken
// iframe" UX problem that survived the initial TCP-probe readiness fix.
//
// Fix #1 — HTTP-level readiness probe in the runner
//   TCP-probe alone was insufficient: react-scripts and webpack-dev-server
//   bind their listening port EARLY (during compile setup) so they can
//   serve their own "Compiling..." progress page. If we report
//   running: true the instant TCP opens, the dashboard flips to Ready
//   and the user sees the dev-server's compile spinner — but Auroraly's
//   dashboard had already hidden its own "Starting preview…" screen.
//   The HTTP probe waits for an actual 2xx/3xx response, which means
//   the dev server is ACTUALLY serving the app, not just listening.
//
// Fix #2 — In-place env update instead of destroy/recreate for stale machines
//   PRIOR: isMachineConfigStale() → destroyMachine() → createMachineForProject()
//          = fresh disk = lost node_modules + lost .auroraly-install-hash
//          = 5-10 min reinstall on every orchestrator config tweak
//   NOW: isMachineConfigStale() → updateMachineEnv() (Fly Machine Update API)
//        = same machine, same disk, just new env after a quick cycle
//        = node_modules + install-hash preserved
//        = <10s reboot to ready
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('runner has an HTTP readiness probe in addition to TCP', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  assert.match(src, /function probeDevHttpReady/, 'must define probeDevHttpReady')
  // Probe sends a real GET / HTTP/1.0 request (not just TCP connect)
  assert.match(src, /GET \/ HTTP\/1\.0/, 'must send an actual HTTP/1.0 request')
  // Accepts 2xx and 3xx — anything 4xx or 5xx means dev server not serving the app yet
  assert.match(src, /code >= 200 && code < 400/)
  // Result is cached so we don't burn an HTTP request per /status call
  assert.match(src, /devHttpReady = false/)
  assert.match(src, /devHttpLastProbe/)
})

test('/status reports running only when TCP + HTTP both succeed', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // The new triple-AND running condition
  assert.match(
    src,
    /running:\s*!!devProc && portOpen && httpReady/,
    '/status must require process + port + HTTP all green',
  )
  // Expose all three signals separately so the dashboard can show
  // "compiling..." instead of "ready" when portOpen but !httpReady
  assert.match(src, /processAlive:\s*!!devProc/)
  assert.match(src, /portListening:\s*portOpen/)
  assert.match(src, /httpReady,/)
})

test('lib/fly/machines exports updateMachineEnv + freshMachineEnv', async () => {
  const src = await readFile(join(ROOT, 'lib/fly/machines.js'), 'utf8')
  assert.match(src, /export async function updateMachineEnv\(machineId, machine, additionalEnv\)/)
  assert.match(src, /export function freshMachineEnv\(projectId, sharedSecret\)/)
  // updateMachineEnv must POST to the Machine Update API (not DELETE)
  assert.match(src, /flyFetch\(`\/apps\/\$\{app\}\/machines\/\$\{machineId\}`,\s*\{\s*method: 'POST'/)
  // freshMachineEnv keys must match what createMachineForProject injects
  // — if these drift, the stale-config check will keep firing forever
  assert.match(src, /SUPABASE_URL:/)
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY:/)
  assert.match(src, /PREVIEW_BASE_DOMAIN:/)
})

test('start route uses updateMachineEnv before destroy for stale machines', async () => {
  const src = await readFile(join(ROOT, 'app/api/previews/[projectId]/start/route.js'), 'utf8')
  // Imported
  assert.match(src, /updateMachineEnv,\s*\n\s*freshMachineEnv/)
  // Tried FIRST inside the isMachineConfigStale branch
  assert.match(
    src,
    /isMachineConfigStale\(machine\)\)\s*\{[\s\S]*?attempting in-place update[\s\S]*?updateMachineEnv/,
    'in-place update must be the FIRST thing tried for a stale machine',
  )
  // destroyMachine ONLY in the fallback catch block
  assert.match(
    src,
    /in-place env update failed[\s\S]*?destroyMachine/,
    'destroy is only the fallback path, not the default',
  )
})
