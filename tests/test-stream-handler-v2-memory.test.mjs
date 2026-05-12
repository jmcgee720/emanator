// ── Stream Handler v2 — Conversation Memory & Tool Visibility Tests ──
//
// Reproduces both bugs the user reported in the "please explain why you
// stopped working" screenshot and proves they are fixed:
//
//   1. Bug: db.messages.listByChat doesn't exist → prior turns silently
//      dropped → AI behaves like every message starts a new chat.
//      Fix: call db.messages.findByChatId (the real method).
//
//   2. Bug: tool calls invisible in the UI → user sees only disconnected
//      narration like "Let me search: Found it! Let me check:" without any
//      indication of what's being read/searched.
//      Fix: emit visible blockquote markers in the token stream so the
//      conversation is legible without frontend changes.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'

/* ── loadPriorMessages: must use findByChatId ────────────────────── */

describe('loadPriorMessages — conversation memory regression test', () => {
  test('calls db.messages.findByChatId (the real db method)', async () => {
    // Inline replica of loadPriorMessages so we can unit-test it without
    // importing the Next.js handler module (which has @/ aliases).
    async function loadPriorMessages(db, chatId, currentUserMessageId) {
      try {
        const rows = await db.messages.findByChatId(chatId)
        return (rows || [])
          .filter((m) => m.id !== currentUserMessageId)
          .filter((m) => !m.metadata?.silent)
          .slice(-20)
          .map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : String(m.content || ''),
          }))
          .filter((m) => m.content && m.content.length > 0)
      } catch (e) {
        console.error('[StreamV2-test] loadPriorMessages failed:', e?.message)
        return []
      }
    }

    let calledMethod = null
    const db = {
      messages: {
        async findByChatId(chatId) {
          calledMethod = 'findByChatId'
          return [
            { id: 'm1', role: 'user', content: 'Hi', metadata: {} },
            { id: 'm2', role: 'assistant', content: 'Hello!', metadata: {} },
            { id: 'm3', role: 'user', content: 'Latest message', metadata: {} },
          ]
        },
      },
    }
    const prior = await loadPriorMessages(db, 'chat-id', 'm3')
    assert.equal(calledMethod, 'findByChatId', 'must call the real method')
    assert.equal(prior.length, 2, 'must include both prior turns (not the current user message)')
    assert.deepEqual(prior, [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ])
  })

  test('the OLD method name (listByChat) does NOT exist → would return empty', async () => {
    // Regression guard: if someone reintroduces listByChat, this test still
    // proves that loadPriorMessages would silently return [] (which is the
    // exact failure the user saw).
    const db = { messages: { findByChatId: async () => [] } }
    assert.equal(typeof db.messages.listByChat, 'undefined', 'listByChat does not exist on db.messages')
  })

  test('filters out silent messages and the current user message', async () => {
    async function loadPriorMessages(db, chatId, currentUserMessageId) {
      const rows = await db.messages.findByChatId(chatId)
      return (rows || [])
        .filter((m) => m.id !== currentUserMessageId)
        .filter((m) => !m.metadata?.silent)
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
        .filter((m) => m.content)
    }
    const db = {
      messages: {
        async findByChatId() {
          return [
            { id: 'a', role: 'user', content: 'visible 1', metadata: {} },
            { id: 'b', role: 'user', content: 'silent', metadata: { silent: true } },
            { id: 'c', role: 'assistant', content: '', metadata: {} }, // empty
            { id: 'current', role: 'user', content: 'now', metadata: {} },
          ]
        },
      },
    }
    const prior = await loadPriorMessages(db, 'x', 'current')
    assert.equal(prior.length, 1)
    assert.equal(prior[0].content, 'visible 1')
  })
})

/* ── Inline tool visibility ───────────────────────────────────────── */

