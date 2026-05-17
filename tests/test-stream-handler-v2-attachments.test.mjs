// Test the attachment → Anthropic content block logic in stream-handler-v2.
//
// We can't import non-exported helpers directly, so we patch the file's
// exports to expose them ONLY in test mode, then exercise them.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const target = resolve(__dirname, '../lib/api/stream-handler-v2.js')
const src = readFileSync(target, 'utf8')

// Sanity: both helpers must exist in source.
assert.ok(src.includes('function attachmentToContentBlock'), 'attachmentToContentBlock helper must exist')
assert.ok(src.includes('function buildUserContent'), 'buildUserContent helper must exist')

// The current message path must use the shared helper, NOT inline JSON.parse.
assert.ok(src.includes('buildUserContent(content, metadata.attachments'), 'current-message path must call buildUserContent')

// History path must also use shared helper for parity.
assert.ok(src.includes("buildUserContent(textContent, m.metadata.attachments"), 'history path must call buildUserContent')

// Helper supports all three categories.
assert.ok(src.includes("att.file_category === 'text'"), 'text attachments handled')
assert.ok(src.includes("att.file_category === 'pdf'"), 'pdf attachments handled')
assert.ok(src.includes("ATTACHMENT_TEXT_CHAR_CAP"), 'attachment text capped')

// Run the helpers directly by evaluating a stripped version in a sandbox-y
// way: extract the two functions from source and eval them.
// (Cheap but robust — keeps the helpers private to the module in prod.)
function extractFn(name) {
  const m = src.match(new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}\\n`))
  if (!m) throw new Error(`could not extract ${name}`)
  return m[0]
}
const helperSrc = `${extractFn('attachmentToContentBlock')}\n${extractFn('buildUserContent')}\nconst ATTACHMENT_TEXT_CHAR_CAP = 30000;\nreturn { attachmentToContentBlock, buildUserContent }`
const { attachmentToContentBlock, buildUserContent } = new Function(helperSrc)()

// ── attachmentToContentBlock ──
{
  // image → vision block
  const out = attachmentToContentBlock({
    filename: 'pic.png',
    file_category: 'image',
    preview_data: 'data:image/png;base64,iVBORw0KGgoAAA',
  })
  assert.equal(out.type, 'image')
  assert.equal(out.source.media_type, 'image/png')
  assert.equal(out.source.data, 'iVBORw0KGgoAAA')
}
{
  // text → inline text block with fence
  const out = attachmentToContentBlock({
    filename: 'spec.txt',
    file_category: 'text',
    mime_type: 'text/plain',
    content: 'hello world',
  })
  assert.equal(out.type, 'text')
  assert.ok(out.text.includes('spec.txt'))
  assert.ok(out.text.includes('hello world'))
  assert.ok(out.text.includes('```'))
}
{
  // pdf → extracted text block
  const out = attachmentToContentBlock({
    filename: 'doc.pdf',
    file_category: 'pdf',
    extracted_text: 'page one text',
  })
  assert.equal(out.type, 'text')
  assert.ok(out.text.includes('doc.pdf'))
  assert.ok(out.text.includes('page one text'))
}
{
  // image with no data → null (avoids sending bad blocks)
  const out = attachmentToContentBlock({ filename: 'broken.png', file_category: 'image' })
  assert.equal(out, null)
}
{
  // text > 30k chars truncated
  const big = 'x'.repeat(50_000)
  const out = attachmentToContentBlock({
    filename: 'big.md',
    file_category: 'text',
    content: big,
  })
  assert.ok(out.text.length < 50_000 + 500)
  assert.ok(out.text.includes('truncated'))
}

// ── buildUserContent ──
{
  // No attachments → returns plain string (text path)
  const out = buildUserContent('hello', [])
  assert.equal(out, 'hello')
}
{
  // Image + text → returns content blocks
  const out = buildUserContent('caption it', [
    { filename: 'a.png', file_category: 'image', preview_data: 'data:image/png;base64,AAA' },
  ])
  assert.ok(Array.isArray(out))
  assert.equal(out.length, 2)
  assert.equal(out[0].type, 'image')
  assert.equal(out[1].type, 'text')
  assert.equal(out[1].text, 'caption it')
}
{
  // PDF only, no text → returns single text block (not falls back to string)
  const out = buildUserContent('', [
    { filename: 'doc.pdf', file_category: 'pdf', extracted_text: 'hi' },
  ])
  assert.ok(Array.isArray(out))
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'text')
  assert.ok(out[0].text.includes('doc.pdf'))
}
{
  // Unknown attachment types → degrade to plain string
  const out = buildUserContent('hello', [
    { filename: 'video.mp4', file_category: 'binary', mime_type: 'video/mp4' },
  ])
  assert.equal(out, 'hello')
}

console.log('PASS: stream-handler-v2 attachments — images, text, pdf all flow through to content blocks')
