// Regression test for the "Part 1 only" synthesis-pass bug in Core System Mode.
//
// User's actual failing response (from screenshot 2026-05-10):
//   "I'll search through the codebase to find the streaming-related files."
//
// This is a COMPLETE SENTENCE (period at the end), but it's still a dangling
// promise — the AI said it would do something and then stopped without
// producing Parts 2+3 (the tool call + the actual answer).
//
// The triple-condition detector replaces the old "ends-without-period" check
// with: intent verb present + no completion verb + short response → dangling.

import assert from 'node:assert/strict'

function isDangling(fullContent) {
  const fullText = (fullContent || '').toLowerCase()
  const tailText = fullText.trim().slice(-300)
  const hasIntentVerb = /\b(let me|i'?ll|i will|i'?m (going|about) to|going to|about to|searching|reading|looking (at|for|through|into)|finding|checking|investigating|inspecting|examining|exploring|locating|tracing|attempting to)\b/.test(tailText)
  const hasCompletionVerb = /\b(i (found|read|checked|saw|identified|located|discovered|see)|i'?ve (found|read|checked|identified|located)|(found|located|identified) (it|the|a|an)|here(?:'s| is) (the|what|how|why|a|an)|the (bug|issue|problem|error|root cause|fix|reason) (is|was) (at|in line|that|because|caused)|at line \d+|in (line|the file) \d|appears to be|after (reading|checking|searching|looking)|turns out|based on (the|what|my))\b/.test(fullText) || /\/app\/[\w./-]+/.test(fullText)
  const isTooShort = (fullContent || '').length < 300
  // Ultra-short catch: < 100 chars + no completion verb + no tool call → almost certainly Part-1 only
  const isUltraShortWithoutTool = (fullContent || '').trim().length > 0 && (fullContent || '').trim().length < 100 && !hasCompletionVerb  // we assume no tool was called in this test
  return (hasIntentVerb && !hasCompletionVerb && isTooShort) || isUltraShortWithoutTool
}

const cases = [
  // ── The newest user-failing case (ultra-short Part-1-only) ──
  ['Looking now:', true],
  ['Looking now.', true],
  ['Searching...', true],
  ['Checking...', true],
  ['Sure!', true],  // 5 chars, no tool call in self-edit context = failure (user asked for action)

  // ── The exact user-failing case (period-terminated promise, short) ──
  ["I'll search through the codebase to find the streaming-related files.", true],

  // ── Other Part-1-only responses (regardless of punctuation) ──
  ['Let me find the correct streaming file:', true],
  ["I'll check the prompt builder file to understand what's causing the timeout.", true],
  ['Let me read the message streaming file to see where the bug is.', true],
  ["I'll look at this file now.", true],
  ['Looking through the codebase.', true],
  ['Investigating the issue.', true],
  ['Going to read the source.', true],
  ['Searching for the relevant code now.', true],
  ['Reading the file.', true],

  // ── Complete responses with findings (should NOT trigger) ──
  ['I found the issue in /app/lib/ai/message-stream.js at line 245. The bug is that we forgot to set tool_choice=required.', false],
  ['I checked the file. The streaming logic is at line 3217. Want me to walk you through it?', false],
  ['Here is what I found: the streaming engine breaks at line 3217 because the agent loop exits without firing the synthesis pass.', false],
  ['The file is /app/lib/ai/message-stream.js — would you like me to edit it?', false],
  ['After reading the source, the answer is that the regex was too strict.', false],
  ['I identified the root cause: the conversational regex caught "can you" phrases.', false],
  ['The bug is at line 3217 — the loop terminates too early.', false],

  // ── Long responses, even with intent verbs, should not trigger ──
  // (assumption: a long response usually means the AI actually wrote something useful)
  [`I'll search through the codebase to find the streaming-related files. After grep'ing the lib folder for stream patterns, the main streaming engine is at /app/lib/ai/message-stream.js (about 3,970 lines) which contains the agent loop, tool-call orchestration, and the synthesis pass. The public entry point is in /app/lib/ai/service.js which wraps the streaming engine. There's also /app/lib/ai/stream-helpers.js for error classification. Want me to read a specific section?`, false],

  // ── Edge cases ──
  ['', false],  // empty
  ['ok', true],  // very short, no tool call in action mode = failure
  ['Let me know if you have other questions!', true],  // matches "Let me" intent + short
  ['Sure, that exists.', true],  // < 100 chars, no tool call in action mode = failure
  ['Done!', true],  // < 100 chars, no tool call in action mode = failure
]

let failed = 0
for (const [text, expected] of cases) {
  const got = isDangling(text)
  if (got === expected) {
    console.log(`  ✓ ${expected ? '🚩' : '  '} "${text.slice(0, 70)}${text.length > 70 ? '...' : ''}" → ${got}`)
  } else {
    failed++
    console.error(`  ✗ "${text}"\n    expected ${expected}, got ${got}`)
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed === 0 ? 0 : 1)
