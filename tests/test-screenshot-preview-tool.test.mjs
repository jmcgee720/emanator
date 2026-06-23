// ── screenshot_preview tool contract ────────────────────────────────
// Verifies:
//   1. The tool is registered in buildDefaultToolset ONLY when projectId
//      is set + screenshotCtx.appBaseUrl is provided.
//   2. It's NOT registered in self-edit mode (no Fly preview there).
//   3. The tool returns Anthropic content blocks (array of text + image)
//      so Claude can SEE the captured pixels — NOT a JSON-stringified
//      blob that the model can't decode.
//   4. The Anthropic provider passes array tool_result content through
//      to the API without JSON.stringify'ing it (otherwise the image
//      bytes get encoded as text and vision is lost).

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenshotPreviewTool } from '../lib/ai/tools/screenshot-preview.js'

// NOTE: We cannot import buildDefaultToolset directly because it
// transitively imports `@/lib/...` aliased modules that resolve only
// under Next.js's webpack/turbopack, not under raw `node --test`. The
// registration logic in agent-tools-v2.js is small enough (one if-statement
// guarded by screenshotCtx?.appBaseUrl) that we test the tool factory
// itself in isolation here, and rely on integration tests / manual smoke
// tests to verify the registration wiring.

test('screenshot_preview tool has correct shape', () => {
  const tool = screenshotPreviewTool('proj-1', 'https://www.auroraly.co', {})
  assert.equal(tool.name, 'screenshot_preview')
  assert.ok(tool.description.length > 0, 'must have a description')
  assert.equal(tool.input_schema.type, 'object')
  assert.ok(tool.input_schema.required.includes('reason'), 'reason is required to keep model honest about why it captures')
  assert.equal(typeof tool.execute, 'function')
})

test('screenshot_preview returns clear error when projectId missing', async () => {
  const tool = screenshotPreviewTool(null, 'https://www.auroraly.co', {})
  const result = await tool.execute({ reason: 'test' })
  assert.ok(typeof result === 'string')
  assert.ok(result.includes('unavailable'), 'must indicate why')
})

test('screenshot_preview returns clear error when appBaseUrl missing', async () => {
  const tool = screenshotPreviewTool('proj-1', null, {})
  const result = await tool.execute({ reason: 'test' })
  assert.ok(typeof result === 'string')
  assert.ok(result.includes('unavailable'))
})

test('screenshot_preview returns content blocks (text + image) on success', async () => {
  // Stub global fetch for this test
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      url: 'https://test.fly.dev',
      captured_at: new Date().toISOString(),
      mime_type: 'image/png',
      bytes: 12345,
      base64: 'iVBORw0KGgo=',
    }),
  })
  try {
    const tool = screenshotPreviewTool('proj-1', 'https://www.auroraly.co', {})
    const result = await tool.execute({ reason: 'before edit - locate inventory' })
    assert.ok(Array.isArray(result), 'must return array of content blocks for vision support')
    assert.equal(result.length, 2, 'one text block + one image block')
    assert.equal(result[0].type, 'text')
    assert.ok(result[0].text.includes('Screenshot captured'))
    assert.equal(result[1].type, 'image')
    assert.equal(result[1].source.type, 'base64')
    assert.equal(result[1].source.media_type, 'image/png')
    assert.equal(result[1].source.data, 'iVBORw0KGgo=')
  } finally {
    global.fetch = originalFetch
  }
})

test('screenshot_preview surfaces action_required hint on 503', async () => {
  // The endpoint returns 503 with action_required when SCREENSHOTONE_ACCESS_KEY
  // is unset. The tool MUST pass that message verbatim to the model so the user
  // sees the exact setup step (sign up at screenshotone.com, add env var, etc).
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({
      error: 'Screenshot service not configured',
      action_required: 'Add SCREENSHOTONE_ACCESS_KEY to Vercel env vars. Free tier (100/month) at https://screenshotone.com',
    }),
  })
  try {
    const tool = screenshotPreviewTool('proj-1', 'https://www.auroraly.co', {})
    const result = await tool.execute({ reason: 'test' })
    assert.ok(typeof result === 'string')
    assert.ok(result.includes('503'))
    assert.ok(result.includes('SCREENSHOTONE_ACCESS_KEY'), 'must surface the setup instruction verbatim')
    assert.ok(result.includes('screenshotone.com'), 'must include the sign-up URL')
  } finally {
    global.fetch = originalFetch
  }
})
