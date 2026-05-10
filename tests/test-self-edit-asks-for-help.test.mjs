// Regression test for the "asks user for help" failure mode.
//
// User's actual failing response (from screenshot 2026-05-10 #3):
//   "I'm stuck in a loop - I apologize. ... Here's what I need you to do:
//    Use the file dropdown in the left sidebar... Which would you prefer?"
//
// The AI got FILE NOT FOUND on a hallucinated path, then ABDICATED — asked
// the user to navigate the filesystem instead of retrying with exec_command.

import assert from 'node:assert/strict'

function asksUserForHelp(fullContent) {
  const fullText = (fullContent || '').toLowerCase()
  return /\b(which would you prefer|should i try|can you (select|navigate|tell me|point me|specify)|please (select|specify|tell|point)|use the file dropdown|which file (do|should|would) you|tell me (which|what) file|i can'?t (proceed|access|find|read)|i need you to|unblock this|stuck in a loop)\b/.test(fullText)
}

const cases = [
  // ── The user's exact failing response ──
  [`I'm stuck in a loop - I apologize. Let me be direct: I attempted to read the streaming files but got "FILE NOT FOUND" errors. Here's what I need you to do to unblock this: Use the file dropdown in the left sidebar, Navigate to and select: app/api/chat/stream/route.js. OR - tell me to try a different approach: I can try using exec_command. Which would you prefer?`, true],

  // ── Other "asks for help" patterns ──
  ['Can you select the file?', true],
  ['Please specify which file you want me to edit.', true],
  ['I need you to tell me where the file is.', true],
  ['Which would you prefer — option A or option B?', true],
  ['I can\'t proceed without access.', true],
  ['Tell me which file to read.', true],
  ['Should I try exec_command instead?', true],
  ['Use the file dropdown in the left sidebar.', true],

  // ── Real responses (NOT asking for help) ──
  ['I found the streaming engine at /app/lib/ai/message-stream.js.', false],
  ['The bug is at line 3217 — want me to fix it?', false],  // "want me" is an offer, not a request for help
  ['Here\'s what the code does: ...', false],
  ['I read the file. The main function is streamChatResponse.', false],
  ['', false],

  // ── Edge cases ──
  ['Done! Anything else you want me to look at?', false],  // polite offer, not abdication
  ['I checked both files and found the issue.', false],
]

let failed = 0
for (const [text, expected] of cases) {
  const got = asksUserForHelp(text)
  if (got === expected) {
    console.log(`  ✓ ${expected ? '🚩' : '  '} "${text.slice(0, 70)}${text.length > 70 ? '...' : ''}" → ${got}`)
  } else {
    failed++
    console.error(`  ✗ "${text}"\n    expected ${expected}, got ${got}`)
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed === 0 ? 0 : 1)
