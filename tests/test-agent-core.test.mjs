// ── Agent Core (v2) Tests ──
//
// These tests prove the Emergent-style behavior of /lib/ai/agent-core.js
// against a scripted fake provider. The key claims being proven:
//
//   1. The loop terminates ONLY when the model emits a text-only response
//      with no tool calls. Narration alone does NOT end the loop unless
//      that's the entire response.
//   2. Tool calls execute in order, results are appended to history, and
//      the loop continues until the model decides to stop.
//   3. Multiple tool calls in one turn are all executed before continuing.
//   4. Tool execution failures surface as error strings to the model — the
//      model gets to decide what to do next. No retry, no recovery, no
//      directive injection.
//   5. Unknown tool names return a clear error to the model.
//   6. Max iterations is a safety ceiling, not a behavior.
//   7. Provider stream errors surface as error events; the loop terminates.
//   8. Abort signals cancel cleanly.
//   9. The done event includes the final messages array (for persistence).
//
// These are the contracts that make Auroraly's chat behave like Emergent.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { runAgent } from '../lib/ai/agent-core.js'

/* ── Helpers ─────────────────────────────────────────────────────────── */

/**
 * Build a fake provider that replays scripted "turns". Each turn is an
 * array of chunks (matching the real provider's output shape).
 */
function fakeProvider(turns, hooks = {}) {
  let i = 0
  return {
    callCount: () => i,
    async *chatWithToolsStream(messages, tools, _options) {
      if (hooks.onCall) hooks.onCall({ turn: i, messages, tools })
      const chunks = turns[i] || []
      i += 1
      for (const c of chunks) {
        if (c.__throw) throw new Error(c.__throw)
        yield c
      }
    },
  }
}

function tool(name, executor, opts = {}) {
  return {
    name,
    description: opts.description || `Test tool ${name}`,
    input_schema: opts.input_schema || { type: 'object', properties: {} },
    execute: executor,
  }
}

function makeToolCall(name, args, id = 'call_' + name) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

async function collect(gen) {
  const events = []
  for await (const ev of gen) events.push(ev)
  return events
}

/* ── Tests ───────────────────────────────────────────────────────────── */

describe('agent-core — termination behavior', () => {
  test('text-only response terminates the loop with reason=text_response', async () => {
    const provider = fakeProvider([
      [{ type: 'token', content: 'Hello, ' }, { type: 'token', content: 'world.' }],
    ])
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'hi', tools: [] })
    )
    const texts = events.filter((e) => e.type === 'text_delta').map((e) => e.content).join('')
    const done = events.find((e) => e.type === 'done')
    assert.equal(texts, 'Hello, world.')
    assert.ok(done, 'must emit a done event')
    assert.equal(done.reason, 'text_response')
    assert.equal(done.iterations, 1)
    assert.equal(provider.callCount(), 1, 'only one provider call needed')
  })

  test('narration WITHOUT tool calls terminates the loop (model decides it is done)', async () => {
    // This is intentional: in Emergent's design, the model has full agency.
    // If it emits text only, we trust it. Narration loops are NOT prevented
    // by post-hoc detectors; they are prevented by the model knowing it has
    // tools and being able to use them. If the model still chooses text-only,
    // that's the model's choice.
    const provider = fakeProvider([
      [{ type: 'token', content: "I'll look at that." }],
    ])
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'find streaming', tools: [] })
    )
    const done = events.find((e) => e.type === 'done')
    assert.ok(done)
    assert.equal(done.reason, 'text_response')
  })
})

