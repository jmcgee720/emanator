// ──────────────────────────────────────────────────────────────────────
// submit_screenshot_inventory — STRUCTURAL anti-fabrication gate tests
// ──────────────────────────────────────────────────────────────────────
// These tests pin the structural gate that prevents the agent from
// fabricating positive screenshot assessments. Unlike the prompt-text
// tests (which only check the system prompt's wording), these tests
// check the actual tool execution path — the part the model literally
// cannot bypass when forceFirstToolCall is wired.
//
// If any of these regress, the model can revert to "looks good!"
// fabrication on screenshots.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const {
  buildDefaultToolset,
  submitScreenshotInventoryTool,
} = await import(join(ROOT, 'lib/ai/agent-tools-v2.js'))

function makeAttachment(filename, kind = 'image/png') {
  return {
    filename,
    file_category: kind.startsWith('image/') ? 'image' : 'binary',
    mime_type: kind,
    preview_data: 'data:image/png;base64,iVBOR=',
  }
}

const scope = { rootDirs: ['/project-x'], excludePaths: [] }
const fakeWriter = { writeFile: async () => 'ok' }

// ── Toolset wiring ─────────────────────────────────────────────────

test('toolset: includes submit_screenshot_inventory when attachments contain ≥1 image', () => {
  const tools = buildDefaultToolset(scope, fakeWriter, null, [makeAttachment('bug.png')])
  assert.ok(tools.some((t) => t.name === 'submit_screenshot_inventory'), 'inventory tool must be exposed when an image is attached')
})

test('toolset: omits submit_screenshot_inventory when no image attached (PDF only)', () => {
  const tools = buildDefaultToolset(scope, fakeWriter, null, [makeAttachment('doc.pdf', 'application/pdf')])
  assert.ok(!tools.some((t) => t.name === 'submit_screenshot_inventory'), 'inventory tool must not appear for PDF-only attachments')
})

test('toolset: omits submit_screenshot_inventory when no attachments at all', () => {
  const tools = buildDefaultToolset(scope, fakeWriter, null, null)
  assert.ok(!tools.some((t) => t.name === 'submit_screenshot_inventory'), 'inventory tool must not appear without attachments')
  const tools2 = buildDefaultToolset(scope, fakeWriter, null, [])
  assert.ok(!tools2.some((t) => t.name === 'submit_screenshot_inventory'), 'inventory tool must not appear for empty attachment array')
})

// ── Tool schema ────────────────────────────────────────────────────

test('inventory tool: schema requires all five gate fields', () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const req = tool.input_schema.required
  for (const f of ['inventory_per_image', 'comparison_to_user_expectation', 'layout_notes', 'verdict', 'forbidden_positive_phrases_acknowledged']) {
    assert.ok(req.includes(f), `top-level schema must require ${f}`)
  }
})

test('inventory tool: verdict enum is restricted to two values (no "looks good" loophole)', () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const verdictSchema = tool.input_schema.properties.verdict
  assert.deepEqual(verdictSchema.enum.sort(), ['no_problems_visible', 'problems_present'].sort(), 'verdict must be a binary enum — no third option')
})

test('inventory tool: each image entry requires cropped_or_hidden so the model cannot omit cropping', () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const itemReq = tool.input_schema.properties.inventory_per_image.items.required
  assert.ok(itemReq.includes('cropped_or_hidden'), 'per-image cropped_or_hidden must be a required field')
  assert.ok(itemReq.includes('text_quotes'), 'per-image text_quotes must be a required field')
  assert.ok(itemReq.includes('visible_elements'), 'per-image visible_elements must be a required field')
})

// ── Tool execute behaviour ─────────────────────────────────────────

test('inventory execute: REJECTS no_problems_visible verdict when cropped items are listed', async () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const result = await tool.execute({
    inventory_per_image: [{
      attachment_label: 'attachment 1: x.png',
      visible_elements: ['modal at top'],
      text_quotes: ['"User Manag"'],
      cropped_or_hidden: ['top of modal header'],
      colors_and_states: ['blue button'],
    }],
    comparison_to_user_expectation: { user_stated_expectation: 'modal centered', matches: [], mismatches: [] },
    layout_notes: 'modal y=0, header cropped',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /INVENTORY REJECTED/, 'must reject contradictory verdict')
  assert.match(result, /cropped\/hidden items/, 'rejection must explain the contradiction')
})

