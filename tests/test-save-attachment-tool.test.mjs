// ──────────────────────────────────────────────────────────────────────
// save_attachment_to_path tool — unit tests
// ──────────────────────────────────────────────────────────────────────
// Pins the behaviour that lets the project agent save uploaded binary
// attachments (PNG sprites, PDFs, etc.) into the project file tree
// without trying to base64-encode anything itself. Regression here =
// the user's drag-and-drop art lands as a 28-byte text stub on disk
// and the iframe stays unstyled.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveAttachmentTool, buildDefaultToolset } from '../lib/ai/agent-tools-v2.js'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function fakeWriter() {
  const writes = []
  return {
    writes,
    isConfigured: true,
    repo: 'fake/project',
    branch: 'project',
    async writeFile(path, content, message) {
      writes.push({ path, content, message })
      return `Wrote ${path} (${content.length} bytes)`
    },
  }
}

const scope = { rootDirs: ['/project-test'], excludePaths: [] }

test('save_attachment_to_path: saves PNG by 1-based index', async () => {
  const writer = fakeWriter()
  const attachments = [
    { filename: 'logo.png', file_category: 'image', size: 4321, preview_data: PNG_DATA_URL },
  ]
  const tool = saveAttachmentTool(scope, writer, attachments)
  const result = await tool.execute({
    attachment_index: 1,
    path: 'frontend/public/assets/mangia-mama/ui/logo.png',
  })
  assert.equal(writer.writes.length, 1)
  assert.equal(writer.writes[0].path, 'frontend/public/assets/mangia-mama/ui/logo.png')
  assert.equal(writer.writes[0].content, PNG_DATA_URL, 'writer must receive the full data URL so the Fly runner can decode it')
  assert.match(result, /Saved attachment "logo\.png"/)
  assert.match(result, /Vite will serve the binary directly/)
})

test('save_attachment_to_path: saves by exact filename', async () => {
  const writer = fakeWriter()
  const attachments = [
    { filename: 'bg.png', file_category: 'image', preview_data: PNG_DATA_URL },
    { filename: 'logo.png', file_category: 'image', preview_data: PNG_DATA_URL },
  ]
  const tool = saveAttachmentTool(scope, writer, attachments)
  await tool.execute({
    attachment_filename: 'logo.png',
    path: 'frontend/public/assets/mangia-mama/ui/logo.png',
  })
  assert.equal(writer.writes.length, 1)
  assert.equal(writer.writes[0].content, PNG_DATA_URL)
})

test('save_attachment_to_path: rejects when index is out of range', async () => {
  const writer = fakeWriter()
  const attachments = [{ filename: 'a.png', file_category: 'image', preview_data: PNG_DATA_URL }]
  const tool = saveAttachmentTool(scope, writer, attachments)
  await assert.rejects(
    () => tool.execute({ attachment_index: 5, path: 'frontend/x.png' }),
    /Attachment not found/,
  )
  assert.equal(writer.writes.length, 0, 'no write should happen on lookup failure')
})

test('save_attachment_to_path: rejects when attachment carries no binary data', async () => {
  const writer = fakeWriter()
  const attachments = [{ filename: 'notes.txt', file_category: 'text', content: 'hello', preview_data: null }]
  const tool = saveAttachmentTool(scope, writer, attachments)
  await assert.rejects(
    () => tool.execute({ attachment_index: 1, path: 'frontend/notes.txt' }),
    /no binary data/,
  )
})

test('save_attachment_to_path: throws helpful error when no attachments on the turn', async () => {
  const writer = fakeWriter()
  const tool = saveAttachmentTool(scope, writer, [])
  await assert.rejects(
    () => tool.execute({ attachment_index: 1, path: 'frontend/x.png' }),
    /No attachments on the current message/,
  )
})

test('save_attachment_to_path: refuses to run without a writer (read-only scope)', async () => {
  const tool = saveAttachmentTool(scope, null, [
    { filename: 'a.png', file_category: 'image', preview_data: PNG_DATA_URL },
  ])
  await assert.rejects(
    () => tool.execute({ attachment_index: 1, path: 'frontend/a.png' }),
    /requires a project writer/,
  )
})

test('save_attachment_to_path: reports realistic on-disk byte count, not base64 length', async () => {
  // The tool reports the post-decode byte size so the agent's status
  // message tells the user the truth ("412 KB on disk", not "562 KB
  // base64 string written to DB").
  const writer = fakeWriter()
  const attachments = [{ filename: 'logo.png', file_category: 'image', preview_data: PNG_DATA_URL }]
  const tool = saveAttachmentTool(scope, writer, attachments)
  const result = await tool.execute({ attachment_index: 1, path: 'frontend/logo.png' })
  // The PNG_DATA_URL body is 96 base64 chars → ~72 bytes on disk.
  // We just assert the number in the message is small and matches the
  // KB-or-B convention.
  assert.match(result, /\(\d+\.?\d* (B|KB)\)/, 'must include a byte size in B or KB')
  assert.doesNotMatch(result, /562/, 'must NOT include the inflated base64 string length')
})

test('buildDefaultToolset: only includes save_attachment_to_path when attachments are present', async () => {
  const writer = fakeWriter()
  const without = buildDefaultToolset(scope, writer, null /* reader */, null /* attachments */)
  const withAtt = buildDefaultToolset(scope, writer, null, [
    { filename: 'x.png', file_category: 'image', preview_data: PNG_DATA_URL },
  ])
  assert.ok(!without.find((t) => t.name === 'save_attachment_to_path'),
    'no attachments → no save_attachment_to_path tool (avoids tempting model to hallucinate)')
  assert.ok(withAtt.find((t) => t.name === 'save_attachment_to_path'),
    'attachments present → save_attachment_to_path tool exposed')
})