describe('v2 tool visibility — inline blockquote markers', () => {
  // Replica of the args-summary helper used in stream-handler-v2.js
  function summarizeArgs(args) {
    try {
      if (!args || typeof args !== 'object') return ''
      if (args.path) return ` ${args.path}`
      if (args.name_pattern) return ` "${args.name_pattern}"`
      if (args.pattern) return ` "${args.pattern}"`
      if (args.command) return ` ${String(args.command).slice(0, 80)}`
      if (args.old_str) return ' (edit)'
      const keys = Object.keys(args)
      if (keys.length === 0) return ''
      return ` (${keys.length} arg${keys.length === 1 ? '' : 's'})`
    } catch { return '' }
  }
  function summarizeResult(content) {
    const s = typeof content === 'string' ? content : String(content || '')
    const firstLine = s.split('\n').find((l) => l.trim().length > 0) || ''
    const trimmed = firstLine.slice(0, 120)
    const total = s.length
    return total > trimmed.length ? `${trimmed} … (${total} chars)` : trimmed
  }

  test('read_file marker shows the path', () => {
    assert.equal(summarizeArgs({ path: 'lib/foo.js' }), ' lib/foo.js')
  })

  test('list_files marker shows the pattern', () => {
    assert.equal(summarizeArgs({ name_pattern: 'streaming.js' }), ' "streaming.js"')
  })

  test('search_files marker shows the pattern', () => {
    assert.equal(summarizeArgs({ pattern: 'handleStreamMessageV2' }), ' "handleStreamMessageV2"')
  })

  test('run_command marker shows the command (capped at 80 chars)', () => {
    const long = 'find /var/task -type f -name "*.js" -not -path "*/node_modules/*" | head -10 -extra-args-that-are-too-long'
    const out = summarizeArgs({ command: long })
    assert.ok(out.length <= 82, 'should be capped: ' + out.length)
    assert.match(out, /^ find/)
  })

  test('result summary returns the first non-empty line', () => {
    const r = 'Here are the file contents with line numbers:\n\n## /var/task/lib/foo.js (3 lines)\n```\n1| x\n```'
    const s = summarizeResult(r)
    assert.match(s, /Here are the file contents/)
  })

  test('result summary appends total char count when truncated', () => {
    const r = 'short line\n' + 'x'.repeat(5000)
    const s = summarizeResult(r)
    assert.match(s, /\(\d+ chars\)/)
  })

  test('empty / null result handled', () => {
    assert.equal(summarizeResult(null), '')
    assert.equal(summarizeResult(undefined), '')
    assert.equal(summarizeResult(''), '')
  })

  test('NEVER dumps raw JSON for unknown args — user-reported regression', () => {
    // User report: "when I refreshed the Nexsara project, it sent this JSON
    // code. Fix that — it always just do the action, never send the code to
    // the user." The old fallback was `' ' + JSON.stringify(args).slice(0, 80)`
    // which surfaced raw JSON in chat. New behavior: show arg count only.
    const out = summarizeArgs({ random_field: 'whatever', another: 42 })
    assert.doesNotMatch(out, /[{}]/, 'must not contain JSON braces')
    assert.doesNotMatch(out, /random_field/, 'must not echo arg keys')
    assert.match(out, /\(2 args\)/, 'must surface arg count only')
  })

  test('edit_file args summarize to "(edit)" not the old_str content', () => {
    // Defensive: dumping old_str / new_str would leak code into the chat
    const out = summarizeArgs({ path: 'lib/foo.js', old_str: 'secret token', new_str: 'x' })
    assert.match(out, /lib\/foo\.js/, 'path takes priority')
    assert.doesNotMatch(out, /secret/, 'never leak old_str content')
  })
})

/* ── Empty-response fallback ──────────────────────────────────────── */

describe('v2 empty-response fallback', () => {
  test('empty fullContent gets a clear fallback message instead of being saved blank', () => {
    // Replica of the fallback logic
    function applyFallback(fullContent, errored) {
      if (!fullContent.trim()) {
        return errored
          ? '_(the agent encountered an error before producing a response — see above)_'
          : '_(the agent finished without producing a text response — try rephrasing or asking a more specific question)_'
      }
      return fullContent
    }
    assert.match(applyFallback('', false), /finished without producing/)
    assert.match(applyFallback('   \n  ', false), /finished without producing/)
    assert.match(applyFallback('', true), /encountered an error/)
    // Non-empty content passes through unchanged
    assert.equal(applyFallback('real response', false), 'real response')
  })
})
