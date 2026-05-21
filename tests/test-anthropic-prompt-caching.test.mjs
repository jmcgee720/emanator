// ──────────────────────────────────────────────────────────────────────
// Anthropic prompt caching wiring
// ──────────────────────────────────────────────────────────────────────
// Pins:
//   1. System prompt is returned as a content-block array with an
//      ephemeral cache_control marker so Anthropic caches it.
//   2. Tool catalog has cache_control on the LAST tool, caching the
//      whole catalog (and the preceding system prompt) as one block.
//   3. `cacheControl: false` opt-out path keeps the old plain-string
//      shape for backwards compatibility / debugging.
//   4. chatWithToolsStream yields a structured `usage` event with
//      cache_creation_input_tokens, cache_read_input_tokens, and
//      estimated cost savings so the stream handler can store it on
//      the assistant message for billing analytics.
//
// Why this matters: yesterday's $170/day Anthropic burn was largely
// the ~10k tokens of system prompt + tool catalog being re-sent at
// full price on every turn. Caching those drops the marginal cost of
// each subsequent turn by ~70%.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AnthropicProvider } from '../lib/ai/providers/anthropic.js'

// We don't want these tests to actually hit the Anthropic API.
// Instead we instantiate the provider with a fake key and exercise
// only the pure conversion methods (_convertMessages, _convertTools).
// Those are the parts that implement the caching contract.
function makeProvider() {
  return new AnthropicProvider('sk-ant-fake-for-tests', 'claude-sonnet-4-5-20250929')
}

// ── _convertMessages ─────────────────────────────────────────────

test('_convertMessages: system returned as content-block array with cache_control when cacheSystem=true', () => {
  const p = makeProvider()
  const { system } = p._convertMessages(
    [{ role: 'system', content: 'You are a helpful agent. Be concise.' }],
    { cacheSystem: true },
  )
  assert.ok(Array.isArray(system), 'system must be an array of content blocks when caching')
  assert.equal(system.length, 1)
  assert.equal(system[0].type, 'text')
  assert.match(system[0].text, /helpful agent/)
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral' }, 'must mark with ephemeral cache_control')
})

test('_convertMessages: system returned as plain string when cacheSystem=false (back-compat)', () => {
  const p = makeProvider()
  const { system } = p._convertMessages(
    [{ role: 'system', content: 'You are a helpful agent.' }],
    { cacheSystem: false },
  )
  assert.equal(typeof system, 'string', 'opt-out must return string for back-compat')
  assert.match(system, /helpful agent/)
})

test('_convertMessages: empty system stays empty even with cacheSystem=true (no useless cache marker)', () => {
  const p = makeProvider()
  const { system } = p._convertMessages(
    [{ role: 'user', content: 'hi' }],
    { cacheSystem: true },
  )
  // No system content → return an empty string, NOT a block array
  // with empty text. Anthropic would reject the empty block.
  assert.equal(system, '', 'empty system stays empty')
})

test('_convertMessages: multiple system messages are concatenated under one cache marker', () => {
  const p = makeProvider()
  const { system } = p._convertMessages(
    [
      { role: 'system', content: 'Rule 1' },
      { role: 'system', content: 'Rule 2' },
    ],
    { cacheSystem: true },
  )
  assert.ok(Array.isArray(system))
  assert.equal(system.length, 1, 'must coalesce into one block — one cache marker')
  assert.match(system[0].text, /Rule 1[\s\S]*Rule 2/)
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral' })
})

test('_convertMessages: cacheSystem defaults to true when option omitted', () => {
  const p = makeProvider()
  const { system } = p._convertMessages([{ role: 'system', content: 'x' }])
  assert.ok(Array.isArray(system), 'default behaviour is to cache the system prompt')
})

// ── _convertTools ────────────────────────────────────────────────

