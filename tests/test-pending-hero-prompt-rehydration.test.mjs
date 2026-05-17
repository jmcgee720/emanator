// Regression test for the Creative Brief route-navigation drop bug.
//
// Symptom (Feb 2026): user submits a Creative Brief on the Project Bin
// (`/`). The form stashed the build payload in `pendingHeroPromptRef`
// (a React useRef on the bin's Dashboard). Then `router.replace` fired
// to `/project/[id]` to open the new project. Next.js App Router
// unmounts the bin Dashboard — including its useRef — and mounts a
// fresh Dashboard under `/project/[id]/page.js`. The new Dashboard's
// `pendingHeroPromptRef.current` starts null, so `HeroPromptEffect`
// silently no-oped and the brief never reached the AI. User saw an
// empty chat.
//
// The fix: mirror the payload to sessionStorage on the write side and
// rehydrate from sessionStorage on the read side. sessionStorage
// survives client-side navigation within the same tab. Once consumed,
// the entry is removed so it doesn't replay on a manual refresh.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Tiny stub of the relevant window.sessionStorage surface.
function makeStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)) },
    removeItem: (k) => { data.delete(k) },
    _size: () => data.size,
    _all: () => Object.fromEntries(data),
  }
}

// Mirror of ProjectGrid.jsx onStartBuilding write logic.
function writePendingPrompt(storage, payload) {
  try {
    storage.setItem('auroraly:pending_hero_prompt', JSON.stringify(payload))
  } catch {}
}

// Mirror of Dashboard.jsx HeroPromptEffect rehydration logic.
function rehydratePendingPrompt(storage, currentRef) {
  if (currentRef.value) return currentRef.value
  try {
    const raw = storage.getItem('auroraly:pending_hero_prompt')
    if (raw) {
      currentRef.value = JSON.parse(raw)
      storage.removeItem('auroraly:pending_hero_prompt')
    }
  } catch {}
  return currentRef.value
}

test('write side stashes the full brief payload in sessionStorage', () => {
  const storage = makeStorage()
  writePendingPrompt(storage, {
    displayMessage: 'Build me a SaaS for marketing intelligence',
    fullInstruction: 'Build a Next.js + Tailwind SaaS … (long brief instruction)',
    attachments: [{ name: 'mood.png', url: 'data:image/png;base64,…' }],
    modelChoice: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  })
  const raw = storage.getItem('auroraly:pending_hero_prompt')
  assert.ok(raw, 'sessionStorage entry should exist after write')
  const parsed = JSON.parse(raw)
  assert.equal(parsed.displayMessage, 'Build me a SaaS for marketing intelligence')
  assert.equal(parsed.modelChoice.model, 'claude-sonnet-4-5')
  assert.equal(parsed.attachments.length, 1)
})

test('read side rehydrates into an empty ref when ref is null (the bug case)', () => {
  const storage = makeStorage()
  writePendingPrompt(storage, { displayMessage: 'Hi', fullInstruction: 'Hi long form' })

  // Simulate the new (post-navigation) Dashboard mount: fresh ref.
  const newRef = { value: null }
  const result = rehydratePendingPrompt(storage, newRef)

  assert.ok(result, 'rehydration should return a payload')
  assert.equal(result.displayMessage, 'Hi')
  assert.equal(newRef.value.displayMessage, 'Hi')
})

test('read side clears sessionStorage after consuming (no replay on refresh)', () => {
  const storage = makeStorage()
  writePendingPrompt(storage, { displayMessage: 'one-shot' })

  const ref = { value: null }
  rehydratePendingPrompt(storage, ref)

  assert.equal(storage._size(), 0, 'sessionStorage entry should be removed after first read')

  // Second mount (e.g. user refreshes) — no leftover payload.
  const ref2 = { value: null }
  const result2 = rehydratePendingPrompt(storage, ref2)
  assert.equal(result2, null, 'no replay on subsequent mounts')
})

test('read side leaves ref unchanged when ref already has a value (same-mount path)', () => {
  // In the happy path where Dashboard doesn't remount (e.g. WebContainer
  // engine in prior architecture), the ref carries the payload directly
  // and rehydration should be a no-op so we don't double-consume.
  const storage = makeStorage()
  writePendingPrompt(storage, { displayMessage: 'from storage' })

  const ref = { value: { displayMessage: 'from ref' } }
  const result = rehydratePendingPrompt(storage, ref)

  assert.equal(result.displayMessage, 'from ref', 'ref value takes precedence')
  // Storage should still have its entry for any later mount cycle to consume.
  assert.ok(storage.getItem('auroraly:pending_hero_prompt'))
})

test('rehydration tolerates malformed JSON without crashing', () => {
  const storage = makeStorage()
  storage.setItem('auroraly:pending_hero_prompt', '{ not: valid')
  const ref = { value: null }
  const result = rehydratePendingPrompt(storage, ref)
  assert.equal(result, null)
})
