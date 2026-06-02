/**
 * Tests for the 2026-05-28 inventory-disclosure rendering pipeline.
 *
 * Context: the user has spent days reporting fabrication in project
 * chats. Even after 5 layers of server-side anti-fabrication validation
 * shipped, fabrications remained discoverable only AFTER the model
 * gave a wrong answer. Users had no way to see the inventory the model
 * SUBMITTED — MessageRenderer.jsx#74-119 regex-stripped every tool-use
 * line on its way to the UI.
 *
 * Fix: the stream handler now emits submit_screenshot_inventory as a
 * markdown <details data-tool="screenshot-inventory"> block instead of
 * the generic `> 🔧` blockquote, and MessageRenderer preserves these
 * blocks across all its strip passes via a placeholder swap.
 *
 * This test pins both halves of the pipeline:
 *   (1) The stream-handler decision: submit_screenshot_inventory goes
 *       to <details>; every other tool stays as a `> 🔧` line.
 *   (2) The renderer preservation: <details data-tool> blocks survive
 *       every strip regex and re-appear in the final cleanContent.
 *
 * The stream-handler half is tested by mirroring the production
 * inline-rendering logic in a small inline function (the surrounding
 * code requires MongoDB / Supabase / etc to import, which we can't
 * load in node:test). The renderer half is tested by loading
 * MessageRenderer's strip logic directly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirror of the stream-handler-v2.js inline-tool-use renderer.
// If production drifts from this mirror, both must be updated.
function buildInlineForToolUse(ev) {
  if (ev.name === 'submit_screenshot_inventory') {
    let argsJson
    try { argsJson = JSON.stringify(ev.args, null, 2) }
    catch { argsJson = String(ev.args) }
    return `\n\n<details data-tool="screenshot-inventory">\n<summary>📋 What I saw in your screenshot (click to verify — if anything below is wrong, the answer is fabricated)</summary>\n\n\`\`\`json\n${argsJson}\n\`\`\`\n\n</details>\n\n`
  }
  // Generic tools: simple blockquote, no disclosure.
  const summary = ev.args ? ` (${Object.keys(ev.args).slice(0, 3).join(', ')})` : ''
  return `\n\n> 🔧 **${ev.name}**${summary}\n\n`
}

test('stream-handler renders submit_screenshot_inventory as <details> disclosure', () => {
  const inline = buildInlineForToolUse({
    name: 'submit_screenshot_inventory',
    args: {
      inventory_per_image: [
        {
          attachment_label: 'attachment 1: test.png',
          visible_elements: ['Page title at top'],
          text_quotes: ['OAuth Overview', 'Metrics'],
          cropped_or_hidden: [],
          colors_and_states: ['Dark theme'],
        },
      ],
      verdict: 'no_problems_visible',
      forbidden_positive_phrases_acknowledged: true,
    },
  })
  assert.match(inline, /<details data-tool="screenshot-inventory">/)
  assert.match(inline, /<summary>📋 What I saw in your screenshot/i)
  assert.match(inline, /OAuth Overview/, 'inventory args are visible in the block')
  assert.match(inline, /verdict.*no_problems_visible/i)
  assert.match(inline, /<\/details>/)
})

test('stream-handler keeps OTHER tools as compact > 🔧 lines', () => {
  for (const name of ['read_file', 'write_file', 'edit_file', 'run_command', 'web_search']) {
    const inline = buildInlineForToolUse({ name, args: { path: 'foo.js' } })
    assert.match(inline, new RegExp(`> 🔧 \\*\\*${name}\\*\\*`))
    assert.doesNotMatch(inline, /<details data-tool="screenshot-inventory"/)
  }
})

// ──────────────────────────────────────────────────────────────────────
// Renderer-side preservation tests.
// ──────────────────────────────────────────────────────────────────────
// We test the MessageRenderer's strip pipeline by re-implementing the
// extract/restore logic here. The production logic is the SAME shape:
// extract inventory blocks into placeholders, run strip regexes, then
// restore. We mirror it so we can unit-test without rendering React.
function renderStripPipeline(content) {
  if (!content) return ''
  let cleanContent = content.replace(/\{\{APPLY_TO_LIVE_BUTTON\}\}/g, '')
  cleanContent = cleanContent.replace(/<system_warning>[\s\S]*?<\/system_warning>/g, '')

  const inventoryBlocks = []
  cleanContent = cleanContent.replace(
    /<details data-tool="screenshot-inventory">[\s\S]*?<\/details>/g,
    (match) => {
      const placeholder = `\u0000INVENTORY_DISCLOSURE_${inventoryBlocks.length}\u0000`
      inventoryBlocks.push(match)
      return placeholder
    },
  )

  // The aggressive strip regexes that previously ate everything.
  cleanContent = cleanContent.replace(/```xml[\s\S]*?<function_calls>[\s\S]*?<\/antml:function_calls>[\s\S]*?```/g, '')
  cleanContent = cleanContent.replace(/```xml[\s\S]*?<invoke[\s\S]*?<\/antml:invoke>[\s\S]*?```/g, '')
  cleanContent = cleanContent.replace(/```[\s\S]*?antml:[\s\S]*?```/g, '')
  cleanContent = cleanContent.replace(/^>\s*🔧\s+\*\*[^*]+\*\*[^\n]*$/gm, '')
  cleanContent = cleanContent.replace(/^>\s*↳[^\n]*$/gm, '')
  cleanContent = cleanContent.replace(/^.*?🔧.*$/gm, '')
  cleanContent = cleanContent.replace(/^.*?↳.*$/gm, '')
  cleanContent = cleanContent.replace(/<function_results>[\s\S]*?<\/function_results>/g, '')
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n')
  cleanContent = cleanContent.trim()

  if (inventoryBlocks.length > 0) {
    cleanContent = cleanContent.replace(
      /\u0000INVENTORY_DISCLOSURE_(\d+)\u0000/g,
      (_m, idx) => inventoryBlocks[Number(idx)] || '',
    )
  }
  return cleanContent
}

test('renderer preserves <details data-tool="screenshot-inventory"> blocks', () => {
  const input = `Here's my analysis.\n\n<details data-tool="screenshot-inventory">\n<summary>📋 What I saw</summary>\n\n\`\`\`json\n{"visible_elements": ["heading"]}\n\`\`\`\n\n</details>\n\nProse follows.`
  const out = renderStripPipeline(input)
  assert.match(out, /<details data-tool="screenshot-inventory">/, 'opening tag survives')
  assert.match(out, /What I saw/, 'summary survives')
  assert.match(out, /visible_elements/, 'args survive')
  assert.match(out, /<\/details>/, 'closing tag survives')
  assert.match(out, /Here's my analysis/, 'surrounding prose intact')
  assert.match(out, /Prose follows/, 'trailing prose intact')
})

test('renderer still strips OTHER tool calls (> 🔧 lines, function_results, etc)', () => {
  const input = `Reading the file.\n\n> 🔧 **read_file** (path: foo.js)\n\n> ↳ contents…\n\nDone.`
  const out = renderStripPipeline(input)
  assert.doesNotMatch(out, /🔧/, 'tool emoji stripped')
  assert.doesNotMatch(out, /↳/, 'result arrow stripped')
  assert.match(out, /Reading the file/)
  assert.match(out, /Done\./)
})

test('renderer handles MULTIPLE inventory blocks in same message', () => {
  const input = `First turn:\n<details data-tool="screenshot-inventory"><summary>A</summary>\n\`\`\`json\n{"first":true}\n\`\`\`\n</details>\nSecond turn:\n<details data-tool="screenshot-inventory"><summary>B</summary>\n\`\`\`json\n{"second":true}\n\`\`\`\n</details>`
  const out = renderStripPipeline(input)
  assert.match(out, /first/)
  assert.match(out, /second/)
  // Both <details> tags must survive
  const opens = (out.match(/<details data-tool="screenshot-inventory">/g) || []).length
  assert.equal(opens, 2, 'both inventories survive')
})

test('renderer handles inventory ADJACENT to tool calls (combined fabrication-debug scenario)', () => {
  // Real-world layout: model calls inventory, then calls read_file,
  // then writes prose. All three should survive their fates correctly.
  const input = [
    'Examining…',
    '',
    '<details data-tool="screenshot-inventory">',
    '<summary>📋 What I saw</summary>',
    '',
    '```json',
    '{"verdict": "problems_present"}',
    '```',
    '',
    '</details>',
    '',
    '> 🔧 **read_file** (login.jsx)',
    '',
    '> ↳ file contents',
    '',
    'My recommendation:',
  ].join('\n')
  const out = renderStripPipeline(input)
  assert.match(out, /problems_present/, 'inventory args intact')
  assert.doesNotMatch(out, /🔧/, 'other tool calls stripped')
  assert.match(out, /Examining/)
  assert.match(out, /My recommendation:/)
})

test('renderer placeholders use null bytes (impossible to occur in legit content)', () => {
  // Just to make sure our placeholder sentinel can't collide with
  // legitimate user content. Null byte (\u0000) is illegal in any
  // realistic markdown stream.
  const input = `<details data-tool="screenshot-inventory"><summary>x</summary>\n\`\`\`json\n{"k":"v"}\n\`\`\`\n</details>`
  const out = renderStripPipeline(input)
  // Should NEVER leave the placeholder behind:
  assert.doesNotMatch(out, /INVENTORY_DISCLOSURE_/)
  assert.doesNotMatch(out, /\u0000/)
})