test('_convertTools: cache_control placed on the LAST tool only when cacheTools=true', () => {
  const p = makeProvider()
  const tools = p._convertTools(
    [
      { function: { name: 'read_file', description: 'r', parameters: { type: 'object' } } },
      { function: { name: 'write_file', description: 'w', parameters: { type: 'object' } } },
      { function: { name: 'edit_file', description: 'e', parameters: { type: 'object' } } },
    ],
    { cacheTools: true },
  )
  assert.equal(tools.length, 3)
  assert.equal(tools[0].cache_control, undefined, 'first tool has no marker')
  assert.equal(tools[1].cache_control, undefined, 'middle tool has no marker')
  assert.deepEqual(tools[2].cache_control, { type: 'ephemeral' }, 'last tool MUST have cache_control')
})

test('_convertTools: no cache_control when cacheTools=false (back-compat)', () => {
  const p = makeProvider()
  const tools = p._convertTools(
    [{ function: { name: 'read_file', description: 'r', parameters: { type: 'object' } } }],
    { cacheTools: false },
  )
  assert.equal(tools[0].cache_control, undefined)
})

test('_convertTools: empty tool list returns empty array (no marker on nothing)', () => {
  const p = makeProvider()
  assert.deepEqual(p._convertTools([], { cacheTools: true }), [])
  assert.deepEqual(p._convertTools(null, { cacheTools: true }), [])
  assert.deepEqual(p._convertTools(undefined, { cacheTools: true }), [])
})

test('_convertTools: cacheTools defaults to true when option omitted', () => {
  const p = makeProvider()
  const tools = p._convertTools([
    { function: { name: 'x', description: 'x', parameters: { type: 'object' } } },
  ])
  assert.deepEqual(tools[0].cache_control, { type: 'ephemeral' }, 'default-on caching')
})

test('_convertTools: schema mapping survives caching (name + description + input_schema)', () => {
  // Regression — caching shouldn't have mangled the OpenAI→Anthropic
  // field renames (parameters → input_schema, etc).
  const p = makeProvider()
  const tools = p._convertTools(
    [{
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    }],
    { cacheTools: true },
  )
  assert.equal(tools[0].name, 'read_file')
  assert.equal(tools[0].description, 'Read a file')
  assert.deepEqual(tools[0].input_schema.properties.path, { type: 'string' })
  assert.deepEqual(tools[0].cache_control, { type: 'ephemeral' })
})

// ── Source-level cost-savings calculation ────────────────────────

test('cost-savings log: provider emits [anthropic-cache] line + usage event after the stream', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const src = await readFile(join(__dirname, '..', 'lib', 'ai', 'providers', 'anthropic.js'), 'utf8')

  // Pin the structured logging contract — billing analytics depend
  // on these field names being stable. The stream handler reads the
  // emitted `usage` event and persists it on the assistant message.
  assert.match(src, /\[anthropic-cache\]/, 'must emit a grep-able log prefix')
  assert.match(src, /cache_creation_input_tokens/, 'must log cache creation count')
  assert.match(src, /cache_read_input_tokens/, 'must log cache read count')
  assert.match(src, /estimated_savings_usd/, 'must log estimated savings in USD')
  assert.match(src, /yield \{\s*type: 'usage'/, 'must yield a structured usage event for the stream handler')
})

test('cost-savings: baseline vs actual cost math uses Sonnet 4.5 pricing', async () => {
  // The literal multipliers in the cost calculation are pinned so a
  // future refactor that swaps pricing accidentally breaks the math
  // is caught here.
  //   - Standard input: $3 / 1M tokens
  //   - Cache creation: 1.25x standard = $3.75 / 1M
  //   - Cache read: 10% standard = $0.30 / 1M
  //   - Output: $15 / 1M
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const src = await readFile(join(__dirname, '..', 'lib', 'ai', 'providers', 'anthropic.js'), 'utf8')
  assert.match(src, /\* 3 \/ 1_000_000/, 'standard input pricing must be $3/M')
  assert.match(src, /\* 3\.75 \/ 1_000_000/, 'cache creation must be $3.75/M (1.25x)')
  assert.match(src, /\* 0\.30 \/ 1_000_000/, 'cache read must be $0.30/M (10%)')
  assert.match(src, /\* 15 \/ 1_000_000/, 'output must be $15/M')
})
