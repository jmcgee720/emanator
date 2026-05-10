// Test the dangling-intent regex used in the Core System synthesis pass.
// When the AI ends its turn with phrases like "Let me find the file:" without
// a real synthesis after, we want to detect this and trigger a follow-up pass.

import assert from 'node:assert/strict'

function isDangling(fullContent) {
  const trimmedTail = (fullContent || '').trim().slice(-200).toLowerCase()
  return /(let me|i'?ll|i will|going to|about to|checking|reading|looking|finding|searching|investigating)[^.!?]*[:\s]*$/.test(trimmedTail) && !trimmedTail.endsWith('.') && !trimmedTail.endsWith('!') && !trimmedTail.endsWith('?')
}

const cases = [
  // ── Dangling intent (should trigger synthesis pass) ──
  ['Let me find the correct streaming file:', true],
  ['I need to see the prompt builder file to understand what\'s causing the timeout: Let me find the correct file that handles prompt construction:', true],
  ['Let me read the message streaming file to see where I\'m failing to respond after tool calls: Let me find the correct streaming file:', true],
  ['I\'ll check the current implementation', true],
  ['Looking at this file', true],
  ['Investigating the issue', true],
  ['Going to read the source', true],

  // ── Complete responses (should NOT trigger synthesis pass) ──
  ['I found the issue in line 245. The bug is that we forgot to set tool_choice=required.', false],
  ['Done! I updated the file successfully.', false],
  ['The file is /app/lib/ai/message-stream.js — would you like me to edit it?', false],
  ['Here\'s what I found: the streaming engine breaks at line 3217.', false],
  ['Successfully applied the patch.', false],

  // ── Edge cases ──
  ['', false],  // empty
  ['ok', false],  // very short, no intent
  ['Let me know if you have other questions!', false],  // ends with !
  ['Should I check the streaming file?', false],  // ends with ?
]

let failed = 0
for (const [text, expected] of cases) {
  const got = isDangling(text)
  if (got === expected) {
    console.log(`  ✓ "${text.slice(-60)}" → dangling=${got}`)
  } else {
    failed++
    console.error(`  ✗ "${text}"\n    expected ${expected}, got ${got}`)
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed === 0 ? 0 : 1)
