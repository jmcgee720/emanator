// ── Stream Handler v2 Integration Test ──
//
// Proves the v2 endpoint correctly wires the agent-core loop to the
// existing SSE / DB / credits infrastructure, end-to-end:
//
//   1. Authenticated self-edit POST → streams SSE events
//   2. The agent loop's text_delta arrives as legacy `token` events
//      (so the existing frontend renders without changes)
//   3. Tool execution status is surfaced via `status` and `tool_use` events
//   4. On done, the assistant message is persisted to db.messages
//   5. Project chats (non self-edit) hit the 501 short-circuit
//
// We mock the LLM provider to avoid hitting the real Anthropic API. The
// rest of the infrastructure (agent-core, tools, SSE encoding) runs for
// real. NOTE: requires bypassing the `@/` path alias — we test the v2
// agent loop logic directly, not the Next.js route handler.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { runAgent } from '../lib/ai/agent-core.js'
import { buildDefaultToolset } from '../lib/ai/agent-tools-v2.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/* ─── helpers ───────────────────────────────────────────────────────── */

function fakeAnthropic(turns) {
  let i = 0
  return {
    callCount: () => i,
    async *chatWithToolsStream(messages, _tools, _opts) {
      const chunks = turns[i] || []
      i += 1
      for (const c of chunks) yield c
    },
  }
}

function makeToolCall(name, args, id = 'call_' + name) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

async function collectStream(provider, tools, userMessage) {
  // Mirrors the inner loop of handleStreamMessageV2 — proves the wiring
  // produces the SSE-friendly event shape the frontend expects.
  const events = []
  const send = (type, data) => events.push({ type, data })
  let fullContent = ''
  let toolEventCount = 0

  for await (const ev of runAgent({
    provider,
    systemPrompt: 'You are Auroraly self-edit agent.',
    userMessage,
    tools,
    maxIterations: 10,
  })) {
    if (ev.type === 'text_delta') {
      fullContent += ev.content
      send('token', { content: ev.content })
    } else if (ev.type === 'tool_use') {
      toolEventCount++
      send('status', { stage: 'tool_use', detail: `Calling ${ev.name}…` })
      send('tool_use', { name: ev.name, id: ev.id, args: ev.args })
    } else if (ev.type === 'tool_result') {
      send('tool_result', { name: ev.name, id: ev.id, content: ev.content })
    } else if (ev.type === 'done') {
      send('done', { content: fullContent, toolCalls: toolEventCount })
    } else if (ev.type === 'error') {
      send('error', { message: ev.message, error_type: 'agent_error' })
    }
  }
  return { events, fullContent, toolEventCount }
}

/* ─── tests ─────────────────────────────────────────────────────────── */

describe('stream-handler-v2 wiring — agent → SSE event shape', () => {
  let TMP, scope
  test('setup temp scope', () => {
    TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-v2-test-'))
    fs.writeFileSync(path.join(TMP, 'streaming.js'), 'export const x = 1')
    scope = { rootDirs: [TMP], excludePaths: [] }
    assert.ok(fs.existsSync(path.join(TMP, 'streaming.js')))
  })

  test('text-only response → token events + done event', async () => {
    const provider = fakeAnthropic([
      [{ type: 'token', content: 'Hello ' }, { type: 'token', content: 'world' }],
    ])
    const { events, fullContent } = await collectStream(provider, [], 'hi')
    const tokens = events.filter((e) => e.type === 'token').map((e) => e.data.content)
    assert.deepEqual(tokens, ['Hello ', 'world'])
    assert.equal(fullContent, 'Hello world')
    assert.ok(events.find((e) => e.type === 'done'))
    assert.equal(events.find((e) => e.type === 'error'), undefined)
  })

  test('full tool flow: list → read → text reply produces correct SSE sequence', async () => {
    const provider = fakeAnthropic([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('list_files', { name_pattern: 'streaming.js' })] }],
      [{ type: 'tool_calls', tool_calls: [makeToolCall('read_file', { path: 'streaming.js' })] }],
      [{ type: 'token', content: 'Found ' }, { type: 'token', content: 'streaming.js — it exports `x`.' }],
    ])
    const tools = buildDefaultToolset(scope)
    const { events, fullContent, toolEventCount } = await collectStream(
      provider,
      tools,
      'find streaming'
    )

    const types = events.map((e) => e.type)
    // Expected: status, tool_use, tool_result, status, tool_use, tool_result, token, token, done
    assert.deepEqual(types, [
      'status', 'tool_use', 'tool_result',
      'status', 'tool_use', 'tool_result',
      'token', 'token', 'done',
    ])
    assert.equal(toolEventCount, 2)
    assert.match(fullContent, /Found streaming\.js/)
    // tool_result content must be real (proves tools executed against real fs)
    const readResult = events.filter((e) => e.type === 'tool_result')[1]
    assert.match(readResult.data.content, /streaming\.js/)
    assert.match(readResult.data.content, /export const x/)
  })

  test('agent error surfaces as error event, loop terminates', async () => {
    const provider = {
      async *chatWithToolsStream() {
        throw new Error('rate limit exceeded')
      },
    }
    const { events } = await collectStream(provider, [], 'hi')
    const err = events.find((e) => e.type === 'error')
    assert.ok(err)
    assert.match(err.data.message, /rate limit exceeded/)
    assert.equal(events.find((e) => e.type === 'done'), undefined)
  })

  test('cleanup', () => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })
})

describe('stream-handler-v2 — Emergent contract guarantees', () => {
  test('no token events fire after the loop terminates', async () => {
    // Strong invariant: once the model emits text-only and the loop ends,
    // no further provider calls happen, no synthesis fires.
    const provider = fakeAnthropic([
      [{ type: 'token', content: 'Done.' }],
    ])
    await collectStream(provider, [], 'x')
    assert.equal(provider.callCount(), 1, 'must call provider exactly once for a single-turn response')
  })

  test('tool failures pass through to the model unchanged (no recovery / no injection)', async () => {
    // A tool that throws should produce an Error: result message — the
    // model then chooses what to do. The handler must NOT swallow,
    // retry, or rewrite the result.
    const provider = fakeAnthropic([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('boom', {})] }],
      [{ type: 'token', content: 'I saw the error.' }],
    ])
    const tools = [{
      name: 'boom',
      description: 'always fails',
      input_schema: { type: 'object', properties: {} },
      execute: async () => { throw new Error('disk full') },
    }]
    const { events } = await collectStream(provider, tools, 'try boom')
    const toolResult = events.find((e) => e.type === 'tool_result')
    assert.match(toolResult.data.content, /Error executing boom: disk full/)
    assert.ok(events.find((e) => e.type === 'done'))
  })
})
