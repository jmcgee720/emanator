// ── prompt-builder + context system prompt tests ──
// Verifies the project-mode system prompt and capability boundaries
// correctly tell the AI it is building the USER's separate project —
// not editing Auroraly itself. Regression guard for the "frontend-only"
// and "scope confusion" bugs.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildCapabilityBoundaries } from '../lib/ai/prompt-builder.js'
import { formatContextAsSystemMessage } from '../lib/ai/context.js'

describe('buildCapabilityBoundaries — full-stack + Auroraly-source guardrail', () => {
  const text = buildCapabilityBoundaries()

  test('not gated to frontend-only', () => {
    assert.equal(text.toLowerCase().includes('frontend-only'), false)
    assert.equal(/\bno backend\b/i.test(text), false)
    assert.equal(text.toLowerCase().includes('no database logic'), false)
  })

  test('explicitly permits backend, databases, auth, fetch', () => {
    assert.match(text, /Backend/i)
    assert.match(text, /Database/i)
    assert.match(text, /Authentication/i)
    assert.match(text, /fetch/i)
  })

  test('forbids editing Auroraly source + directs to Core System chat', () => {
    assert.match(text, /Do not edit Auroraly/i)
    assert.match(text, /Core System chat/i)
  })

  test('forbids hardcoding credentials in source files', () => {
    assert.match(text, /hardcode/i)
    assert.match(text, /process\.env/)
  })

  test('forbids raw shell calls to Supabase / GitHub / Vercel', () => {
    assert.match(text, /shell calls|Supabase.*GitHub.*Vercel/i)
  })

  test('still a non-empty string', () => {
    assert.ok(typeof text === 'string' && text.length > 300)
  })
})

describe('formatContextAsSystemMessage — project-mode scope clarity', () => {
  const ctx = {
    project: { name: 'Nexsara', type: 'app', description: 'marketing intel' },
    files: [],
    canvas: null,
  }

  test('frames scope as USER PROJECT, not Auroraly', () => {
    const msg = formatContextAsSystemMessage(ctx, 'app', 'project')
    assert.match(msg, /USER PROJECT/i)
    assert.match(msg, /not Auroraly/i)
  })

  test('mentions Supabase storage + Fly preview hostname', () => {
    const msg = formatContextAsSystemMessage(ctx, 'app', 'project')
    assert.match(msg, /Supabase/i)
    assert.match(msg, /preview\.auroraly\.co/i)
  })

  test('forbids touching Auroraly source paths', () => {
    const msg = formatContextAsSystemMessage(ctx, 'app', 'project')
    assert.match(msg, /\/lib\/ai|\/components\/dashboard/i)
    assert.match(msg, /Core System chat/i)
  })

  test('forbids cross-project edits', () => {
    const msg = formatContextAsSystemMessage(ctx, 'app', 'project')
    assert.match(msg, /different user.s project/i)
  })

  test('embeds the project name', () => {
    const msg = formatContextAsSystemMessage(ctx, 'app', 'project')
    assert.match(msg, /Nexsara/)
  })

  test('includes capability boundaries inline', () => {
    const msg = formatContextAsSystemMessage(ctx, 'app', 'project')
    assert.match(msg, /YOUR CAPABILITIES|CAPABILITY BOUNDARIES/i)
  })
})
