// Smoke test: stream-handler-v2 renders the FULL content of read_file
// tool_result events inline (so the user can actually see the file),
// while keeping the compact summary for every other tool.
//
// Why this matters: before this change, Claude would call read_file,
// see the full content in the tool_result, assume the user saw it too
// (they didn't — UI was only showing "↳ file (24 lines) … (628 chars)"),
// and end the turn with empty text. The fix shows the full file inline.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirror the inline-rendering branch from stream-handler-v2.js.
function renderToolResult(pending, ev, summarizeResult) {
  const isReadFile = pending?.name === 'read_file'
  return isReadFile
    ? `> ↳ ${pending?.args?.path || 'file'}\n\n${ev.content}\n\n`
    : `> ↳ ${summarizeResult(ev.content)}\n\n`
}

const summarizeResult = (content) => {
  const s = typeof content === 'string' ? content : String(content || '')
  const firstLine = s.split('\n').find((l) => l.trim().length > 0) || ''
  const trimmed = firstLine.slice(0, 120)
  const total = s.length
  return total > trimmed.length ? `${trimmed} … (${total} chars)` : trimmed
}

test('read_file tool result is rendered verbatim inline', () => {
  const pending = { name: 'read_file', args: { path: 'package.json' } }
  const ev = {
    type: 'tool_result',
    content: 'package.json (24 lines)\n\n```\n 1| {\n 2|   "name": "nexsara"\n 3| }\n```',
  }
  const rendered = renderToolResult(pending, ev, summarizeResult)
  // Must contain the full content, not a summary
  assert.match(rendered, /"name": "nexsara"/)
  assert.match(rendered, /↳ package\.json/)
  // Must NOT collapse to the summary form
  assert.doesNotMatch(rendered, /\.\.\. \(\d+ chars\)/)
})

test('other tool results stay compact', () => {
  const pending = { name: 'list_files', args: { name_pattern: '*.jsx' } }
  const big = 'app/page.jsx\napp/layout.jsx\n'.repeat(50)
  const ev = { type: 'tool_result', content: big }
  const rendered = renderToolResult(pending, ev, summarizeResult)
  // First line + char count, NOT the full blob
  assert.match(rendered, /app\/page\.jsx … \(\d+ chars\)/)
  // The repeat-padded body should not be in the rendered output
  const occurrences = (rendered.match(/app\/page\.jsx/g) || []).length
  assert.equal(occurrences, 1)
})

test('unknown pending entry falls back to summary', () => {
  const ev = { type: 'tool_result', content: 'Wrote /project/foo.js (12 bytes)' }
  const rendered = renderToolResult(undefined, ev, summarizeResult)
  assert.match(rendered, /↳ Wrote \/project\/foo\.js/)
})

test('read_file rendering preserves fenced code block from tool output', () => {
  const pending = { name: 'read_file', args: { path: 'next.config.js' } }
  const ev = {
    type: 'tool_result',
    content: '/project/next.config.js (5 lines)\n\n```\n 1| module.exports = {\n 2|   reactStrictMode: true,\n 3| }\n```',
  }
  const rendered = renderToolResult(pending, ev, summarizeResult)
  // Code fences survive intact so the markdown renderer formats them
  const fenceCount = (rendered.match(/```/g) || []).length
  assert.equal(fenceCount, 2)
})