test('inventory execute: REJECTS no_problems_visible verdict when mismatches are listed', async () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const result = await tool.execute({
    inventory_per_image: [{
      attachment_label: 'attachment 1: x.png',
      visible_elements: ['modal'],
      text_quotes: [],
      cropped_or_hidden: [],
      colors_and_states: [],
    }],
    comparison_to_user_expectation: {
      user_stated_expectation: 'should be centered',
      matches: [],
      mismatches: ['modal at y=0, not centered'],
    },
    layout_notes: 'modal y=0',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /INVENTORY REJECTED/, 'must reject verdict that contradicts mismatches')
  assert.match(result, /mismatches/, 'rejection must mention mismatches')
})

test('inventory execute: REJECTS submission when forbidden_positive_phrases_acknowledged is false', async () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const result = await tool.execute({
    inventory_per_image: [{
      attachment_label: 'attachment 1: x.png',
      visible_elements: ['modal'],
      text_quotes: [],
      cropped_or_hidden: [],
      colors_and_states: [],
    }],
    comparison_to_user_expectation: { user_stated_expectation: '', matches: [], mismatches: [] },
    layout_notes: 'clean layout',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: false,
  })
  assert.match(result, /acknowledgement missing/, 'must require explicit ack of the prohibition')
})

test('inventory execute: ACCEPTS problems_present verdict with cropping/mismatch and returns FORBIDDEN clause', async () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const result = await tool.execute({
    inventory_per_image: [{
      attachment_label: 'attachment 1: x.png',
      visible_elements: ['modal at top'],
      text_quotes: ['"User Manag" (cut off)'],
      cropped_or_hidden: ['top of header is above viewport'],
      colors_and_states: [],
    }],
    comparison_to_user_expectation: { user_stated_expectation: 'centered', matches: [], mismatches: ['modal y=0 → MISMATCH'] },
    layout_notes: 'modal y=0',
    verdict: 'problems_present',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /problems_present/)
  assert.match(result, /FORBIDDEN from saying/, 'must explicitly enumerate forbidden phrases')
  assert.match(result, /looks perfect/, 'must list "looks perfect" as forbidden')
  assert.match(result, /that's fixed/, 'must list "that\'s fixed" as forbidden')
  assert.match(result, /State the specific problems from the inventory/, 'must redirect to stating problems')
})

test('inventory execute: ACCEPTS no_problems_visible verdict only when inventory is genuinely clean', async () => {
  const tool = submitScreenshotInventoryTool([makeAttachment('x.png')])
  const result = await tool.execute({
    inventory_per_image: [{
      attachment_label: 'attachment 1: x.png',
      visible_elements: ['modal centered at y=300', 'Save button visible'],
      text_quotes: ['"User Management"', 'Save', 'Cancel'],
      cropped_or_hidden: [],
      colors_and_states: ['Save button blue enabled'],
    }],
    comparison_to_user_expectation: {
      user_stated_expectation: 'modal should be centered',
      matches: ['modal at y=300, centered → MATCH'],
      mismatches: [],
    },
    layout_notes: 'modal centered, all UI visible',
    verdict: 'no_problems_visible',
    forbidden_positive_phrases_acknowledged: true,
  })
  assert.match(result, /Inventory recorded/, 'clean inventory must be accepted')
  assert.match(result, /no_problems_visible/)
  assert.match(result, /cite a specific inventory item/, 'must still require evidence citation for success claims')
})

// ── Stream-handler wiring ──────────────────────────────────────────

test('stream-handler: wires forceFirstToolCall when ≥1 image attached', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  assert.match(src, /forceFirstToolCall = 'submit_screenshot_inventory'/, 'stream handler must force the inventory tool call on image turns')
  // Detection: either the original `metadata.attachments.some(...)` form or the
  // refactored `.filter(...)` form (post-2026-05 diagnostic logging refactor)
  assert.match(
    src,
    /(hasImage = metadata\.attachments\.some|imageAttachments = metadata\.attachments\.filter)/,
    'must detect images before forcing',
  )
  assert.match(src, /forceFirstToolCall,/, 'must pass the option into runAgent')
})

test('agent-core: respects forceFirstToolCall on iteration 0 only', async () => {
  const src = await readFile(join(ROOT, 'lib/ai/agent-core.js'), 'utf8')
  assert.match(src, /forceFirstToolCall = null/, 'must accept forceFirstToolCall parameter')
  assert.match(src, /forceFirstToolCall && iter === 0/, 'must gate the tool_choice on first iteration only')
  assert.match(src, /tool_choice = \{/s, 'must build the tool_choice object')
})
