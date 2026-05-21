// ──────────────────────────────────────────────────────────────────────
// LeftPanel attachment-forwarding regression
// ──────────────────────────────────────────────────────────────────────
// User reported attachments not reaching the agent in Core System chat
// despite uploading via BOTH drag-and-drop AND the paperclip button.
// Root cause: LeftPanel.handleSendMessage(content) accepted only the
// content arg and silently dropped the attachments arg that
// ChatComposer.handleSubmit passes as onSend(messageText, attachments).
// The /api/projects/{id}/upload call succeeded (200), but the agent
// never received metadata.attachments because LeftPanel was the
// stranded handoff in the middle.
//
// This test pins the contract: handleSendMessage MUST accept and
// forward attachments. Regressing this breaks every image upload.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LEFT_PANEL = join(__dirname, '..', 'components', 'dashboard', 'LeftPanel.jsx')

test('LeftPanel.handleSendMessage accepts an attachments argument', async () => {
  const src = await readFile(LEFT_PANEL, 'utf8')
  assert.match(
    src,
    /const handleSendMessage = async \(content, attachments\)/,
    'handleSendMessage must declare both content AND attachments parameters — otherwise the second arg from ChatComposer.onSend(messageText, uploadedAttachments) is silently dropped',
  )
})

test('LeftPanel.handleSendMessage forwards attachments to onSendMessage', async () => {
  const src = await readFile(LEFT_PANEL, 'utf8')
  assert.match(
    src,
    /await onSendMessage\(content, attachments\)/,
    'must invoke onSendMessage with BOTH content and attachments so useDashboardStream.sendMessage receives them and posts metadata.attachments to the stream endpoint',
  )
})

test('LeftPanel wires ChatComposer.onSend through handleSendMessage (not a different handler)', async () => {
  const src = await readFile(LEFT_PANEL, 'utf8')
  assert.match(
    src,
    /<ChatComposer[\s\S]*?onSend=\{handleSendMessage\}/,
    'composer onSend must route through handleSendMessage so the attachment-forwarding fix actually takes effect',
  )
})
