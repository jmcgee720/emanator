// ──────────────────────────────────────────────────────────────────────
// Image-replay stripper tests
// ──────────────────────────────────────────────────────────────────────
// Pins the contract that user-message image blocks followed by an
// assistant submit_screenshot_inventory tool call are replaced with a
// text placeholder, while images NOT followed by an inventory call
// are left intact. Each stripped image saves ~1500 tokens per turn.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  stripInventoriedImages,
  INVENTORIED_IMAGE_PLACEHOLDER,
} from '../lib/ai/image-replay-stripper.js'

function imgBlock() {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }
}
function txtBlock(t) { return { type: 'text', text: t } }
function inventoryCall(input = {}) {
  return { type: 'tool_use', id: 'tu_1', name: 'submit_screenshot_inventory', input }
}
function otherTool(name) { return { type: 'tool_use', id: 'tu_2', name, input: {} } }

test('stripInventoriedImages: empty / non-array input returns unchanged', () => {
  assert.deepEqual(stripInventoriedImages(null).messages, null)
  assert.deepEqual(stripInventoriedImages(undefined).messages, undefined)
  assert.deepEqual(stripInventoriedImages([]).messages, [])
})

test('stripInventoriedImages: image followed by inventory call IS stripped', () => {
  const msgs = [
    { role: 'user', content: [imgBlock(), txtBlock('look at this')] },
    { role: 'assistant', content: [inventoryCall(), txtBlock('inventory result')] },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 1)
  assert.equal(r.freedTokensEstimate, 1500)
  // The user message's image block must now be a text placeholder
  const userContent = r.messages[0].content
  assert.equal(userContent[0].type, 'text')
  assert.equal(userContent[0].text, INVENTORIED_IMAGE_PLACEHOLDER)
  // Adjacent text is preserved
  assert.deepEqual(userContent[1], txtBlock('look at this'))
  // Assistant message is unchanged
  assert.deepEqual(r.messages[1], msgs[1])
})

test('stripInventoriedImages: image WITHOUT a following inventory call is preserved', () => {
  // User dropped an image but the agent decided to do something else
  // (e.g. ran a different tool, or just replied with text). We do not
  // strip in that case — the agent may want to look at the image again.
  const msgs = [
    { role: 'user', content: [imgBlock(), txtBlock('what is this?')] },
    { role: 'assistant', content: [txtBlock('I see a button')] },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 0)
  assert.deepEqual(r.messages, msgs, 'no inventory call → image survives')
})

test('stripInventoriedImages: image followed by a DIFFERENT tool call (not inventory) is preserved', () => {
  const msgs = [
    { role: 'user', content: [imgBlock(), txtBlock('save this to the project')] },
    { role: 'assistant', content: [otherTool('save_attachment_to_path')] },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 0, 'save_attachment_to_path does NOT consume the image as analysis')
})

test('stripInventoriedImages: multiple images in one user turn — all stripped if inventoried', () => {
  const msgs = [
    {
      role: 'user',
      content: [imgBlock(), imgBlock(), imgBlock(), txtBlock('three screenshots')],
    },
    { role: 'assistant', content: [inventoryCall()] },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 3)
  assert.equal(r.freedTokensEstimate, 4500)
  // All three image blocks should be placeholders now
  const content = r.messages[0].content
  assert.equal(content.filter((b) => b.type === 'text' && b.text === INVENTORIED_IMAGE_PLACEHOLDER).length, 3)
  // Original adjacent text is still present
  assert.ok(content.some((b) => b.text === 'three screenshots'))
})

test('stripInventoriedImages: multiple turns each with inventoried images — all stripped', () => {
  const msgs = [
    { role: 'user', content: [imgBlock(), txtBlock('image 1')] },
    { role: 'assistant', content: [inventoryCall()] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] },
    { role: 'user', content: [imgBlock(), txtBlock('image 2')] },
    { role: 'assistant', content: [inventoryCall()] },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 2)
  assert.equal(r.freedTokensEstimate, 3000)
})

test('stripInventoriedImages: image as the LAST message (no following assistant) is preserved', () => {
  // This is the just-uploaded screenshot — the agent has not yet
  // analyzed it. Stripping would lose information.
  const msgs = [{ role: 'user', content: [imgBlock(), txtBlock('check this')] }]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 0)
})

test('stripInventoriedImages: assistant follow-up message has BOTH inventory call AND something else — still strips', () => {
  // The agent called the inventory tool then immediately moved on to
  // an edit. The image is still inventoried.
  const msgs = [
    { role: 'user', content: [imgBlock(), txtBlock('see this')] },
    {
      role: 'assistant',
      content: [
        inventoryCall(),
        otherTool('edit_file'),
        txtBlock('analyzing then editing'),
      ],
    },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 1)
})

test('stripInventoriedImages: original messages are NOT mutated (returns new array)', () => {
  const original = [
    { role: 'user', content: [imgBlock(), txtBlock('hi')] },
    { role: 'assistant', content: [inventoryCall()] },
  ]
  const originalSnap = JSON.parse(JSON.stringify(original))
  stripInventoriedImages(original)
  assert.deepEqual(original, originalSnap, 'input must not be mutated — required for safe re-runs')
})

test('stripInventoriedImages: string-content user messages (no image possible) pass through', () => {
  // role:user messages with plain string content cannot contain
  // images. The stripper must skip them cleanly, not crash.
  const msgs = [
    { role: 'user', content: 'just a text message' },
    { role: 'assistant', content: 'reply' },
  ]
  const r = stripInventoriedImages(msgs)
  assert.equal(r.droppedImages, 0)
  assert.deepEqual(r.messages, msgs)
})

test('placeholder text is informative + references the next tool_use for the inventory', () => {
  // If the placeholder is too vague the model might re-ask for the
  // screenshot. Pin that it directs the model to look at the
  // inventory tool output.
  assert.match(INVENTORIED_IMAGE_PLACEHOLDER, /submit_screenshot_inventory/)
  assert.match(INVENTORIED_IMAGE_PLACEHOLDER, /structured inventory/i)
  assert.match(INVENTORIED_IMAGE_PLACEHOLDER, /tool_use/)
})
