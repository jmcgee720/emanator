// ──────────────────────────────────────────────────────────────────────
// Context compactor — keeps long chats under Claude's 200K-token ceiling
// ──────────────────────────────────────────────────────────────────────
// Pins:
//   1. Token estimation heuristic (4 chars/token, +1500 for images)
//   2. Compaction trigger threshold (130K, leaves 70K headroom)
//   3. Keeps the last 10 messages verbatim — recency matters more
//      than long-tail context
//   4. Compaction fall-through behavior: a failed summary call must
//      NOT crash the chat — it falls back to un-compacted messages
//      and lets the error-classifier surface the 200K message
//   5. Improved error message for "prompt is too long" — tells user
//      to start a fresh chat instead of "try a different model"

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  estimateTokens,
  estimateMessagesTokens,
  shouldCompact,
  renderTranscriptForSummary,
  compactMessages,
  maybeCompactPriorMessages,
} from '../lib/ai/context-compactor.js'
import { classifyProviderError } from '../lib/ai/errors.js'

// ── Token estimation ─────────────────────────────────────────────

test('estimateTokens: string content uses ~4 chars/token', () => {
  assert.equal(estimateTokens('hello'), 2, '5 chars / 4 = 2 (rounded up)')
  assert.equal(estimateTokens('a'.repeat(400)), 100)
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
})

test('estimateTokens: image blocks count as 1500 tokens each', () => {
  const content = [
    { type: 'image', source: { type: 'base64', data: 'x' } },
    { type: 'text', text: 'a'.repeat(400) },
  ]
  // 1500 (image) + 100 (text) = 1600
  assert.equal(estimateTokens(content), 1600)
})

test('estimateTokens: tool_use and tool_result blocks count their content', () => {
  const content = [
    { type: 'tool_use', name: 'read_file', input: { path: 'foo.js' } },
    { type: 'tool_result', tool_use_id: 'x', content: 'a'.repeat(800) },
  ]
  const t = estimateTokens(content)
  // tool_use: ~JSON.stringify('{"path":"foo.js"}') = 17 chars / 4 = 5 + 50 overhead = 55
  // tool_result: 800 / 4 = 200 + 20 overhead = 220
  assert.ok(t >= 270 && t <= 280, `expected ~275, got ${t}`)
})

test('estimateMessagesTokens: sums across a message array with per-message overhead', () => {
  const msgs = [
    { role: 'user', content: 'a'.repeat(400) },
    { role: 'assistant', content: 'b'.repeat(400) },
  ]
  // 100 + 5 + 100 + 5 = 210
  assert.equal(estimateMessagesTokens(msgs), 210)
})

// ── shouldCompact decision ───────────────────────────────────────

test('shouldCompact: returns false for small chats under threshold', () => {
  const msgs = Array.from({ length: 5 }, () => ({ role: 'user', content: 'short' }))
  const d = shouldCompact(msgs)
  assert.equal(d.shouldCompact, false)
})

test('shouldCompact: returns true for large chats above the default 130K threshold', () => {
  // Each message ~10K tokens (40K chars) × 30 = 300K tokens total
  const big = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x'.repeat(40_000),
  }))
  const d = shouldCompact(big)
  assert.equal(d.shouldCompact, true)
  assert.ok(d.totalTokens > 130_000, 'must report tokens > threshold')
  assert.equal(d.splitAt, 30 - 10, 'must keep last 10 verbatim')
})

test('shouldCompact: returns false if there are not enough older messages to compact (<2 to summarize)', () => {
  // Only 11 messages — keeping 10 leaves 1 to summarize, which is
  // not worth it. shouldCompact must say no.
  const msgs = Array.from({ length: 11 }, () => ({ role: 'user', content: 'x'.repeat(80_000) }))
  const d = shouldCompact(msgs)
  // 11 messages × ~20K tokens = ~220K — over threshold, but only 1
  // message to compact (msgs[0]), which we deliberately skip.
  assert.equal(d.shouldCompact, false)
})

test('shouldCompact: respects custom threshold + keepRecent', () => {
  const msgs = Array.from({ length: 20 }, () => ({ role: 'user', content: 'x'.repeat(4000) })) // ~1K tokens each
  const d = shouldCompact(msgs, { thresholdTokens: 5_000, keepRecent: 5 })
  assert.equal(d.shouldCompact, true)
  assert.equal(d.splitAt, 15, 'must keep last 5 with custom keepRecent')
})

// ── Transcript rendering ─────────────────────────────────────────

test('renderTranscriptForSummary: includes role labels and text content', () => {
  const t = renderTranscriptForSummary([
    { role: 'user', content: 'fix the login bug' },
    { role: 'assistant', content: 'looking into it' },
  ])
  assert.match(t, /### user[\s\S]*fix the login bug/)
  assert.match(t, /### assistant[\s\S]*looking into it/)
})

test('renderTranscriptForSummary: replaces image blocks with placeholder', () => {
  const t = renderTranscriptForSummary([
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', data: 'x' } },
        { type: 'text', text: 'see attached' },
      ],
    },
  ])
  assert.match(t, /\[image attachment\]/, 'must replace image with text placeholder')
  assert.match(t, /see attached/, 'must preserve adjacent text')
})

