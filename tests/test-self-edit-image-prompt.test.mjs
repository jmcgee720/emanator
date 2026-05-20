// ──────────────────────────────────────────────────────────────────────
// Self-edit (Core System) system prompt — image-handling rules
// ──────────────────────────────────────────────────────────────────────
// Pins that the Core System agent's prompt also contains the vision +
// inventory + no-fabrication rules. Previously these only lived in the
// project-mode prompt, so when a chat ran in self-edit mode (after the
// is_core detection fix) and the user dropped a screenshot, the agent
// would say "I can't see images" — the model was hedging because its
// prompt never told it it had vision. This regression is real-money:
// every screenshot the user shares in Core System is a debugging
// signal that gets wasted if the agent claims it can't see them.

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

async function selfEditPromptSection() {
  // Grab everything between buildSelfEditSystemPrompt's opening line
  // and the next top-level function definition. Lets us assert against
  // just the self-edit prompt, not the project one (they share several
  // phrases like "INVENTORY FIRST" so a whole-file grep would mask the
  // regression we care about).
  const src = await load()
  const startIdx = src.indexOf('function buildSelfEditSystemPrompt')
  const endIdx = src.indexOf('\nfunction ', startIdx + 1)
  return src.slice(startIdx, endIdx > startIdx ? endIdx : src.length)
}

test('self-edit prompt: tells agent it CAN see images', async () => {
  const s = await selfEditPromptSection()
  assert.match(s, /You CAN see them/, 'must explicitly affirm vision capability')
  assert.match(s, /claude vision/, 'must reference the vision mechanism')
})

test('self-edit prompt: requires inventory before action on screenshots', async () => {
  const s = await selfEditPromptSection()
  assert.match(s, /INVENTORY FIRST/, 'must require explicit inventory')
  assert.match(s, /describe what you actually see/, 'must instruct plain-language description')
  assert.match(s, /UI elements visible|error text|panel layout/, 'must cue specific UI things to inventory')
})

test('self-edit prompt: forbids fabrication of unseen UI details', async () => {
  const s = await selfEditPromptSection()
  assert.match(s, /NEVER FABRICATE/)
  assert.match(s, /not in the inventory you just produced/)
})

test('self-edit prompt: forbids the "I cannot see images" hedge', async () => {
  // This is the actual user-reported regression — the model said it
  // couldn't see the screenshot. The prompt must explicitly block
  // that response pattern.
  const s = await selfEditPromptSection()
  assert.match(s, /ABSOLUTE PROHIBITION/, 'must include the prohibition section')
  assert.match(s, /I cannot see images/, 'must quote the banned response')
  assert.match(s, /do not have access to the attachments/, 'must quote the other banned phrasing')
})

test('self-edit prompt: routes binary saves through save_attachment_to_path', async () => {
  const s = await selfEditPromptSection()
  assert.match(s, /save_attachment_to_path/, 'must reference the binary-safe tool')
  assert.match(s, /NEVER use write_file for a binary/)
  assert.match(s, /silently truncate/, 'must explain why write_file fails for binaries')
})

test('self-edit prompt: still lists save_attachment_to_path in the available tools', async () => {
  const s = await selfEditPromptSection()
  assert.match(s, /save_attachment_to_path.*only present when the current turn has attachments/i)
})
