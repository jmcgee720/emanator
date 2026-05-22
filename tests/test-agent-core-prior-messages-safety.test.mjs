/**
 * Regression test for the "Agent loop crashed: priorMessages is not defined"
 * bug reported by the user on 2026-05-22.
 *
 * The user saw the agent crash with that exact ReferenceError-style message
 * in project chats. Even if a non-array (null/undefined) somehow reached
 * agent-core's spread, the loop must not crash — it should run with an
 * empty history instead.
 *
 * This test simulates that case directly against runAgent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAgent } from '../lib/ai/agent-core.js'

/**
 * Minimal stub provider that emits no tool calls so runAgent terminates
 * after a single iteration with type:'done'.
 */
function makeStubProvider() {
  return {
    async *chatWithToolsStream() {
      yield { type: 'token', content: 'ok' }
      yield { type: 'tool_calls', tool_calls: [] }
    },
  }
}

async function collectEvents(gen) {
  const out = []
  for await (const ev of gen) out.push(ev)
  return out
}

test('runAgent: null priorMessages does NOT throw ReferenceError', async () => {
  const events = await collectEvents(
    runAgent({
      provider: makeStubProvider(),
      systemPrompt: 'sys',
      userMessage: 'hi',
      tools: [],
      priorMessages: null,
    }),
  )
  const errors = events.filter((e) => e.type === 'error')
  assert.equal(errors.length, 0, `should not error, got: ${JSON.stringify(errors)}`)
  const done = events.find((e) => e.type === 'done')
  assert.ok(done, 'should emit done')
})

test('runAgent: undefined priorMessages does NOT throw ReferenceError', async () => {
  const events = await collectEvents(
    runAgent({
      provider: makeStubProvider(),
      systemPrompt: 'sys',
      userMessage: 'hi',
      tools: [],
      priorMessages: undefined,
    }),
  )
  const errors = events.filter((e) => e.type === 'error')
  assert.equal(errors.length, 0)
})

test('runAgent: non-array priorMessages (object) does NOT throw', async () => {
  const events = await collectEvents(
    runAgent({
      provider: makeStubProvider(),
      systemPrompt: 'sys',
      userMessage: 'hi',
      tools: [],
      priorMessages: { 0: 'not-an-array' },
    }),
  )
  const errors = events.filter((e) => e.type === 'error')
  assert.equal(errors.length, 0)
})

test('runAgent: omitted priorMessages defaults to empty array (sanity)', async () => {
  const events = await collectEvents(
    runAgent({
      provider: makeStubProvider(),
      systemPrompt: 'sys',
      userMessage: 'hi',
      tools: [],
    }),
  )
  const errors = events.filter((e) => e.type === 'error')
  assert.equal(errors.length, 0)
})

test('runAgent: valid array priorMessages flows through unchanged', async () => {
  let observedMessages = null
  const provider = {
    async *chatWithToolsStream(messages) {
      observedMessages = messages
      yield { type: 'tool_calls', tool_calls: [] }
    },
  }
  await collectEvents(
    runAgent({
      provider,
      systemPrompt: 'sys',
      userMessage: 'latest',
      tools: [],
      priorMessages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
      ],
    }),
  )
  assert.ok(observedMessages, 'provider should have been called')
  // system + 2 prior + 1 current = 4
  assert.equal(observedMessages.length, 4)
  assert.equal(observedMessages[0].role, 'system')
  assert.equal(observedMessages[1].content, 'first')
  assert.equal(observedMessages[2].content, 'reply')
  assert.equal(observedMessages[3].content, 'latest')
})
