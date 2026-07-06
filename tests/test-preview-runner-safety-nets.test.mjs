// Locks in two preview-runner safety nets added 2026-02 after diagnosing
// real user-reported preview failures:
//
//   (1) "Cannot find module 'ajv/dist/compile/codegen'" — CRA projects
//       crashing at boot because npm hoisted ajv@6 instead of ajv@8
//       (ajv-keywords@5 needs v8). Community fix since 2021 is to
//       install ajv@^8 at the project root. We do this automatically.
//
//   (2) "no package.json with a dev/start script found" — plain HTML/JS
//       projects (Auroraly landing-page templates, marketing sites)
//       were unrunnable because the runner only knew how to spawn npm.
//       Static-site fallback uses `npx serve` for these.
//
// Both fixes are the kind of thing that's easy to silently regress on a
// future refactor — hence pinning the wiring in a regression test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER = join(ROOT, 'preview-runner/index.js')

test('preview-runner installs ajv@8 when CRA + missing codegen entry', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // The block must mention the specific symptom (codegen missing) and
  // the specific fix (ajv@^8) so a future refactor can't drop one half.
  assert.match(src, /CRA ajv safety-net/, 'must label the safety-net block')
  assert.match(
    src,
    /['"]ajv['"],\s*['"]dist['"],\s*['"]compile['"],\s*['"]codegen\.js['"]/,
    'must probe the exact entry point that ajv-keywords requires',
  )
  assert.match(src, /ajv@\^8/, 'must install ajv@^8 to satisfy ajv-keywords@5')
  // Gate: only fires for projects that declare react-scripts. We don't
  // want to install ajv into every project.
  assert.match(
    src,
    /wantsCRA[\s\S]{0,400}codegen\.js/,
    'safety-net must be gated by react-scripts presence (wantsCRA)',
  )
})

test('preview-runner has a static-site fallback for projects with no package.json', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // resolveProjectCwd must return a synthetic `{ static: true }`
  // descriptor when there's no package.json but index.html exists.
  assert.match(
    src,
    /static-site fallback/i,
    'must label the static-site detection block',
  )
  assert.match(
    src,
    /existsSync\(join\(PROJECT_DIR, 'index\.html'\)\)/,
    'must probe for index.html at the project root',
  )
  assert.match(
    src,
    /static:\s*true/,
    'must mark the descriptor as static',
  )
})

test('preview-runner spawns npx serve for static descriptors', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // The boot path must check the static marker BEFORE running install
  // (no node_modules needed) and spawn `npx serve` instead.
  assert.match(
    src,
    /if \(isStatic\)/,
    'must branch on the static marker',
  )
  assert.match(
    src,
    /spawn\('npx',\s*\[\s*'--yes',\s*'serve'/,
    'must use npx serve for the static branch',
  )
  // Single-page-app rewriting is required so client-side routers work
  // (e.g. a static site using hash-router or BrowserRouter).
  assert.match(src, /'-s'/, "must enable serve's SPA-rewrite mode")
})

test('static branch returns BEFORE the install promise (no node_modules required)', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // Capture the slice of bootDevServerInBackground from the destructure
  // through the install promise. The `if (isStatic) ... return` block
  // must appear inside that slice.
  const fnSlice = src.match(
    /const \{ cwd, pkg, nested, static: isStatic \} = resolved[\s\S]*?if \(!installPromise\)/,
  )
  assert.ok(fnSlice, 'must destructure isStatic + then call installPromise')
  assert.match(
    fnSlice[0],
    /if \(isStatic\)[\s\S]*?return\s*\n/,
    'static branch must early-return before install',
  )
})

test('preview-runner deletes package-lock.json before install (npm/cli#4828)', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // Lockfile removal must happen BEFORE the "running npm install" log line
  // so the fresh resolution can pull the correct platform binaries.
  assert.match(
    src,
    /removed package-lock\.json to allow Linux-x64 optional binaries to resolve/,
    'runner must delete package-lock.json before install to fix Rollup/esbuild native-binary crashes'
  )
  const removeIdx = src.indexOf('removed package-lock.json')
  const installIdx = src.indexOf('running npm install in ${cwd}')
  assert.ok(removeIdx > 0 && installIdx > 0 && removeIdx < installIdx,
    'lockfile removal must occur before the npm install spawn'
  )
})

test('preview-runner Rollup + esbuild safety-nets probe & install Linux-x64 binaries', async () => {
  const src = await readFile(RUNNER, 'utf8')
  assert.match(src, /@rollup\/rollup-linux-x64-gnu missing[\s\S]*?recovery install/,
    'must probe for and install @rollup/rollup-linux-x64-gnu'
  )
  assert.match(src, /@esbuild\/linux-x64 missing[\s\S]*?recovery install/,
    'must probe for and install @esbuild/linux-x64'
  )
})

test('preview-runner safety-nets run on cache-hit path (stale machines self-heal)', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // The cache-hit early return must call runSafetyNets first — otherwise
  // pre-existing crashed machines with matching install hash stay broken
  // forever (would need a manual node_modules wipe).
  const cacheHitBlock = src.match(/cache hit — skipping npm install[\s\S]{0,500}?return/)
  assert.ok(cacheHitBlock, 'cache-hit early return block must exist')
  assert.match(cacheHitBlock[0], /await runSafetyNets\(cwd, pkgPath\)/,
    'cache-hit path must call runSafetyNets before returning so stale machines self-heal'
  )
})

test('preview-runner runs safety-nets after fresh install too', async () => {
  const src = await readFile(RUNNER, 'utf8')
  // Two callsites required: one on cache-hit path (tested above),
  // one at end of the install flow.
  const callSites = (src.match(/await runSafetyNets\(cwd, pkgPath\)/g) || []).length
  assert.ok(callSites >= 2,
    `runSafetyNets must be called from both cache-hit and post-install paths (found ${callSites} call sites)`
  )
})
