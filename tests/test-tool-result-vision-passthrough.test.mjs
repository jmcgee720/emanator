// ── Tool result content blocks pass-through ────────────────────────
// Verifies agent-core's tool execution loop preserves array-of-content-blocks
// results (used by screenshot_preview to return text + image to Claude)
// instead of JSON.stringify'ing them. If the JSON.stringify path fires,
// the image base64 becomes opaque text and Claude loses vision into its
// own work.

import test from 'node:test'
import assert from 'node:assert/strict'
import { runAgent } from '../lib/ai/agent-core.js'

// Capture what runAgent pushes into messages[] after a tool call.
// We provide a fake tool that returns content blocks (text + image).
// If agent-core works correctly, the captured tool-message content
// will be the array as-is.

function makeProviderThatCallsToolThenStops(toolName) {
  let callCount = 0
  return {
    model: 'test-claude',
    async *chatWithToolsStream() {
      callCount++
      if (callCount === 1) {
        // First call: emit a tool_use
        yield {
          type: 'tool_calls',
          tool_calls: [{
            id: 'call_abc123',
            function: { name: toolName, arguments: '{}' },
          }],
        }
        return
      }
      // Second call: emit no tool calls → done
      yield { type: 'tool_calls', tool_calls: [] }
    },
  }
}

test('array tool result is passed through (not JSON.stringified) — vision pixels reach Claude', async () => {
  const fakeImageBlocks = [
    { type: 'text', text: 'screenshot of /worldmap' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  ]
  const tool = {
    name: 'screenshot_preview',
    description: 'test',
    input_schema: { type: 'object', properties: {}, required: [] },
    async execute() {
      return fakeImageBlocks
    },
  }

  let capturedToolMessageContent = null
  const events = []
  for await (const ev of runAgent({
    provider: makeProviderThatCallsToolThenStops('screenshot_preview'),
    systemPrompt: 'test',
    userMessage: 'screenshot',
    tools: [tool],
    maxIterations: 3,
  })) {
    events.push(ev)
    if (ev.type === 'tool_result') {
      capturedToolMessageContent = ev.content
    }
    if (ev.type === 'done' || ev.type === 'error') break
  }

  // Critical assertion: the content yielded back must be the array of
  // content blocks, NOT a JSON-stringified blob. If this fails, Claude
  // gets a wall of text containing base64 instead of vision input.
  assert.ok(Array.isArray(capturedToolMessageContent), `expected array, got ${typeof capturedToolMessageContent}`)
  assert.equal(capturedToolMessageContent.length, 2)
  assert.equal(capturedToolMessageContent[0].type, 'text')
  assert.equal(capturedToolMessageContent[1].type, 'image')
  assert.equal(capturedToolMessageContent[1].source.data, 'iVBORw0KGgo=')
})

test('string tool result still works (backward compat)', async () => {
  const tool = {
    name: 'list_files',
    description: 'test',
    input_schema: { type: 'object', properties: {}, required: [] },
    async execute() {
      return 'file1.js\nfile2.js'
    },
  }

  let capturedContent = null
  for await (const ev of runAgent({
    provider: makeProviderThatCallsToolThenStops('list_files'),
    systemPrompt: 'test',
    userMessage: 'list',
    tools: [tool],
    maxIterations: 3,
  })) {
    if (ev.type === 'tool_result') capturedContent = ev.content
    if (ev.type === 'done' || ev.type === 'error') break
  }

  assert.equal(capturedContent, 'file1.js\nfile2.js', 'strings stay strings')
})

test('object tool result still gets JSON.stringified (backward compat)', async () => {
  const tool = {
    name: 'web_search',
    description: 'test',
    input_schema: { type: 'object', properties: {}, required: [] },
    async execute() {
      return { results: [{ url: 'a', title: 'b' }], count: 1 }
    },
  }

  let capturedContent = null
  for await (const ev of runAgent({
    provider: makeProviderThatCallsToolThenStops('web_search'),
    systemPrompt: 'test',
    userMessage: 'search',
    tools: [tool],
    maxIterations: 3,
  })) {
    if (ev.type === 'tool_result') capturedContent = ev.content
    if (ev.type === 'done' || ev.type === 'error') break
  }

  assert.equal(typeof capturedContent, 'string', 'object results get JSON stringified')
  const parsed = JSON.parse(capturedContent)
  assert.equal(parsed.count, 1)
})
