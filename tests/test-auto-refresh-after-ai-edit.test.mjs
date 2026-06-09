// Locks in the "auto-refresh preview after AI edit" wiring shipped
// 2026-02 (Emergent-style instant refresh).
//
// The contract:
//   1. POST /api/previews/:projectId/sync exists and hits the runner's
//      /sync-from-supabase endpoint (NOT /start — we don't want to
//      restart the dev server on every edit).
//   2. useDashboardStream's onDone handler detects file changes
//      (generatedFiles.length > 0 || directEditMode) and calls the
//      sync endpoint, then bumps the iframe refresh 800ms later so
//      Vite/CRA HMR has time to recompile.
//   3. PreviewTab accepts an external serverPreviewRefreshRef from
//      Dashboard so the auto-refresh callback can reach into the
//      iframe key bump function. Falls back to a local ref if no
//      parent ref is passed (preserves test/old-mount compat).
//   4. Sync is skipped when no machine is provisioned (no preview
//      open = nothing to refresh). The orchestrator returns
//      { ok: true, skipped: 'no-machine' } in that case.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('orchestrator sync endpoint exists at /api/previews/[projectId]/sync', async () => {
  const path = join(ROOT, 'app/api/previews/[projectId]/sync/route.js')
  assert.equal(existsSync(path), true, 'sync route must exist')
  const src = await readFile(path, 'utf8')
  assert.match(src, /export async function POST/, 'must export POST handler')
  assert.match(src, /export async function OPTIONS/, 'must export OPTIONS for CORS')
})

test('sync endpoint hits runner /sync-from-supabase (NOT /start)', async () => {
  const src = await readFile(join(ROOT, 'app/api/previews/[projectId]/sync/route.js'), 'utf8')
  assert.match(src, /\$\{url\}\/sync-from-supabase/, 'must POST to /sync-from-supabase')
  assert.doesNotMatch(src, /\$\{url\}\/start/, 'must NOT touch /start (would restart dev server)')
  // Project secret is the SAME as start/route.js so the runner accepts it
  assert.match(src, /X-Auroraly-Secret/)
})

test('sync endpoint skips when machine is not running', async () => {
  const src = await readFile(join(ROOT, 'app/api/previews/[projectId]/sync/route.js'), 'utf8')
  // No machine: skip with 200 (we don't want to error-spam the dashboard
  // every time an AI turn completes on a chat whose project has no preview)
  assert.match(src, /skipped:\s*['"]no-machine['"]/)
  // Machine in any non-started state: skip too (start path will handle it)
  assert.match(src, /skipped:\s*`machine-\$\{machine\.state\}`/)
})

test('useDashboardStream subscribes to files_saved SSE event and bumps iframe', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/useDashboardStream.js'), 'utf8')
  // The V2 stream handler already POSTs to the runner's /sync-from-supabase
  // when write/edit/delete tools succeed (lib/api/stream-handler-v2.js
  // line ~1444) AND emits a files_saved SSE event. The dashboard listens
  // for that event and bumps the iframe key after an HMR-settling delay.
  // That's cleaner than calling /api/previews/.../sync from the client.
  assert.match(src, /onFilesSaved:\s*\(data\)\s*=>/, 'must register onFilesSaved handler')
  assert.match(src, /serverPreviewRefreshRef\.current\(\)/, 'must call iframe refresh ref')
  // 800ms is the safe middle ground between Vite (<500ms) and CRA (~1-2s)
  assert.match(src, /setTimeout\([\s\S]*?serverPreviewRefreshRef\.current\(\)[\s\S]*?\}, 800\)/)
})

test('V2 stream handler emits files_saved + pokes runner on tool success', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  // Server-side: tool calls for write/edit/delete must fire BOTH the
  // SSE breadcrumb and the runner-poke. Removing either half breaks
  // auto-refresh.
  assert.match(src, /'write_file' \|\| ev\.name === 'edit_file' \|\| ev\.name === 'delete_file'/)
  assert.match(src, /send\('files_saved'/)
  assert.match(src, /notifyPreviewOfFileChange\(chat\.project_id/)
})

test('serverPreviewRefreshRef flows Dashboard → RightPanel → PreviewTab', async () => {
  const dash = await readFile(join(ROOT, 'components/dashboard/Dashboard.jsx'), 'utf8')
  const right = await readFile(join(ROOT, 'components/dashboard/RightPanel.jsx'), 'utf8')
  const preview = await readFile(join(ROOT, 'components/dashboard/tabs/PreviewTab.jsx'), 'utf8')

  // Owned at Dashboard scope, threaded into useDashboardStream
  assert.match(dash, /const serverPreviewRefreshRef = useRef\(null\)/)
  assert.match(dash, /serverPreviewRefreshRef,\s*\n\s*\}\)/m, 'must pass into useDashboardStream ctx')
  // Forwarded to RightPanel
  assert.match(dash, /serverPreviewRefreshRef=\{serverPreviewRefreshRef\}/)
  // RightPanel receives + forwards
  assert.match(right, /serverPreviewRefreshRef,/)
  assert.match(right, /serverPreviewRefreshRef=\{serverPreviewRefreshRef\}/)
  // PreviewTab accepts external, with local fallback
  assert.match(preview, /serverPreviewRefreshRef: externalServerPreviewRefreshRef/)
  assert.match(preview, /externalServerPreviewRefreshRef \|\| localServerPreviewRefreshRef/)
})
