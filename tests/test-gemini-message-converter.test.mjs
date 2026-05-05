/**
 * Unit test: GeminiProvider._convertMessages
 *
 * Verifies the OpenAI ↔ Gemini message-shape converter handles:
 *   1) Plain user/assistant chat (role mapping: assistant → model)
 *   2) System message extraction → systemInstruction
 *   3) Assistant tool_calls → role 'model' with functionCall parts
 *   4) tool role → role 'function' with functionResponse parts
 *   5) tool_call_id → name mapping survives across messages
 *   6) String tool result wrapped in {result:...}; JSON parsed if valid
 *   7) Mixed text + tool_calls in one assistant message
 */
import { GeminiProvider } from '../lib/ai/providers/gemini.js'

const provider = new GeminiProvider('fake-key', 'gemini-2.5-pro')

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL: ${label}\n  expected: ${e}\n  got:      ${a}`)
    process.exit(1)
  }
  console.log(`PASS: ${label}`)
}

// 1) Plain chat — assistant → model
{
  const r = provider._convertMessages([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ])
  eq(r.systemInstruction, '', '1: empty systemInstruction')
  eq(r.contents, [
    { role: 'user', parts: [{ text: 'hello' }] },
    { role: 'model', parts: [{ text: 'hi' }] },
  ], '1: assistant role mapped to model')
}

// 2) System extraction
{
  const r = provider._convertMessages([
    { role: 'system', content: 'You are a coder.' },
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'go' },
  ])
  eq(r.systemInstruction, 'You are a coder.\n\nBe concise.', '2: systemInstruction concat')
  eq(r.contents.length, 1, '2: only user message in contents')
}

// 3) Assistant tool_calls → functionCall parts
{
  const r = provider._convertMessages([
    { role: 'user', content: 'what time' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_x', function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }],
    },
  ])
  eq(r.contents[1], {
    role: 'model',
    parts: [{ functionCall: { name: 'get_time', args: { tz: 'UTC' } } }],
  }, '3: tool_calls converted to functionCall part')
}

// 4) Tool result with json content → parsed
{
  const r = provider._convertMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'foo', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"data":42}' },
  ])
  eq(r.contents[2], {
    role: 'function',
    parts: [{ functionResponse: { name: 'foo', response: { ok: true, data: 42 } } }],
  }, '4: tool result with JSON parsed')
}

// 5) Tool result with raw string → wrapped in {result:...}
{
  const r = provider._convertMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c2', function: { name: 'screenshot', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: 'screenshot saved to /tmp/foo.png' },
  ])
  eq(r.contents[2].parts[0].functionResponse.response, { result: 'screenshot saved to /tmp/foo.png' },
    '5: raw string wrapped in {result:...}')
}

// 6) tool_call_id → name mapping
{
  const r = provider._convertMessages([
    { role: 'assistant', content: '', tool_calls: [
      { id: 'a1', function: { name: 'tool_a', arguments: '{}' } },
      { id: 'b1', function: { name: 'tool_b', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'a1', content: 'res a' },
    { role: 'tool', tool_call_id: 'b1', content: 'res b' },
  ])
  eq(r.contents[1].parts[0].functionResponse.name, 'tool_a', '6a: first tool result has tool_a name')
  eq(r.contents[2].parts[0].functionResponse.name, 'tool_b', '6b: second tool result has tool_b name')
}

// 7) Mixed text + tool_calls in assistant
{
  const r = provider._convertMessages([
    { role: 'user', content: 'analyze' },
    { role: 'assistant', content: 'I will use a tool.', tool_calls: [
      { id: 'c3', function: { name: 'analyze', arguments: '{"x":1}' } },
    ] },
  ])
  eq(r.contents[1], {
    role: 'model',
    parts: [
      { text: 'I will use a tool.' },
      { functionCall: { name: 'analyze', args: { x: 1 } } },
    ],
  }, '7: mixed text + functionCall parts')
}

console.log('\nALL TESTS PASSED')
