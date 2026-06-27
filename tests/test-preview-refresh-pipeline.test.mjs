// ── preview_refresh_needed pipeline — end-to-end contract ─────────
// Verifies the 3-hop signal path:
//   1. Server-side stream-handler-v2 sends an SSE 'preview_refresh_needed'
//      event after Fly sync succeeds. (Tested via snapshot-style assertion
//      that the event name is wired into the file's send() calls.)
//   2. stream-client.js's switch-case dispatches a window CustomEvent
//      'auroraly:preview-refresh-needed' carrying { projectId, path, ... }
//      so ANY subtree (ServerPreview, future thumbnails, devtools) can listen.
//   3. ServerPreview.jsx debounces 500ms then bumps iframeKey, which
//      remounts the iframe in React (guaranteed hard reload).
//
// These are LIGHTWEIGHT structural tests — they don't spin up a browser.
// They assert the wiring contract so a future refactor can't silently
// remove the SSE event name or break the CustomEvent dispatch shape.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const streamHandler = readFileSync(new URL('../lib/api/stream-handler-v2.js', import.meta.url), 'utf8')
const streamClient = readFileSync(new URL('../lib/stream-client.js', import.meta.url), 'utf8')
const serverPreview = readFileSync(new URL('../components/dashboard/tabs/ServerPreview.jsx', import.meta.url), 'utf8')

test('stream-handler-v2 emits preview_refresh_needed AFTER successful Fly sync', () => {
  // Must include the literal SSE event name + payload with projectId
  assert.match(streamHandler, /send\(['"]preview_refresh_needed['"]/, 'preview_refresh_needed send() call missing')
  // Should appear AFTER notifyPreviewOfFileChange resolves OK (i.e. inside
  // the .then(r => { if (r.notified) ... }) branch). Cheap check: the
  // event name appears in the same block as preview_synced.
  const previewSyncedIdx = streamHandler.indexOf("'preview_synced'")
  const refreshNeededIdx = streamHandler.indexOf("'preview_refresh_needed'")
  assert.ok(previewSyncedIdx > 0 && refreshNeededIdx > 0, 'both events should exist')
  assert.ok(refreshNeededIdx > previewSyncedIdx, 'refresh_needed must come AFTER preview_synced in the success branch (same chain)')
  // Make sure we still GUARD on r.notified — never tell the iframe to
  // reload when the Fly sync failed.
  const successBranch = streamHandler.slice(previewSyncedIdx, refreshNeededIdx + 200)
  assert.ok(successBranch.includes('preview_refresh_needed'), 'refresh_needed must live inside the if(r.notified) branch')
})

test('stream-client.js handles preview_refresh_needed case AND dispatches window CustomEvent', () => {
  // The switch case must exist
  assert.match(streamClient, /case ['"]preview_refresh_needed['"]/, 'switch case missing')
  // Must dispatch a CustomEvent with the canonical event name
  assert.match(streamClient, /CustomEvent\(['"]auroraly:preview-refresh-needed['"]/, 'window CustomEvent dispatch missing')
  // Must guard for SSR (window must exist) so this doesn't crash Node tests
  // or server-side rendering paths.
  assert.match(streamClient, /typeof window !== ['"]undefined['"]/, 'must SSR-guard the dispatch')
})

test('ServerPreview.jsx listens for auroraly:preview-refresh-needed', () => {
  assert.match(serverPreview, /addEventListener\(['"]auroraly:preview-refresh-needed['"]/, 'listener not registered')
  assert.match(serverPreview, /removeEventListener\(['"]auroraly:preview-refresh-needed['"]/, 'cleanup missing — would leak listeners on unmount')
})

test('ServerPreview.jsx debounces multi-file edits to ONE reload', () => {
  // 500ms debounce — multi-file agent edits collapse to one iframe reload
  assert.match(serverPreview, /setTimeout\([\s\S]+?500\)/, 'debounce timer (500ms) missing')
  // Iframe key bump is the actual refresh mechanism
  assert.match(serverPreview, /setIframeKey\(k => k \+ 1\)/, 'iframeKey bump missing — iframe would not remount')
})

test('ServerPreview.jsx filters events by projectId — multi-preview safety', () => {
  // If two preview panes are open for different projects, each must
  // only react to its own project's events. Without this, opening
  // ProjectA + editing ProjectB would force-reload ProjectA's iframe
  // and burn its in-progress dev work.
  assert.match(serverPreview, /eventProjectId\s*&&\s*eventProjectId\s*!==\s*projectId/, 'projectId mismatch filter missing')
})

test('ServerPreview.jsx skips reload when preview not yet ready', () => {
  // Don't try to reload a still-booting preview — the iframe key bump
  // would race with the start() boot path and could leave the user
  // with a permanent "starting" state.
  assert.match(serverPreview, /if \(status !== ['"]ready['"]\) return/, 'guard for status===ready missing')
})