describe('agent-core — tool execution and looping', () => {
  test('tool_use → execute → tool_result → next turn → text → done', async () => {
    const provider = fakeProvider([
      // Turn 1: model wants to call read_file
      [
        { type: 'token', content: 'Checking...' },
        { type: 'tool_calls', tool_calls: [makeToolCall('read_file', { path: 'foo.js' })] },
      ],
      // Turn 2: model sees the result and replies with text
      [{ type: 'token', content: 'I see foo.js has the streaming logic.' }],
    ])
    const tools = [tool('read_file', async ({ path }) => `FILE_CONTENT: ${path}`)]
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'find streaming', tools })
    )

    const types = events.map((e) => e.type)
    assert.deepEqual(
      types,
      ['text_delta', 'tool_use', 'tool_result', 'text_delta', 'done'],
      'event order must be: text → tool_use → tool_result → text → done'
    )
    assert.equal(events.find((e) => e.type === 'tool_use').name, 'read_file')
    assert.equal(events.find((e) => e.type === 'tool_result').content, 'FILE_CONTENT: foo.js')
    assert.equal(provider.callCount(), 2)
  })

  test('multiple tool calls in one turn execute IN ORDER before next iteration', async () => {
    const execOrder = []
    const provider = fakeProvider([
      [
        {
          type: 'tool_calls',
          tool_calls: [
            makeToolCall('a', {}, 'id_a'),
            makeToolCall('b', {}, 'id_b'),
            makeToolCall('c', {}, 'id_c'),
          ],
        },
      ],
      [{ type: 'token', content: 'done.' }],
    ])
    const tools = [
      tool('a', async () => { execOrder.push('a'); return 'A_RESULT' }),
      tool('b', async () => { execOrder.push('b'); return 'B_RESULT' }),
      tool('c', async () => { execOrder.push('c'); return 'C_RESULT' }),
    ]
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'do all', tools })
    )
    assert.deepEqual(execOrder, ['a', 'b', 'c'])
    const results = events.filter((e) => e.type === 'tool_result')
    assert.equal(results.length, 3)
    assert.deepEqual(results.map((r) => r.content), ['A_RESULT', 'B_RESULT', 'C_RESULT'])
  })

  test('multi-turn loop runs until model emits text-only (proves Emergent-style continuation)', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('list_files', {})] }],
      [{ type: 'tool_calls', tool_calls: [makeToolCall('read_file', { path: 'b.js' })] }],
      [{ type: 'tool_calls', tool_calls: [makeToolCall('edit_file', { path: 'b.js' })] }],
      [{ type: 'token', content: 'Done editing.' }],
    ])
    const tools = [
      tool('list_files', async () => 'a.js b.js'),
      tool('read_file', async () => 'CONTENT'),
      tool('edit_file', async () => 'EDITED'),
    ]
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'fix b', tools })
    )
    const done = events.find((e) => e.type === 'done')
    assert.ok(done)
    assert.equal(done.iterations, 4, 'should run 4 iterations (3 tool calls + 1 text)')
    assert.equal(events.filter((e) => e.type === 'tool_use').length, 3)
  })
})

describe('agent-core — error handling', () => {
  test('tool execution throw → error string surfaced to model, loop continues', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('boom', {})] }],
      [{ type: 'token', content: 'I saw the error.' }],
    ])
    const tools = [tool('boom', async () => { throw new Error('disk full') })]
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'do thing', tools })
    )
    const result = events.find((e) => e.type === 'tool_result')
    assert.match(result.content, /Error executing boom: disk full/)
    const done = events.find((e) => e.type === 'done')
    assert.ok(done, 'loop continues after tool error — model gets to decide')
  })

  test('unknown tool name → clear error result, loop continues', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('does_not_exist', {})] }],
      [{ type: 'token', content: 'I noticed that tool is unavailable.' }],
    ])
    const events = await collect(
      runAgent({
        provider,
        systemPrompt: 'sys',
        userMessage: 'try unknown',
        tools: [tool('real_one', async () => 'ok')],
      })
    )
    const result = events.find((e) => e.type === 'tool_result')
    assert.match(result.content, /tool "does_not_exist" is not registered/)
    assert.match(result.content, /Available tools: real_one/)
    const done = events.find((e) => e.type === 'done')
    assert.ok(done)
  })

  test('provider stream throws → error event, loop terminates', async () => {
    const provider = fakeProvider([
      [{ __throw: 'rate limit' }],
    ])
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'x', tools: [] })
    )
    const err = events.find((e) => e.type === 'error')
    assert.ok(err)
    assert.match(err.message, /provider stream failed/)
    assert.match(err.message, /rate limit/)
    assert.equal(events.find((e) => e.type === 'done'), undefined)
  })

  test('maxIterations safety ceiling kicks in on infinite tool loops', async () => {
    // Model keeps calling a tool forever — must terminate at the ceiling.
    const provider = {
      async *chatWithToolsStream() {
        yield { type: 'tool_calls', tool_calls: [makeToolCall('forever', {})] }
      },
    }
    const tools = [tool('forever', async () => 'still going')]
    const events = await collect(
      runAgent({
        provider,
        systemPrompt: 'sys',
        userMessage: 'spin',
        tools,
        maxIterations: 3,
      })
    )
    const err = events.find((e) => e.type === 'error')
    assert.ok(err)
    assert.match(err.message, /maxIterations \(3\)/)
    assert.equal(events.filter((e) => e.type === 'tool_use').length, 3)
  })

  test('AbortSignal cancels mid-loop', async () => {
    const ac = new AbortController()
    const provider = {
      async *chatWithToolsStream() {
        yield { type: 'token', content: 'starting...' }
        ac.abort() // cancel during the stream
        yield { type: 'token', content: 'more' }
        yield { type: 'tool_calls', tool_calls: [makeToolCall('x', {})] }
      },
    }
    const events = await collect(
      runAgent({
        provider,
        systemPrompt: 'sys',
        userMessage: 'go',
        tools: [tool('x', async () => 'ok')],
        signal: ac.signal,
      })
    )
    const err = events.find((e) => e.type === 'error')
    assert.ok(err)
    assert.match(err.message, /aborted/)
  })
})