test('renderTranscriptForSummary: truncates long tool results', () => {
  const t = renderTranscriptForSummary([
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'x', content: 'a'.repeat(2000) }],
    },
  ])
  assert.match(t, /\[truncated\]/, 'long tool_result must be truncated with a marker')
  assert.ok(t.length < 2000, 'truncated result must be shorter than original')
})

// ── maybeCompactPriorMessages integration ────────────────────────

test('maybeCompactPriorMessages: returns messages unchanged when under threshold', async () => {
  const small = [{ role: 'user', content: 'hi' }]
  const r = await maybeCompactPriorMessages(small, null)
  assert.equal(r.didCompact, false)
  assert.deepEqual(r.messages, small)
})

test('maybeCompactPriorMessages: returns unchanged when provider is null even if over threshold', async () => {
  const big = Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(40_000) }))
  const r = await maybeCompactPriorMessages(big, null)
  assert.equal(r.didCompact, false, 'no provider → cannot summarize → return unchanged')
  assert.equal(r.messages.length, 30)
})

test('maybeCompactPriorMessages: compacts when over threshold + provider succeeds', async () => {
  const big = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x'.repeat(40_000),
  }))
  const fakeProvider = {
    chat: async () => ({ content: 'GOAL: testing; FILES: foo.js; STATUS: ok.' }),
  }
  const r = await maybeCompactPriorMessages(big, fakeProvider)
  assert.equal(r.didCompact, true)
  // Result must have a summary message + the kept tail
  assert.equal(r.messages.length, 1 + 10, '1 summary + 10 verbatim tail')
  const summaryBlock = r.messages[0]
  assert.equal(summaryBlock.role, 'user')
  assert.ok(Array.isArray(summaryBlock.content))
  assert.match(summaryBlock.content[0].text, /PRIOR CONTEXT SUMMARY/)
  assert.match(summaryBlock.content[0].text, /GOAL: testing/)
})

test('maybeCompactPriorMessages: falls through gracefully on summary provider failure', async () => {
  const big = Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(40_000) }))
  const failingProvider = {
    chat: async () => { throw new Error('rate limit') },
  }
  const r = await maybeCompactPriorMessages(big, failingProvider)
  assert.equal(r.didCompact, false, 'provider error must NOT crash the turn')
  assert.equal(r.messages.length, 30, 'must fall back to original messages')
  assert.equal(r.error, 'rate limit', 'must surface error reason for logging')
})

// ── compactMessages building block ───────────────────────────────

test('compactMessages: builds a labeled summary message with the provider response', async () => {
  const msgs = Array.from({ length: 10 }, () => ({ role: 'user', content: 'something' }))
  const fakeProvider = { chat: async () => ({ content: 'short summary text' }) }
  const result = await compactMessages(msgs, 5, fakeProvider)
  assert.equal(result.role, 'user')
  assert.match(result.content[0].text, /\[PRIOR CONTEXT SUMMARY/)
  assert.match(result.content[0].text, /short summary text/)
  assert.match(result.content[0].text, /5 messages were summarized/)
})

test('compactMessages: caps transcript size before sending to summarizer', async () => {
  // If we have 1M chars of transcript, the summarizer call must NOT
  // receive it raw — it would overflow Haiku's input limit too.
  let receivedPromptLength = 0
  const fakeProvider = {
    chat: async (messages) => {
      receivedPromptLength = messages[0].content.length
      return { content: 'ok' }
    },
  }
  const huge = Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(200_000) }))
  await compactMessages(huge, 5, fakeProvider)
  // Cap is 500K + summary-instruction prefix (~1.5K) — let's allow up to 510K total
  assert.ok(receivedPromptLength < 510_000, `expected capped prompt < 510K chars, got ${receivedPromptLength}`)
})

// ── errors.js: improved 200K error message ───────────────────────

test('classifyProviderError: 200K context overflow → context_overflow type with clear instructions', () => {
  const e = classifyProviderError(
    {
      message: 'Claude Sonnet 4.5 returned an error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 204309 tokens > 200000 maximum"}}',
    },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  assert.equal(e.error_type, 'context_overflow', 'must classify as context_overflow, not generic billing')
  assert.match(e.user_message, /204,309 tokens/, 'must echo actual token count from the error')
  assert.match(e.user_message, /200,000/, 'must echo the max')
  assert.match(e.user_message, /start a fresh chat/i, 'must suggest the actual fix')
  assert.match(e.user_message, /Switching models will NOT help/, 'must dispel the misleading "try a different model" advice')
})

test('classifyProviderError: 200K overflow without exact numbers still classifies correctly', () => {
  // Some Anthropic responses omit the exact count. Generic handler
  // must still catch the phrase and route correctly.
  const e = classifyProviderError(
    { message: 'prompt is too long' },
    'anthropic',
    'claude-sonnet-4-5-20250929',
  )
  assert.equal(e.error_type, 'context_overflow')
  assert.match(e.user_message, /200,000/)
})
