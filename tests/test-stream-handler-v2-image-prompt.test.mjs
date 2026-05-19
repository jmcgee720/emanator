// ──────────────────────────────────────────────────────────────────────
// stream-handler-v2 image-handling system prompt rules
// ──────────────────────────────────────────────────────────────────────
// Pins the guardrails that force the project agent to actually look at
// attached images, inventory what it sees, and not hallucinate filenames
// / slots. Regression here = silent failure where the user uploads art
// and the agent saves it to the wrong path without ever describing it.
//
// We test by importing the module and grepping its exported system
// prompt builder. (Auroraly does not export the prompt directly, so we
// monkey-import the file as text and assert the rules are present.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STREAM_HANDLER = join(__dirname, '..', 'lib', 'api', 'stream-handler-v2.js')

const must = async (substr, msg) => {
  const src = await readFile(STREAM_HANDLER, 'utf8')
  assert.ok(src.includes(substr), msg || `system prompt missing: ${substr}`)
}

test('project system prompt: tells agent it CAN see images', async () => {
  await must('You CAN see them', 'agent must be told it has vision')
  await must('claude vision', 'prompt must reference the vision capability')
})

test('project system prompt: requires inventory before action', async () => {
  await must('INVENTORY FIRST', 'must require an explicit inventory step')
  await must('describe what you actually see', 'must instruct plain-language description')
})

test('project system prompt: forbids guessing filenames / slots', async () => {
  await must('CONFIRM, DO NOT GUESS', 'must require confirmation before saving')
  await must('never silently substitute', 'must forbid silent substitution')
})

test('project system prompt: forbids fabrication of unseen details', async () => {
  await must('NEVER FABRICATE', 'must forbid fabrication')
  await must('not in the inventory you just produced', 'must constrain output to inventoried details')
})

test('project system prompt: gates action on confirmation', async () => {
  await must('ONLY THEN ACT', 'must require inventory + confirmation before file writes')
  await must('mention the saved path', 'must surface saved paths for verification')
})

test('project system prompt: forbids write_file for binary attachments', async () => {
  // The agent previously called write_file with a binary PNG, which
  // silently truncated to a few bytes. The prompt must now route the
  // model to save_attachment_to_path instead.
  await must('save_attachment_to_path', 'must reference the new binary-safe tool')
  await must('NOT `write_file`', 'must explicitly forbid write_file for binaries')
  await must('silently truncate', 'must explain why write_file fails on binary data')
})
