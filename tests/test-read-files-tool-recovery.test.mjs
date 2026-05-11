// ── Read Files Follow-up Directive Tests ──
//
// Proves that when read_files returns FILE NOT FOUND, the agent loop injects
// the exec_command directive — instead of the default "use search_replace"
// nudge — which is what unblocks the "AI narrates intent without ever
// delivering" failure mode the user hit in Core System mode.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { pickReadFilesDirective } from '../lib/ai/read-files-directive.js'

describe('pickReadFilesDirective — FILE NOT FOUND triggers exec_command directive', () => {
  test('all paths failed → exec_command directive', () => {
    const toolResult = `Here are the file contents with line numbers:

## \`fake/zzz.js\` — FILE NOT FOUND. Run \`exec_command\` with \`find /app...\`

Use the \`search_replace\` tool to make changes — copy exact text as old_str.`
    const d = pickReadFilesDirective(toolResult, 2)
    assert.ok(d, 'must return a directive')
    assert.match(d, /exec_command/, 'must instruct exec_command')
    assert.match(d, /find \/app/, 'must give a concrete command')
    assert.match(d, /Do NOT stop/, 'must explicitly forbid stopping')
    assert.doesNotMatch(d, /Use `search_replace` to make changes — copy the EXACT/)
  })

  test('successful read → search_replace nudge (no regression)', () => {
    const toolResult = `Here are the file contents with line numbers:

## \`lib/foo.js\` (50 lines)
\`\`\`
1| const x = 1
2| export default x
\`\`\``
    const d = pickReadFilesDirective(toolResult, 2)
    assert.ok(d)
    assert.match(d, /search_replace/, 'must instruct search_replace')
  })

  test('auto-recovered (wrong path but unique match) → search_replace nudge', () => {
    const toolResult = `Here are the file contents with line numbers:

## \`lib/foo.js\` (50 lines) — auto-recovered

**NOTE:** \`fake/foo.js\` did not exist, but \`lib/foo.js\` was the unique match.

\`\`\`
1| const x = 1
\`\`\``
    const d = pickReadFilesDirective(toolResult, 2)
    assert.ok(d)
    assert.match(d, /search_replace/, 'auto-recovered = success, so search_replace nudge is correct')
  })

  test('mixed (some success + some FILE NOT FOUND) → instructs both', () => {
    const toolResult = `Here are the file contents with line numbers:

## \`lib/foo.js\` (50 lines)
\`\`\`
1| const x = 1
\`\`\`

## \`fake/missing.js\` — FILE NOT FOUND. Run \`exec_command\`...`
    const d = pickReadFilesDirective(toolResult, 2)
    assert.ok(d)
    assert.match(d, /search_replace/)
    assert.match(d, /exec_command/)
  })

  test('candidates list → precise retry directive', () => {
    const toolResult = `Here are the file contents with line numbers:

## \`fake/foo.js\` — FILE NOT FOUND. Candidates with same filename:
- \`lib/foo.js\`
- \`app/foo.js\`

Call \`read_files\` again with the correct path...`
    const d = pickReadFilesDirective(toolResult, 2)
    assert.ok(d)
    assert.match(d, /multiple candidate paths/)
    assert.match(d, /Pick the most likely/)
    assert.doesNotMatch(d, /exec_command/, 'should not instruct exec_command when candidates are available')
  })

  test('first-iteration success (agentLoopCount=0) → no nudge', () => {
    const toolResult = `Here are the file contents with line numbers:

## \`lib/foo.js\` (50 lines)
\`\`\`
1| const x = 1
\`\`\``
    const d = pickReadFilesDirective(toolResult, 0)
    assert.equal(d, null, 'first iteration: no nudge needed yet')
  })

  test('first-iteration FILE NOT FOUND → still inject exec_command (any iteration)', () => {
    const toolResult = `## \`fake.js\` — FILE NOT FOUND. Run \`exec_command\`...`
    const d = pickReadFilesDirective(toolResult, 0)
    assert.ok(d, 'failure-recovery directive must fire even at iteration 0')
    assert.match(d, /exec_command/)
  })

  test('null/undefined input → no crash', () => {
    assert.equal(pickReadFilesDirective(null, 2), null)
    assert.equal(pickReadFilesDirective(undefined, 2), null)
    assert.equal(pickReadFilesDirective('', 2), null)
  })

  test('reproduces the EXACT failure mode from the screenshot', () => {
    // The user's screenshot showed: AI tried a guessed path → FILE NOT FOUND
    // → AI narrated "Let me find the actual streaming file" instead of acting.
    // The OLD code injected the search_replace nudge here (wrong!).
    // The NEW code must inject exec_command (correct).
    const toolResult = `Here are the file contents with line numbers:

## \`app/api/chat/stream/route.js\` — FILE NOT FOUND. Run \`exec_command\` with \`find /app -type f -name "*<keyword>*" 2>/dev/null | head -10\` to discover the real path.

Use the \`search_replace\` tool to make changes...`
    const d = pickReadFilesDirective(toolResult, 1)
    assert.ok(d)
    assert.match(d, /exec_command/, 'screenshot scenario must trigger exec_command directive')
    assert.match(
      d,
      /Do NOT narrate/,
      'directive must explicitly forbid narration (the exact failure mode)'
    )
  })
})
