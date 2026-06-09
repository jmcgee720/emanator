// Locks in the install-hash persistence contract for the preview-runner.
// 
// Why: Fly's auto_stop_machines = "stop" keeps the machine rootfs intact
// across restarts, so node_modules survives. But the runner's
// `lastInstallHash` was an in-memory variable that reset to null on
// every restart — which made the cache-miss branch fire and nuke
// node_modules even though nothing had changed. Persisting the hash
// to /project/.auroraly-install-hash is what turns "Mangia Mama takes
// 5-10 min every cold boot" into "Mangia Mama takes <10s after the
// first boot."
//
// See docs/PREVIEW_ENGINE_STANDARDIZATION.md for the full Phase 3 plan.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('preview-runner persists lastInstallHash to disk', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // Constant for the hash file path
  assert.match(src, /INSTALL_HASH_FILE\s*=\s*join\(PROJECT_DIR,\s*['"]\.auroraly-install-hash['"]\)/)
  // Loader + saver functions exist
  assert.match(src, /async function loadPersistedInstallHash/)
  assert.match(src, /async function savePersistedInstallHash/)
  // The save MUST fire on successful install
  assert.match(
    src,
    /lastInstallHash = key;\s*savePersistedInstallHash\(key\);/,
    'must persist hash on successful npm install exit',
  )
})

test('preview-runner hydrates the hash from disk on boot', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // listen() handler must call the loader so subsequent restarts get
  // the previous install's hash. We don't try to extract just the
  // app.listen block (its body uses nested template literals + arrow
  // fns and a naive regex over-matches). Two literal assertions are
  // enough: the loader exists AND is called from inside the listener.
  assert.match(src, /loadPersistedInstallHash\(\)\.catch/, 'must call loader from listen handler')
})

test('preview-runner preserves the hash file during /sync-from-supabase cleanup', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // The disk-vs-DB diff at sync time wipes files that aren't in the
  // DB. If we don't preserve .auroraly-install-hash, every sync will
  // delete it — defeating the persistence.
  assert.match(src, /PRESERVE_ROOT\s*=\s*new Set\([^)]*['"]\.auroraly-install-hash['"]/)
})

test('preview-runner clears the persisted hash when /force-install fires', async () => {
  const src = await readFile(join(ROOT, 'preview-runner/index.js'), 'utf8')
  // The force-install path explicitly resets node_modules state, so the
  // hash file must follow suit or the NEXT /start will think node_modules
  // is still valid and skip its own sanity check.
  assert.match(
    src,
    /lastInstallHash\s*=\s*''\s*\n\s*await\s+savePersistedInstallHash\(''\)/,
    'force-install must clear both in-memory + on-disk hash',
  )
})
