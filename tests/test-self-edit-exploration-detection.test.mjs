// Regression test for the "narrate without execute" bug in Core System Mode.
//
// Scenario: user asks the AI to look through its codebase and tell it which
// file to edit. Old behavior: the conversational regex matched "can you ..."
// → tools were stripped → AI responded "Let me read the file..." but never
// actually invoked any tool. New behavior: exploration verbs (look/check/
// read/find/etc.) override the conversational classification, forcing the
// AI to actually call read_files / list_files.

import assert from 'node:assert/strict'

// Mirror of the classification logic in /app/lib/ai/message-stream.js
function classify(msg) {
  const msgTrimmed = msg.trim().toLowerCase()
  const actionSignals = /\b(proceed|continue|go ahead|do it|yes|start|next|keep going|go on|apply|run it|execute|implement|build|lets go|let's go|make it|ship it)\b/
  const bugSignals = /\b(don'?t see|not (see|work|show)|where is|missing|broken|wrong|doesn'?t (work|show|appear)|didn'?t (work|change)|still (not|the same)|nothing (happened|changed)|can'?t find|no (button|change))\b/i
  const explorationSignals = /\b(look (through|at|into|inside|for)|read (the|that|this|your|a|an) (file|code|source)|tell me (what|which|where|how) (file|files|function|component|method|line)|which file|what file|show me (the|that|how|where)|find (the|a|an|any|all|out|where|which|what|me)|search (for|the|your)|grep|check (the|your|what|which|if|whether)|inspect|examine|review (the|your|that)|scan|list (the|your|all)|browse|explore|locate|trace|debug|investigate)\b/i
  const isActionSignal = actionSignals.test(msgTrimmed) || bugSignals.test(msgTrimmed) || explorationSignals.test(msgTrimmed)
  if (isActionSignal) return 'action'

  const conversationalPatterns = [
    /^(hey|hi|hello|howdy|yo|sup|greetings|good\s+(morning|afternoon|evening))\b/,
    /^(thanks|thank you|thx|great job|good job|nice work|awesome|amazing|love it|looks? (good|great|amazing))\b/,
    /^(who are you|what (can|do) you|will you|can you|do you|are you|how do you|what('s| is) your)/,
    /^(how('s| is) it|what('s| is) up|nice to meet)/,
    /\b(capable|ability|abilities|can you handle|what do you know|tell me about yourself)\b/,
  ]
  const hasNoEditVerbs = !msgTrimmed.match(/\b(add|change|edit|update|remove|delete|fix|modify|replace|insert|create|refactor|rename|move|implement|build|write|patch|csv|export|deploy|refactor)\b/)
  const isShortGreeting = msgTrimmed.length < 25 && hasNoEditVerbs
  return (conversationalPatterns.some(p => p.test(msgTrimmed)) || isShortGreeting) ? 'conversational' : 'action'
}

const cases = [
  // ── The bug from the user's screenshot ──
  ['can you look through your system and tell me what file you would need to edit', 'action'],
  ['look through your codebase', 'action'],
  ['can you tell me which file controls this', 'action'],
  ['what file controls the streaming behavior', 'action'],
  ['which file should I edit', 'action'],
  ['read the message-stream.js file', 'action'],
  ['find the AI service code', 'action'],
  ['search for tool_choice', 'action'],
  ['grep for selfEdit', 'action'],
  ['check what AI service files exist', 'action'],
  ['inspect the handler', 'action'],
  ['investigate the streaming bug', 'action'],
  ['show me the entrypoint', 'action'],
  ['list the files in lib/ai', 'action'],
  ['explore the codebase', 'action'],

  // ── Should still be conversational (no exploration intent) ──
  ['hey there', 'conversational'],
  ['thanks!', 'conversational'],
  ['who are you', 'conversational'],
  ['what can you do', 'conversational'],
  ['nice work', 'conversational'],

  // ── Should still be edit-action (existing action signals) ──
  ['proceed', 'action'],
  ['lets go', 'action'],
  ['implement this', 'action'],
  ['fix the streaming bug', 'action'],
  ['add a search bar', 'action'],

  // ── Bug signals still classify as action ──
  ['the button is missing', 'action'],
  ['nothing happened', 'action'],
]

let failed = 0
for (const [msg, expected] of cases) {
  const got = classify(msg)
  if (got === expected) {
    console.log(`  ✓ "${msg.slice(0, 60)}" → ${got}`)
  } else {
    failed++
    console.error(`  ✗ "${msg}"\n    expected ${expected}, got ${got}`)
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed === 0 ? 0 : 1)
