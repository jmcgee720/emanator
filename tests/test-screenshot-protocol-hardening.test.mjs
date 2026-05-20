// ──────────────────────────────────────────────────────────────────────
// stream-handler-v2 hardened screenshot-analysis protocol
// ──────────────────────────────────────────────────────────────────────
// Pins the second-generation guardrails: TRUTH-CHECK GATE, DEFAULT
// SKEPTICISM, COMPARISON, LAYOUT NOTES memory, META-COGNITION audience
// awareness, and the per-turn forcing reminder injected next to the
// image content blocks.
//
// Why we added these: the first-generation INVENTORY-FIRST rules
// shipped, but the model still fabricated "looks fixed!" responses
// because no gate explicitly forbade positive phrasing when the
// inventory showed problems. Regressing any of these tests means the
// model can drift back into projecting positivity onto screenshots
// that show real bugs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STREAM_HANDLER = join(__dirname, '..', 'lib', 'api', 'stream-handler-v2.js')

async function load() {
  return readFile(STREAM_HANDLER, 'utf8')
}

test('image protocol: defines all five mandatory steps', async () => {
  const src = await load()
  assert.match(src, /STEP 1 — INVENTORY FIRST/, 'STEP 1 must be inventory')
  assert.match(src, /STEP 2 — COMPARISON PHASE/, 'STEP 2 must be comparison')
  assert.match(src, /STEP 3 — TRUTH-CHECK GATE/, 'STEP 3 must be the truth-check gate')
  assert.match(src, /STEP 4 — MEMORY/, 'STEP 4 must require LAYOUT NOTES memory')
  assert.match(src, /STEP 5 — DEFAULT TO SKEPTICISM/, 'STEP 5 must enforce default skepticism')
})

test('image protocol: truth-check gate forbids fabricated positive phrases', async () => {
  const src = await load()
  // The model must be told these specific phrases are forbidden when
  // inventory shows problems. If any of these phrases is removed from
  // the FORBIDDEN list, the agent can revert to fabricating positivity.
  for (const phrase of ['looks perfect', 'looks good', "that\\'s fixed", "it\\'s working now", 'the fix worked']) {
    assert.ok(src.includes(phrase), `truth-check gate must forbid: ${phrase}`)
  }
  assert.match(src, /FORBIDDEN/, 'must use the word FORBIDDEN so the model treats it as a hard rule')
})

test('image protocol: requires citing inventory items when claiming success', async () => {
  const src = await load()
  // The "you may then state success — but you must cite the specific
  // inventory items that prove it" clause is what stops the model
  // from saying "matches user's expected layout" with no evidence.
  assert.match(src, /cite the specific inventory items/, 'must require evidence citation for any success claim')
})

test('image protocol: comparison phase compares inventory to user-stated expectation', async () => {
  const src = await load()
  assert.match(src, /Explicitly compare what you see in the inventory to what the user said/, 'must compare inventory vs user expectation')
  assert.match(src, /MISMATCH/, 'must use the word MISMATCH so misalignments are surfaced')
})

test('image protocol: memory step requires LAYOUT NOTES carryover across turns', async () => {
  const src = await load()
  assert.match(src, /LAYOUT NOTES/, 'must define a LAYOUT NOTES block name for cross-turn memory')
  assert.match(src, /follow-up screenshot/, 'must reference cross-turn use')
  assert.match(src, /track changes across turns/, 'must require tracking changes across turns')
})

test('image protocol: default-skepticism rule applies after code changes', async () => {
  const src = await load()
  assert.match(src, /your DEFAULT assumption is that the change did NOT work/, 'must default to assuming the change failed')
  assert.match(src, /Optimism without inventory evidence is fabrication/, 'must label uncited optimism as fabrication')
})

test('meta-cognition: audience-awareness rule exists and names the prompt-for-another-agent case', async () => {
  const src = await load()
  assert.match(src, /AUDIENCE AWARENESS/, 'meta-cognition rule must be named')
  assert.match(src, /write a prompt for Emergent/, 'must specifically address the "write a prompt for another agent" failure mode')
  assert.match(src, /Never write it in first person/, 'must explicitly forbid first-person prompts when audience is another agent')
  assert.match(src, /Audience:/, 'must require an "Audience:" preamble line before generated artefacts')
})

test('per-turn forcing reminder: prepends inline instruction when images are present', async () => {
  const src = await load()
  assert.match(src, /SYSTEM REMINDER —/, 'must inject a per-turn reminder right next to the image blocks')
  assert.match(src, /screenshot.*attached this turn/i, 'reminder must reference the image arrival on this turn')
  // The five-step gate must be repeated inline so the model gates on
  // it even when the system prompt is far away in the context.
  assert.match(src, /INVENTORY FIRST.*literal description/s, 'inline reminder must restate INVENTORY')
  assert.match(src, /COMPARISON.*match.*against what the user said/s, 'inline reminder must restate COMPARISON')
  assert.match(src, /TRUTH-CHECK GATE.*FORBIDDEN from saying/s, 'inline reminder must restate the truth-check gate')
})

test('per-turn forcing reminder: only injected when at least one image is on the turn', async () => {
  const src = await load()
  // Guard: the unshift is wrapped in `if (imageCount > 0)`. If a
  // regression moves the unshift outside that check, every plain text
  // message would have a noisy SYSTEM REMINDER prepended.
  assert.match(src, /if \(imageCount > 0\) \{[\s\S]*?built\.unshift/, 'forcing reminder must be guarded on imageCount > 0')
})

test('image protocol: appears in BOTH project-mode and self-edit-mode prompts', async () => {
  const src = await load()
  // Both prompt builders must reference the shared constant by name.
  // If a future refactor inlines one but not the other, the two modes
  // will diverge silently — this catches that.
  const projectFn = src.slice(src.indexOf('function buildProjectSystemPrompt'), src.indexOf('function buildSelfEditSystemPrompt'))
  const selfEditFn = src.slice(src.indexOf('function buildSelfEditSystemPrompt'), src.indexOf('function buildSelfEditScope'))
  assert.match(projectFn, /IMAGE_ANALYSIS_PROTOCOL/, 'project prompt must reference the shared image protocol')
  assert.match(selfEditFn, /IMAGE_ANALYSIS_PROTOCOL/, 'self-edit prompt must reference the shared image protocol')
  assert.match(projectFn, /META_COGNITION_RULE/, 'project prompt must reference the audience-awareness rule')
  assert.match(selfEditFn, /META_COGNITION_RULE/, 'self-edit prompt must reference the audience-awareness rule')
})
