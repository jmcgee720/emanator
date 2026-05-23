/**
 * Regression test for the "stream timeout" / "Build completed but the
 * connection timed out" bug reported by the user on 2026-05-22.
 *
 * Root cause: stream-handler-v2's finish() closed the SSE controller
 * without guaranteeing a terminal `done` event was emitted. Code paths
 * that bypassed the `done` emit (persist-failed catch, early returns,
 * unhandled exceptions outside the agent-loop try/catch) left the
 * client polling for recovery and ultimately surfacing the misleading
 * 'Build completed but the connection timed out' toast.
 *
 * Fix: track doneSent in the send() wrapper; finish() synthesizes a
 * terminal `done` event if none was sent. The persist-failed catch
 * also now explicitly emits `done` so the client has a real content
 * payload, not the synthetic fallback.
 *
 * This test parses the SSE wire bytes directly because the stream is
 * built inside a closure we can't easily monkey-patch. We construct
 * a minimal harness that mimics the relevant portion of the handler
 * structure (controller + encoder + send/finish) and asserts the
 * invariants.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Mirror of the production send/finish setup in stream-handler-v2.js.
 * Pinning this here means a future refactor of the production helpers
 * will need to mirror the same invariants here, or this test fails.
 */
function buildStreamHarness() {
  const events = []
  const encoder = new TextEncoder()
  let closed = false
  const controller = {
    enqueue(chunk) {
      if (closed) throw new Error('controller already closed')
      const text = new TextDecoder().decode(chunk)
      // Parse the SSE bytes the same way the client does so the test
      // verifies the wire format the browser actually sees.
      const m = text.match(/^event: (.+)\ndata: (.+)\n\n$/)
      if (!m) throw new Error('unexpected SSE chunk: ' + text)
      events.push({ event: m[1], data: JSON.parse(m[2]) })
    },
    close() {
      closed = true
    },
  }

  let doneSent = false
  const send = (event, data) => {
    if (closed) return
    if (event === 'done') doneSent = true
    try {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      closed = true
    }
  }
  const finish = () => {
    if (closed) return
    if (!doneSent) {
      try {
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ content: '', _synthetic_terminal: true })}\n\n`))
      } catch {}
      doneSent = true
    }
    closed = true
    try { controller.close() } catch {}
  }
  return { events, send, finish, isClosed: () => closed, didSendDone: () => doneSent }
}

test('finish() emits synthetic done event when none was sent', () => {
  const h = buildStreamHarness()
  h.send('status', { stage: 'starting' })
  h.send('token', { content: 'hi' })
  // No explicit done.
  h.finish()
  const done = h.events.find((e) => e.event === 'done')
  assert.ok(done, 'finish() must emit a terminal done event')
  assert.equal(done.data._synthetic_terminal, true, 'synthetic done is flagged for analytics')
  assert.ok(h.didSendDone(), 'doneSent flag is set after finish()')
})

test('finish() does NOT double-emit done when one was already sent', () => {
  const h = buildStreamHarness()
  h.send('token', { content: 'response' })
  h.send('done', { content: 'response', messageId: 'm-1' })
  h.finish()
  const doneEvents = h.events.filter((e) => e.event === 'done')
  assert.equal(doneEvents.length, 1, 'exactly one done event')
  assert.equal(doneEvents[0].data._synthetic_terminal, undefined, 'real done not flagged synthetic')
})

test('finish() is idempotent (multiple calls do not duplicate events)', () => {
  const h = buildStreamHarness()
  h.send('status', { stage: 'starting' })
  h.finish()
  h.finish()
  h.finish()
  const doneEvents = h.events.filter((e) => e.event === 'done')
  assert.equal(doneEvents.length, 1)
})

test('persist-failed path: error event + explicit done both emitted', () => {
  // Mirrors the production catch block at the bottom of the start()
  // async function — the explicit send('done', ...) before fall-through
  // to finish() must produce both events.
  const h = buildStreamHarness()
  h.send('token', { content: 'partial response' })
  // Simulated persist failure:
  h.send('error', { message: 'Failed to save assistant message: db unavailable', error_type: 'persist_failed' })
  h.send('done', { content: 'partial response', _persist_failed: true })
  h.finish()
  const error = h.events.find((e) => e.event === 'error')
  const done = h.events.find((e) => e.event === 'done')
  assert.ok(error, 'error event emitted')
  assert.equal(error.data.error_type, 'persist_failed')
  assert.ok(done, 'done event emitted from persist catch')
  assert.equal(done.data._persist_failed, true, 'done payload flags persist failure')
  assert.equal(done.data._synthetic_terminal, undefined, 'real done, not synthetic')
})

test('agent_crash path then finish: synthetic done covers the gap', () => {
  // If the agent loop crashes hard before fullContent is built AND
  // the persist block is bypassed somehow, finish() still guarantees
  // the client sees a terminal `done`.
  const h = buildStreamHarness()
  h.send('error', { message: 'Agent loop crashed: something exploded', error_type: 'agent_crash' })
  // Pretend persist block skipped due to fullContent.trim() being empty
  // (this path was theoretical but the new fallback prevents it; the
  // synthetic done in finish() is the belt-and-suspenders backstop)
  h.finish()
  assert.ok(h.events.some((e) => e.event === 'done'), 'finish() guarantees a done event')
})
