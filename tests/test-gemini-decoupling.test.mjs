// Locks the Gemini ↔ Emergent Universal Key decoupling contract (2026-02).
// See docs/UNIVERSAL_KEY_DECOUPLING.md for the full rationale.
//
// The contract:
//   1. AIService._apiKey reads ONLY direct keys, never proxy keys
//   2. When the Gemini direct key is missing, _buildProvider falls back
//      to OpenAI EXPLICITLY (loud log) — no silent proxy substitution
//   3. _proxyOptions returns an empty object (no baseURL ever set)
//   4. GeminiProvider's class doc reflects direct-only mode
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('AIService._apiKey reads only direct Google keys (no proxy fallback)', async () => {
  const src = await readFile(join(ROOT, 'lib/ai/service.js'), 'utf8')
  assert.match(src, /gemini:\s*process\.env\.GEMINI_API_KEY \|\| process\.env\.GOOGLE_API_KEY/)
  assert.match(src, /google:\s*process\.env\.GEMINI_API_KEY \|\| process\.env\.GOOGLE_API_KEY/)
  // No code path that reads EMERGENT_PROXY_URL or EMERGENT_LLM_KEY inside _apiKey
  assert.doesNotMatch(src, /_apiKey[\s\S]*?EMERGENT_PROXY_URL/, 'must not consult Emergent proxy env in _apiKey')
  assert.doesNotMatch(src, /_apiKey[\s\S]*?EMERGENT_LLM_KEY/, 'must not consult Emergent universal key env in _apiKey')
})

test('AIService._proxyOptions is a no-op (no baseURL ever set)', async () => {
  const src = await readFile(join(ROOT, 'lib/ai/service.js'), 'utf8')
  // Match the function body — must return literal {} and not consult
  // any EMERGENT_* env vars.
  const fn = src.match(/_proxyOptions\([^)]*\)\s*\{[\s\S]*?\n\s*\}/m)
  assert.ok(fn, '_proxyOptions must exist')
  assert.match(fn[0], /return \{\}/, 'must return empty object')
  assert.doesNotMatch(fn[0], /EMERGENT/, 'must not read EMERGENT_* env vars')
})

test('AIService._buildProvider explicitly logs Gemini fallback reason', async () => {
  const src = await readFile(join(ROOT, 'lib/ai/service.js'), 'utf8')
  // Must mention the specific Gemini case in the fallback log
  assert.match(src, /GEMINI_API_KEY\/GOOGLE_API_KEY set — falling back to OpenAI/)
  // Must not feed proxy options into createProvider on the fallback path
  assert.match(src, /createProvider\('openai', fallbackKey, this\.modelName, \{\}\)/)
})

test('GeminiProvider class doc reflects direct-only mode', async () => {
  const src = await readFile(join(ROOT, 'lib/ai/providers/gemini.js'), 'utf8')
  assert.match(src, /decoupled from Emergent Universal Key/i)
  assert.match(src, /direct Google API key only/i)
})

test('No production call site reads EMERGENT_PROXY_URL for chat routing', async () => {
  // The decoupling means EMERGENT_PROXY_URL must NOT be consulted in
  // service.js, message-stream.js, or providers/index.js's runtime
  // path. We allow comments referring to the legacy proxy, but not
  // actual `process.env.EMERGENT_PROXY_URL` reads.
  for (const f of ['lib/ai/service.js', 'lib/ai/message-stream.js']) {
    const src = await readFile(join(ROOT, f), 'utf8')
    assert.doesNotMatch(
      src,
      /process\.env\.EMERGENT_PROXY_URL/,
      `${f} must not read EMERGENT_PROXY_URL at runtime`,
    )
    assert.doesNotMatch(
      src,
      /process\.env\.EMERGENT_LLM_KEY/,
      `${f} must not read EMERGENT_LLM_KEY at runtime`,
    )
  }
})
