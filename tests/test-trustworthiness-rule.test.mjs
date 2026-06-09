// Locks in the Trustworthiness Rule added to the V2 system prompt
// 2026-02 after user reported Auroraly chats both inventing tool-failure
// narratives ("my writes aren't persisting") AND prematurely declaring
// fixes complete ("auto-refresh is working now" — it wasn't).
//
// The rule explicitly enumerates:
//   - What the agent CAN observe (tool returns, user messages)
//   - What the agent CANNOT observe (iframe state, deploy completion,
//     browser cache, runtime DB state — the tool already told you that)
//   - Two banned hallucination patterns with banned/replacement phrasing
//   - The deploy-latency reminder
//
// If a future refactor accidentally drops this rule from the system
// prompt assembly, the model will silently start hallucinating again.
// This test prevents that.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_PATH = join(ROOT, 'lib/api/stream-handler-v2.js')

test('TRUSTWORTHINESS_RULE constant is defined', async () => {
  const src = await readFile(SRC_PATH, 'utf8')
  assert.match(src, /const TRUSTWORTHINESS_RULE = \[/)
  assert.match(src, /TRUSTWORTHINESS — DO NOT CLAIM SUCCESS YOU CANNOT OBSERVE/)
})

test('rule enumerates what the agent CAN vs CANNOT observe', async () => {
  const src = await readFile(SRC_PATH, 'utf8')
  // Without this distinction the model has no anchor for separating
  // observable evidence from confabulation. The apostrophes appear
  // as `\'` in the JS source because the strings are single-quoted.
  assert.match(src, /You CANNOT directly observe whether the user\\'s preview just refreshed/)
  assert.match(src, /Whether the live preview iframe reloaded/)
  assert.match(src, /Whether a Vercel\/Fly deploy completed/)
})

test('rule explicitly bans inventing tool-failure narratives', async () => {
  const src = await readFile(SRC_PATH, 'utf8')
  assert.match(src, /NEVER INVENT TOOL-FAILURE NARRATIVES/)
  assert.match(src, /If write_file \/ edit_file \/ delete_file returned success, your writes persisted/)
  // The replacement phrasing for tempted-to-hallucinate moments
  assert.match(src, /The tool returned success, so the write committed/)
})

test('rule explicitly bans premature success claims', async () => {
  const src = await readFile(SRC_PATH, 'utf8')
  assert.match(src, /NEVER DECLARE A FIX IS WORKING WITHOUT OBSERVING IT/)
  // Banned phrases that mirror the actual hallucinations users have
  // reported
  assert.match(src, /Auto-refresh is now working/)
  assert.match(src, /I fixed it and the preview should update now/)
  // Replacement phrasing — apostrophes appear as `\'` in JS source
  assert.match(src, /read_file confirms the new content is in the file/)
  assert.match(src, /I cannot observe whether it\\'s deployed yet/)
})

test('rule names the deploy latency budget', async () => {
  const src = await readFile(SRC_PATH, 'utf8')
  assert.match(src, /Vercel: 1-3 min/)
  assert.match(src, /Fly preview-runner: 2-5 min/)
})

test('rule is wired into both project AND self-edit system prompts', async () => {
  const src = await readFile(SRC_PATH, 'utf8')
  // Two consumption sites: buildProjectSystemPrompt and
  // buildSelfEditSystemPrompt. Both must include the rule.
  const occurrences = (src.match(/TRUSTWORTHINESS_RULE/g) || []).length
  assert.ok(
    occurrences >= 3, // 1 const declaration + 2 consumption sites
    `TRUSTWORTHINESS_RULE must appear at least 3 times (got ${occurrences})`,
  )
})
