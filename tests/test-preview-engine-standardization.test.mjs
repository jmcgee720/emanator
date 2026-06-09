// Locks in the Feb 2026 preview-engine standardization on Fly Machines
// (ServerPreview). The previous multi-engine state machine — Babel
// srcDoc, in-browser WebContainer, and server — was a source of 3
// different UX paths and 4 different "Starting your preview..." screens.
// This test ensures we don't accidentally re-introduce the dead engines.
//
// See docs/PREVIEW_ENGINE_STANDARDIZATION.md for the full rationale.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('WebContainer engine files are removed from the tree', async () => {
  // The in-browser WebContainer engine is dead code. Any of these
  // returning true means the engine is being resurrected without
  // updating the contract.
  for (const f of [
    'components/dashboard/tabs/WebContainerPreview.jsx',
    'lib/webcontainer/sandbox.js',
    'lib/webcontainer/file-tree.js',
    'lib/webcontainer/cra-to-vite.js',
  ]) {
    assert.equal(existsSync(join(ROOT, f)), false, `${f} must not exist — standardized on Fly server preview`)
  }
})

test('PreviewTab does not import or render WebContainerPreview', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/tabs/PreviewTab.jsx'), 'utf8')
  assert.doesNotMatch(src, /import\s+WebContainerPreview/, 'WebContainerPreview must not be imported')
  assert.doesNotMatch(src, /<WebContainerPreview/, 'WebContainerPreview must not be rendered')
  assert.doesNotMatch(src, /from\s+['"][^'"]*webcontainer\/sandbox/, 'webcontainer/sandbox import must be gone')
  assert.doesNotMatch(src, /from\s+['"][^'"]*webcontainer\/file-tree/, 'webcontainer/file-tree import must be gone')
})

test('PreviewTab routes to ServerPreview whenever a project ID is present', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/tabs/PreviewTab.jsx'), 'utf8')
  // The gating condition is now `project?.id ? <ServerPreview /> : <Babel srcDoc fallback>`.
  assert.match(src, /project\?\.id \?\s*\(?\s*<div[^>]*>\s*<ServerPreview/s, 'must route projects with an id to ServerPreview')
})

test('PreviewTab no longer exposes a switchable previewEngine state', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/tabs/PreviewTab.jsx'), 'utf8')
  // The old multi-engine state machine is gone.
  assert.doesNotMatch(src, /useState\(['"]server['"]\)/, 'previewEngineRaw state should be removed')
  assert.doesNotMatch(src, /setPreviewEngine/, 'setPreviewEngine should not be defined or called')
})

test('ServerPreview surfaces live build logs on the loading screen', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/tabs/ServerPreview.jsx'), 'utf8')
  // The "Starting your preview…" screen must show real activity now —
  // a "what's currently installing" hint AND the live log tail. This
  // is the single biggest perceived improvement vs. the old static
  // 1-2 / 5-10 minute message that looked dead.
  assert.match(src, /data-testid="server-preview-spinner"/)
  assert.match(src, /data-testid="server-preview-inline-logs"/, 'live logs must be visible during boot')
  assert.match(src, /data-testid="server-preview-toggle-logs"/, 'collapse/expand log control must be exposed')
  assert.match(src, /data-testid="server-preview-activity"/, 'last-install-activity hint must be exposed')
})
