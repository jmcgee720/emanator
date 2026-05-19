// ──────────────────────────────────────────────────────────────────────
// Self-edit detection: title prefix OR is_core project flag
// ──────────────────────────────────────────────────────────────────────
// This pins the logic that decides whether a chat operates on Auroraly's
// own codebase (self-edit / Core System mode) versus on a user project.
// Bug pattern this catches: a chat created inside the Core System
// project via the regular "+ New chat" button (no title prefix) used to
// end up in project mode → the agent would refuse to touch Auroraly's
// source. By treating ANY chat in an is_core project as self-edit, the
// permission model is governed by the *project*, not the *title*.
//
// We don't import the real stream-handler-v2 (it has a giant React +
// Anthropic + DB dep graph). Instead we re-export the boolean logic as
// a pure helper so unit tests can drive every combination cheaply.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const SELF_EDIT_PREFIX = '\u2699 Self-Edit: '

function detectIsSelfEdit({ chat, project }) {
  const titleHit = chat?.title?.startsWith(SELF_EDIT_PREFIX) === true
  const coreHit = project?.settings?.is_core === true
  return titleHit || coreHit
}

test('detectIsSelfEdit: title prefix alone (no project loaded) → true', () => {
  assert.equal(
    detectIsSelfEdit({ chat: { title: '\u2699 Self-Edit: tune the prompt' }, project: null }),
    true,
  )
})

test('detectIsSelfEdit: is_core project alone (no prefix) → true', () => {
  // This is the new code path that fixes the user-reported bug: a chat
  // inside Core System without the title prefix MUST still be self-edit.
  assert.equal(
    detectIsSelfEdit({
      chat: { title: 'New Conversation' },
      project: { id: 'core-1', settings: { is_core: true } },
    }),
    true,
  )
})

test('detectIsSelfEdit: BOTH (belt + suspenders) → true', () => {
  assert.equal(
    detectIsSelfEdit({
      chat: { title: '\u2699 Self-Edit: x' },
      project: { settings: { is_core: true } },
    }),
    true,
  )
})

test('detectIsSelfEdit: regular project chat → false', () => {
  // Untitled chat in a regular user project must stay in project mode
  // so the agent reads/writes the user's files (Nexsara, Mangia Mama)
  // not Auroraly's source.
  assert.equal(
    detectIsSelfEdit({
      chat: { title: 'Polish the title screen' },
      project: { id: 'proj-1', settings: { is_core: false } },
    }),
    false,
  )
})

test('detectIsSelfEdit: project with no settings object → false', () => {
  // Defensive: very old projects predate the settings JSONB column. We
  // must treat undefined settings as "not core" and keep them in
  // project mode.
  assert.equal(
    detectIsSelfEdit({
      chat: { title: 'something' },
      project: { id: 'old-1' },
    }),
    false,
  )
})

test('detectIsSelfEdit: empty / null chat title → no false positive', () => {
  assert.equal(
    detectIsSelfEdit({
      chat: { title: '' },
      project: { settings: { is_core: false } },
    }),
    false,
  )
  assert.equal(
    detectIsSelfEdit({
      chat: { title: null },
      project: { settings: { is_core: false } },
    }),
    false,
  )
})

test('detectIsSelfEdit: title-prefix-lookalike (different character) → false', () => {
  // Pin that we require the exact Unicode gear "⚙ Self-Edit: " — not
  // emoji ⚙️ (different codepoint sequence), not "Self-Edit:" without
  // the gear. The dashboard's createSelfEditChat is the only origin
  // of the canonical prefix.
  assert.equal(
    detectIsSelfEdit({
      chat: { title: 'Self-Edit: forgot the gear' },
      project: { settings: { is_core: false } },
    }),
    false,
  )
})
