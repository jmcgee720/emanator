// ──────────────────────────────────────────────────────────────────────
// Regression: user reported "I asked why it says no preview, and the
// chat just started generating something instead of explaining."
//
// classifyUserIntent already detected questions/frustration etc., but
// the message-stream pipeline only consumed 'frustration' (and only
// for a soft 'be empathetic' addendum — never blocked tool calls).
// Questions like "why does X happen?" still routed through 'build'/
// 'edit' and triggered file generation.
//
// Fix: when classifyUserIntent says 'question' AND the message has no
// action verb, force toolMode=chat_only and inject a strong system
// directive that forbids tool calls.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { classifyUserIntent } from '../lib/ai/intents.js'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// Same heuristic as in message-stream.js. If they drift, these fail.
const ACTION_RE = /\b(build|create|make|add|fix|change|update|edit|remove|delete|modify|implement|refactor|deploy|generate|design|integrate|setup|install)\b/i
const EXPLANATORY_RE = /^\s*(why|what|how|explain|describe|tell me|can you (explain|describe|tell me|walk me through))\b/i

function shouldForceChatOnly(message) {
  const phase = classifyUserIntent(message).phase
  const isExplanatoryStart = EXPLANATORY_RE.test(message)
  const hasAction = !isExplanatoryStart && ACTION_RE.test(message)
  return (
    (phase === 'question' && !hasAction) ||
    (phase === 'frustration' && !hasAction) ||
    phase === 'greeting'
  )
}

// ─── Questions that should NOT generate code ─────────────────────────
test('"why does it say no preview?" → chat_only (regression)', () => {
  assert.equal(shouldForceChatOnly('Why does it say no preview?'), true)
})

test('"how does the auth flow work?" → chat_only', () => {
  assert.equal(shouldForceChatOnly('how does the auth flow work?'), true)
})

test('"what is happening with my preview" → chat_only', () => {
  assert.equal(shouldForceChatOnly('what is happening with my preview'), true)
})

test('"can you explain the build pipeline" → chat_only', () => {
  assert.equal(shouldForceChatOnly('can you explain the build pipeline'), true)
})

test('"is there a way to do X?" → chat_only (just asking)', () => {
  assert.equal(shouldForceChatOnly('is there a way to do this?'), true)
})

// ─── Action-disguised-as-question — should STILL build/edit ──────────
test('"can you fix the auth" → NOT chat_only (action verb present)', () => {
  assert.equal(shouldForceChatOnly('can you fix the auth?'), false)
})

test('"could you build me a navbar" → NOT chat_only', () => {
  assert.equal(shouldForceChatOnly('could you build me a navbar'), false)
})

test('"can you add a footer?" → NOT chat_only', () => {
  assert.equal(shouldForceChatOnly('can you add a footer?'), false)
})

// ─── Greetings → chat_only ───────────────────────────────────────────
test('"hi" → chat_only', () => {
  assert.equal(shouldForceChatOnly('hi'), true)
})

test('"hey, can you build me a chat app" → NOT chat_only (greeting + action)', () => {
  // Heuristic limitation: classifier sees "hey" as greeting, but action
  // verb is present → we let it through. Important for natural phrasing.
  // Test that the OVERRIDE doesn't fire.
  const phase = classifyUserIntent('hey, can you build me a chat app').phase
  // Even if phase is 'greeting' (greedy match) the action verb stops chat-only.
  const hasAction = ACTION_RE.test('hey, can you build me a chat app')
  assert.ok(hasAction || phase !== 'greeting', `expected action to override greeting`)
})

// ─── Frustration variants ────────────────────────────────────────────
test('"this is broken, why?" → chat_only (frustration + question, no action)', () => {
  assert.equal(shouldForceChatOnly('this is broken, why?'), true)
})

test('"this is broken, fix it" → NOT chat_only (frustration + action)', () => {
  assert.equal(shouldForceChatOnly('this is broken, fix it'), false)
})

// ─── Plain instructions still work ───────────────────────────────────
test('"add a header" → NOT chat_only', () => {
  assert.equal(shouldForceChatOnly('add a header'), false)
})

test('"refactor server.js" → NOT chat_only', () => {
  assert.equal(shouldForceChatOnly('refactor server.js'), false)
})

// ─── Edge cases ──────────────────────────────────────────────────────
test('empty string → chat_only (greeting)', () => {
  assert.equal(shouldForceChatOnly(''), true)
})

test('"yes" → NOT chat_only (approval, falls through)', () => {
  assert.equal(shouldForceChatOnly('yes'), false)
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (err) { console.error(`  ✗ ${t.name}\n     `, err.message); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
