/**
 * Unit test: AnthropicProvider._convertMessages
 *
 * Verifies the OpenAI ↔ Anthropic message-shape converter handles:
 *   1) Plain user/assistant chat (no tools)
 *   2) System message extraction
 *   3) Assistant tool_calls → tool_use blocks (with parsed input)
 *   4) tool role → user message with tool_result block
 *   5) Coalescing consecutive tool results into one user message
 *   6) Mixed text + tool_calls in one assistant message
 */
import { AnthropicProvider } from '../lib/ai/providers/anthropic.js'

const provider = new AnthropicProvider('fake-key', 'claude-sonnet-4-5-20250929')

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL: ${label}\n  expected: ${e}\n  got:      ${a}`)
    process.exit(1)
  }
  console.log(`PASS: ${label}`)
}

// 1) Plain chat
{
  const r = provider._convertMessages([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ])
  eq(r.system, '', '1: empty system')
  eq(r.messages, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ], '1: plain pass-through')
}

// 2) System extraction
{
  const r = provider._convertMessages([
    { role: 'system', content: 'You are a coder.' },
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'go' },
  ])
  eq(r.system, 'You are a coder.\n\nBe concise.', '2: system concatenation')
  eq(r.messages, [{ role: 'user', content: 'go' }], '2: system filtered out of messages')
}

// 3) Assistant w/ tool_calls
{
  const r = provider._convertMessages([
    { role: 'user', content: 'what time is it' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }],
    },
  ])
  eq(r.messages[1], {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'call_1', name: 'get_time', input: { tz: 'UTC' } }],
  }, '3: assistant tool_calls converted to tool_use blocks')
}

// 4) Tool role → tool_result
{
  const r = provider._convertMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_x', function: { name: 'foo', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_x', content: 'result xyz' },
  ])
  eq(r.messages[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'call_x', content: 'result xyz' }],
  }, '4: tool role → user w/ tool_result block')
}

// 5) Coalesce consecutive tool results
{
  const r = provider._convertMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [
      { id: 'a', function: { name: 'f1', arguments: '{}' } },
      { id: 'b', function: { name: 'f2', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'a', content: 'r1' },
    { role: 'tool', tool_call_id: 'b', content: 'r2' },
  ])
  eq(r.messages[2], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'a', content: 'r1' },
      { type: 'tool_result', tool_use_id: 'b', content: 'r2' },
    ],
  }, '5: consecutive tool results coalesced into single user message')
  eq(r.messages.length, 3, '5: only 3 output messages (no extra user msg)')
}

// 6) Mixed text + tool_calls
{
  const r = provider._convertMessages([
    { role: 'user', content: 'analyze' },
    { role: 'assistant', content: 'I will use a tool.', tool_calls: [
      { id: 'c1', function: { name: 'analyze', arguments: '{"x":1}' } },
    ] },
  ])
  eq(r.messages[1], {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will use a tool.' },
      { type: 'tool_use', id: 'c1', name: 'analyze', input: { x: 1 } },
    ],
  }, '6: mixed text + tool_use blocks')
}

// 7) Bad JSON arguments fall back to {}
{
  const r = provider._convertMessages([
    { role: 'assistant', content: '', tool_calls: [
      { id: 'bad', function: { name: 'f', arguments: 'not-json' } },
    ] },
  ])
  eq(r.messages[0].content[0].input, {}, '7: malformed args fall back to empty object')
}

console.log('\nALL TESTS PASSED')
