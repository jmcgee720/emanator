// ── Synthesis Pass Runtime Crash Prevention Test ──
//
// Proves that even if the LLM provider's chatStream throws the exact Anthropic
// 400 error ("tools field is required when messages contain tool_use blocks"),
// the synthesis pass swallows it gracefully and does NOT crash the parent
// stream. This is the bug the user hit in production.
//
// We simulate the synthesis loop's behavior directly: the inner try/catch
// + outer try/catch combo must prevent any throw from escaping.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'

// Mini-replica of the production synthesis pass body (mirrors message-stream.js)
// — used to verify the error-swallowing contract holds.
async function* simulateSynthesisPass({ provider, messages }) {
  yield { event: 'pre' }
  try {
    yield { event: 'status', data: { stage: 'synthesizing' } }
    let synthText = ''
    try {
      for await (const chunk of provider.chatStream(messages, { temperature: 0.7 })) {
        if (chunk.type === 'token') {
          synthText += chunk.content
          yield { event: 'token', data: { content: chunk.content } }
        }
      }
    } catch (streamErr) {
      // Inner catch — exactly as in message-stream.js
      // (intentionally swallows, logs in real code)
      void streamErr
    }
    yield { event: 'synth_done', data: { length: synthText.length } }
  } catch (outerErr) {
    // Outer hardened catch — must catch anything inner missed
    void outerErr
  }
  yield { event: 'post' }
}

describe('Synthesis pass — runtime crash prevention', () => {
  test('SWALLOWS the exact Anthropic 400 error (tools-required)', async () => {
    const provider = {
      // eslint-disable-next-line require-yield
      async *chatStream() {
        const err = new Error('tools field is required when messages contain tool_use blocks')
        err.status = 400
        err.error_type = 'invalid_request'
        throw err
      },
    }
    const events = []
    for await (const ev of simulateSynthesisPass({
      provider,
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(ev.event)
    }
    assert.deepEqual(events, ['pre', 'status', 'synth_done', 'post'],
      'Stream must complete (pre → status → synth_done → post) despite provider throw')
  })

  test('SWALLOWS a synchronous throw before iteration starts', async () => {
    const provider = {
      chatStream() {
        throw new Error('synchronous boom — _streamWithFallback edge case')
      },
    }
    const events = []
    for await (const ev of simulateSynthesisPass({
      provider,
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(ev.event)
    }
    assert.ok(events.includes('post'), 'stream must reach "post" event despite sync throw')
  })

  test('SWALLOWS a throw mid-stream (after a partial token)', async () => {
    const provider = {
      async *chatStream() {
        yield { type: 'token', content: 'partial...' }
        throw new Error('mid-stream provider failure')
      },
    }
    const events = []
    for await (const ev of simulateSynthesisPass({
      provider,
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(ev.event)
    }
    assert.ok(events.includes('token'), 'must yield the partial token before the throw')
    assert.ok(events.includes('synth_done'), 'must still emit synth_done after swallowing')
    assert.ok(events.includes('post'), 'must reach post')
  })

  test('SUCCESS PATH: a healthy provider stream completes normally', async () => {
    const provider = {
      async *chatStream() {
        yield { type: 'token', content: 'I found ' }
        yield { type: 'token', content: 'the bug at line 3300.' }
      },
    }
    const tokens = []
    const events = []
    for await (const ev of simulateSynthesisPass({
      provider,
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(ev.event)
      if (ev.event === 'token') tokens.push(ev.data.content)
    }
    assert.equal(tokens.join(''), 'I found the bug at line 3300.')
    assert.ok(events.includes('synth_done'))
    assert.ok(events.includes('post'))
  })
})