describe('agent-core — invariants & validation', () => {
  test('invalid provider → error', async () => {
    const events = await collect(
      runAgent({ provider: null, systemPrompt: 's', userMessage: 'u', tools: [] })
    )
    assert.match(events[0].message, /provider must implement chatWithToolsStream/)
  })

  test('invalid tools → error', async () => {
    const events = await collect(
      runAgent({
        provider: { chatWithToolsStream: async function* () {} },
        systemPrompt: 's',
        userMessage: 'u',
        tools: 'not-an-array',
      })
    )
    assert.match(events[0].message, /tools must be an array/)
  })

  test('done event includes final messages array', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('foo', {})] }],
      [{ type: 'token', content: 'wrapped' }],
    ])
    const events = await collect(
      runAgent({
        provider,
        systemPrompt: 'sys',
        userMessage: 'go',
        tools: [tool('foo', async () => 'RESULT')],
      })
    )
    const done = events.find((e) => e.type === 'done')
    assert.ok(Array.isArray(done.messages))
    // system + user + assistant(tool_call) + tool + assistant(text)
    // Note: the final assistant text isn't pushed to messages because the
    // loop terminates BEFORE appending; this is intentional (messages
    // represents the persisted history at the moment of termination).
    const roles = done.messages.map((m) => m.role)
    assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool'])
    assert.equal(done.messages[2].tool_calls?.length, 1)
    assert.equal(done.messages[3].tool_call_id, 'call_foo')
    assert.equal(done.messages[3].content, 'RESULT')
  })

  test('priorMessages are included BEFORE the user message', async () => {
    const provider = fakeProvider([[{ type: 'token', content: 'ok' }]])
    let captured
    const wrapper = {
      async *chatWithToolsStream(messages, tools, opts) {
        captured = messages
        yield* provider.chatWithToolsStream(messages, tools, opts)
      },
    }
    await collect(
      runAgent({
        provider: wrapper,
        systemPrompt: 'sys',
        userMessage: 'new question',
        priorMessages: [
          { role: 'user', content: 'old question' },
          { role: 'assistant', content: 'old answer' },
        ],
        tools: [],
      })
    )
    assert.deepEqual(captured.map((m) => m.role), [
      'system',
      'user', // prior
      'assistant', // prior
      'user', // current
    ])
    assert.equal(captured[3].content, 'new question')
  })
})

describe('agent-core — Emergent-style anti-pattern proof', () => {
  test('no "synthesis pass" — loop does NOT fire a follow-up LLM call when text is short', async () => {
    // In the legacy v1, a < 300-char text response would trigger a forced
    // synthesis call. v2 must not do that — short text is a valid terminal
    // response. The model said its piece; the loop ends.
    const provider = fakeProvider([[{ type: 'token', content: 'Yes.' }]])
    const events = await collect(
      runAgent({ provider, systemPrompt: 'sys', userMessage: 'do this work?', tools: [] })
    )
    assert.equal(provider.callCount(), 1, 'must be EXACTLY one provider call, no synthesis')
    assert.equal(events.find((e) => e.type === 'done').iterations, 1)
  })

  test('no "tool_choice forcing" — model receives no tool_choice option from agent-core', async () => {
    let capturedOpts
    const provider = {
      async *chatWithToolsStream(messages, tools, options) {
        capturedOpts = options
        yield { type: 'token', content: 'hi' }
      },
    }
    await collect(
      runAgent({
        provider,
        systemPrompt: 's',
        userMessage: 'u',
        tools: [tool('foo', async () => 'r')],
      })
    )
    assert.equal(capturedOpts.tool_choice, undefined, 'agent-core must NEVER force tool_choice')
  })

  test('no "directive injection" — tool results pass through unchanged', async () => {
    // v1 injected '[SYSTEM: ...]' user messages after every read_files call.
    // v2 must not. The model sees the raw tool result and decides.
    let capturedMessages
    const provider = {
      async *chatWithToolsStream(messages, _tools, _opts) {
        capturedMessages = JSON.parse(JSON.stringify(messages))
        if (messages.length === 2) {
          // First call: history is [system, user] — emit tool_use
          yield { type: 'tool_calls', tool_calls: [makeToolCall('read_file', { path: 'x' })] }
        } else {
          yield { type: 'token', content: 'ok' }
        }
      },
    }
    await collect(
      runAgent({
        provider,
        systemPrompt: 'sys',
        userMessage: 'read x',
        tools: [tool('read_file', async () => 'RAW_FILE_CONTENT')],
      })
    )
    // On the second call the history is: system, user, assistant(tool_call), tool
    // No '[SYSTEM: ...]' directive message should have been injected.
    assert.equal(capturedMessages.length, 4)
    const injected = capturedMessages.find(
      (m) => typeof m.content === 'string' && m.content.startsWith('[SYSTEM:')
    )
    assert.equal(injected, undefined, 'no [SYSTEM:] injection allowed in v2')
    assert.equal(capturedMessages[3].content, 'RAW_FILE_CONTENT')
  })
})
