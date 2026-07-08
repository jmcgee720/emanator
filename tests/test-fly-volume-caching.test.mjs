/**
 * Regression test: Fly volume caching for per-project node_modules.
 *
 * Without the volume, every machine destroy → recreate wipes
 * /project/node_modules and forces a fresh 3-6+ minute `npm install`.
 * This test asserts the wiring is in place:
 *   1. ensureProjectVolume is exported from lib/fly/apps.js
 *   2. It's imported by lib/fly/machines.js
 *   3. createMachineForProject calls it before booting
 *   4. The machine config attaches the volume at /project
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const appsSrc = fs.readFileSync('/app/lib/fly/apps.js', 'utf8')
const machinesSrc = fs.readFileSync('/app/lib/fly/machines.js', 'utf8')

// 1. ensureProjectVolume is exported
assert.match(appsSrc, /export async function ensureProjectVolume\(appName, region\)/,
  'ensureProjectVolume must be an exported async function'
)
console.log('OK ensureProjectVolume exported from lib/fly/apps.js')

// 2. It probes for existing volumes before creating (idempotency)
assert.match(appsSrc, /listed\.body\.find\(v => v\.name === volumeName/,
  'ensureProjectVolume must probe for existing volumes before POST /volumes'
)
console.log('OK ensureProjectVolume is idempotent (probes before create)')

// 3. Creation uses 1 GB volumes in the machine's region
assert.match(appsSrc, /size_gb: 1/, 'volume size must be 1 GB (Fly minimum)')
console.log('OK volume size is 1 GB')

// 4. machines.js imports the new function
assert.match(machinesSrc, /ensureProjectVolume/,
  'machines.js must import ensureProjectVolume'
)
console.log('OK machines.js imports ensureProjectVolume')

// 5. createMachineForProject calls it before the API POST — but wrapped
//    in try/catch so a Fly API glitch doesn't 500 the preview-start.
const createFnBody = machinesSrc.match(/export async function createMachineForProject[\s\S]+?^}/m)
assert.ok(createFnBody, 'createMachineForProject function body must be found')
assert.match(createFnBody[0], /try\s*\{\s*volumeId = await ensureProjectVolume\(appName, region\)/,
  'createMachineForProject must resolve volumeId inside a try/catch so volume-API glitches do not block preview boot'
)
assert.match(createFnBody[0], /booting WITHOUT persistent volume/,
  'catch branch must log the fallback and continue (no throw)'
)
console.log('OK createMachineForProject resolves volumeId with defensive fallback')

// 6. Machine config declares the mount at /project when volumeId resolved,
//    OMITS the mounts field otherwise.
assert.match(createFnBody[0], /\.\.\.\(volumeId \? \{\s*mounts:\s*\[\s*\{\s*volume:\s*volumeId,\s*path:\s*'\/project',/,
  'machine config must conditionally spread the mounts field so a null volumeId yields a machine with no mounts (ephemeral rootfs fallback)'
)
console.log('OK machine config conditionally mounts volume at /project')

console.log('\nAll Fly volume caching checks passed.')

// 7. Fly 412 "existing volume" recovery — flyFetch throws on non-2xx, so
//    we catch the thrown error and match on its message instead of
//    checking a response object.
assert.match(createFnBody[0], /\/ → 412:\/\.test\(msg\)/,
  'createMachineForProject must detect the 412 status via the flyFetch error message'
)
assert.match(createFnBody[0], /existing volume/i,
  'must match Flys "existing volume" error text'
)
assert.match(createFnBody[0], /await deleteProjectVolume\(appName, volumeId\)/,
  'must delete the stuck volume before retrying'
)
assert.match(createFnBody[0], /delete bodyNoVol\.config\.mounts/,
  'retry body must strip the mounts field'
)
console.log('OK 412 "existing volume" auto-recovery is wired')

// 8. deleteProjectVolume exists and is exported
assert.match(appsSrc, /export async function deleteProjectVolume\(appName, volumeId\)/,
  'deleteProjectVolume must be exported from lib/fly/apps.js'
)
console.log('OK deleteProjectVolume is exported')

console.log('\nAll Fly 412 recovery checks passed.')
