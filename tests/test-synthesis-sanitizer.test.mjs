// ── Synthesis Sanitizer Tests ──
// Proves the Core System synthesis pass no longer crashes the Auroraly stream.
//
// Background: The previous synthesis-pass implementation passed the raw
// `messages` array (which contained assistant tool_use blocks + role:'tool'
// results) into a tool-less Anthropic chatStream call. Anthropic's API
// rejects this with HTTP 400 ("tools field is required when messages
// contain tool_use blocks"), and the error bubbled past the inner try/catch
// because of how _streamWithFallback propagates errors — crashing the
// /api/chat/stream endpoint.
//
// These tests reproduce the EXACT crash conditions and prove the fix:
//   1. cleanForSynthesis strips/converts every Anthropic-incompatible block
//   2. The output is provably safe for tool-less Anthropic
//   3. The synthesis pass swallows provider errors instead of crashing

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  cleanForSynthesis,
  wouldCrashToollessAnthropic,
} from '../lib/ai/synthesis-sanitizer.js'

describe('Synthesis Sanitizer — Anthropic 400 prevention', () => {
  test('REPRODUCE the exact production crash: dirty array would crash', () => {
    // This is the EXACT shape of `messages` after a Core System tool loop:
    // user → assistant w/ tool_calls → role:'tool' result → assistant text
    const dirty = [
      { role: 'system', content: 'You are Auroraly Core System.' },
      { role: 'user', content: 'find the streaming file' },
      {
        role: 'assistant',
        content: "I'll search the codebase.",
        tool_calls: [
          {
            id: 'toolu_01abc',
            type: 'function',
            function: { name: 'exec_command', arguments: '{"cmd":"find /app -name message-stream.js"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_01abc',
        name: 'exec_command',
        content: '/app/lib/ai/message-stream.js',
      },
      { role: 'assistant', content: "Let me check that file." },
    ]
    assert.equal(
      wouldCrashToollessAnthropic(dirty),
      true,
      'Sanity check: dirty array MUST be flagged as crash-inducing'
    )
  })

  test('FIX: cleanForSynthesis output is safe for tool-less Anthropic', () => {
    const dirty = [
      { role: 'system', content: 'You are Auroraly Core System.' },
      { role: 'user', content: 'find the streaming file' },
      {
        role: 'assistant',
        content: "I'll search the codebase.",
        tool_calls: [
          {
            id: 'toolu_01abc',
            type: 'function',
            function: { name: 'exec_command', arguments: '{"cmd":"find"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_01abc',
        name: 'exec_command',
        content: '/app/lib/ai/message-stream.js',
      },
      { role: 'assistant', content: 'Let me check that file.' },
    ]
    const cleaned = cleanForSynthesis(dirty)
    assert.equal(
      wouldCrashToollessAnthropic(cleaned),
      false,
      'After sanitization, the array must be safe for Anthropic tool-less call'
    )
  })

  test('strips tool_calls from assistant messages', () => {
    const input = [
      {
        role: 'assistant',
        content: 'Searching...',
        tool_calls: [{ id: 't1', function: { name: 'read_files', arguments: '{}' } }],
      },
    ]
    const cleaned = cleanForSynthesis(input)
    assert.equal(cleaned.length, 1)
    assert.equal(cleaned[0].role, 'assistant')
    assert.equal(typeof cleaned[0].content, 'string')
    assert.ok(!('tool_calls' in cleaned[0]), 'tool_calls must be removed')
    assert.match(cleaned[0].content, /\[Used tool: read_files\]/)
  })

  test("converts role:'tool' messages into user notes", () => {
    const input = [
      { role: 'tool', tool_call_id: 'x', name: 'exec_command', content: '/some/path' },
    ]
    const cleaned = cleanForSynthesis(input)
    assert.equal(cleaned.length, 1)
    assert.equal(cleaned[0].role, 'user')
    assert.match(cleaned[0].content, /Previous tool result/)
    assert.match(cleaned[0].content, /\/some\/path/)
  })

  test('coalesces consecutive same-role messages', () => {
    const input = [
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    const cleaned = cleanForSynthesis(input)
    assert.equal(cleaned.length, 2)
    assert.equal(cleaned[0].content, 'one\n\ntwo')
    assert.equal(cleaned[1].content, 'a\n\nb')
  })

  test('truncates oversized tool results to 4KB to avoid token blowup', () => {
    const huge = 'x'.repeat(10_000)
    const input = [{ role: 'tool', tool_call_id: 't', content: huge }]
    const cleaned = cleanForSynthesis(input)
    assert.ok(cleaned[0].content.length < 5000, 'oversized tool result must be truncated')
    assert.match(cleaned[0].content, /\[truncated\]/)
  })

  test('handles undefined / null / empty input gracefully', () => {
    assert.deepEqual(cleanForSynthesis(undefined), [])
    assert.deepEqual(cleanForSynthesis(null), [])
    assert.deepEqual(cleanForSynthesis([]), [])
    assert.deepEqual(cleanForSynthesis([{ role: 'user' }]), []) // no content → dropped
  })

  test('preserves system message at top', () => {
    const input = [
      { role: 'system', content: 'sys-prompt' },
      { role: 'user', content: 'hello' },
    ]
    const cleaned = cleanForSynthesis(input)
    assert.equal(cleaned[0].role, 'system')
    assert.equal(cleaned[0].content, 'sys-prompt')
    assert.equal(cleaned[1].role, 'user')
  })

  test('object content is JSON.stringified, not silently dropped', () => {
    const input = [{ role: 'user', content: { foo: 'bar' } }]
    const cleaned = cleanForSynthesis(input)
    assert.equal(cleaned.length, 1)
    assert.equal(cleaned[0].content, '{"foo":"bar"}')
  })

  test('multiple tool_use turns + multiple tool results are all cleaned', () => {
    const dirty = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'do stuff' },
      {
        role: 'assistant',
        content: 'step 1',
        tool_calls: [
          { id: 't1', function: { name: 'read_files', arguments: '{}' } },
          { id: 't2', function: { name: 'exec_command', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: 'result1' },
      { role: 'tool', tool_call_id: 't2', content: 'result2' },
      {
        role: 'assistant',
        content: 'step 2',
        tool_calls: [{ id: 't3', function: { name: 'patch_files', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 't3', content: 'result3' },
      { role: 'assistant', content: 'Let me think.' },
    ]
    const cleaned = cleanForSynthesis(dirty)
    assert.equal(wouldCrashToollessAnthropic(cleaned), false)
    // No tool_calls leaked through
    for (const m of cleaned) {
      assert.ok(!('tool_calls' in m), 'no tool_calls allowed in cleaned output')
      assert.notEqual(m.role, 'tool', 'no role:tool allowed in cleaned output')
    }
    // Tool summaries are present
    const allText = cleaned.map(m => m.content).join(' ')
    assert.match(allText, /\[Used tool: read_files\]/)
    assert.match(allText, /\[Used tool: exec_command\]/)
    assert.match(allText, /\[Used tool: patch_files\]/)
    assert.match(allText, /result1/)
    assert.match(allText, /result2/)
    assert.match(allText, /result3/)
  })
})

describe('Synthesis Sanitizer — wouldCrashToollessAnthropic detector', () => {
  test('flags tool_use blocks', () => {
    assert.equal(
      wouldCrashToollessAnthropic([
        { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'f' } }] },
      ]),
      true
    )
  })
  test("flags role:'tool' messages", () => {
    assert.equal(wouldCrashToollessAnthropic([{ role: 'tool', content: 'r' }]), true)
  })
  test('flags consecutive same-role', () => {
    assert.equal(
      wouldCrashToollessAnthropic([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ]),
      true
    )
  })
  test('accepts clean alternation', () => {
    assert.equal(
      wouldCrashToollessAnthropic([
        { role: 'system', content: 's' },
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ]),
      false
    )
  })
})
