/**
 * Tests for the Tavily-backed web_search tool.
 *
 * Shipped 2026-05-24 to close the knowledge-gap class of fabrication
 * that the screenshot-inventory anti-fabrication validator could not:
 * stale platform-UI knowledge (e.g. Google Cloud OAuth console moved
 * "Test users" under the new "Audience" tab in late 2025; Claude
 * Sonnet 4.5's training cutoff is before that change).
 *
 * The tool calls Tavily's REST endpoint directly via fetch — we mock
 * the global fetch in tests so no real Tavily credits are burned and
 * the tests run offline.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

let webSearchTool
const originalEnv = { ...process.env }
const originalFetch = global.fetch

before(async () => {
  // Module is imported AFTER we set env so apiKey is read correctly
  // at definition time. Done in `before` so test ordering is stable.
  process.env.TAVILY_API_KEY = 'tvly-test-fixture-key-do-not-use'
  const mod = await import('../lib/ai/tools/web-search.js')
  webSearchTool = mod.webSearchTool
})

after(() => {
  process.env = { ...originalEnv }
  global.fetch = originalFetch
})

function mockFetch(response, { status = 200, headers = {} } = {}) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k) => headers[k.toLowerCase()] ?? null,
    },
    json: async () => response,
    text: async () => typeof response === 'string' ? response : JSON.stringify(response),
  })
}

test('webSearchTool: returns a properly-shaped tool definition', () => {
  const tool = webSearchTool()
  assert.equal(tool.name, 'web_search')
  assert.ok(tool.description.length > 100, 'has substantive description')
  assert.match(tool.description, /Google Cloud|Stripe|Supabase|Vercel/i, 'description mentions concrete platforms')
  assert.match(tool.description, /training data|reorganised|cutoff|out of date/i, 'description explains the staleness rationale')
  assert.equal(tool.input_schema.type, 'object')
  assert.deepEqual(tool.input_schema.required, ['query'])
  assert.equal(typeof tool.execute, 'function')
})

test('webSearchTool: executes a normal search and returns normalised JSON', async () => {
  mockFetch({
    results: [
      { title: 'Test Title', url: 'https://example.com/a', content: 'Some snippet', published_date: '2026-01-15' },
      { title: 'Another', url: 'https://example.com/b', content: 'More text' },
    ],
    answer: 'Synthesised summary text',
  })
  const tool = webSearchTool()
  const result = await tool.execute({ query: 'Google OAuth Test users 2025' })
  const parsed = JSON.parse(result)
  assert.equal(parsed.query, 'Google OAuth Test users 2025')
  assert.equal(parsed.answer, 'Synthesised summary text')
  assert.equal(parsed.results.length, 2)
  assert.equal(parsed.results[0].title, 'Test Title')
  assert.equal(parsed.results[0].url, 'https://example.com/a')
  assert.equal(parsed.results[0].snippet, 'Some snippet')
  assert.equal(parsed.results[0].published_date, '2026-01-15')
})

test('webSearchTool: clamps max_results into [1, 10]', async () => {
  let capturedBody
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [], answer: null }),
      text: async () => '',
    }
  }
  const tool = webSearchTool()
  await tool.execute({ query: 'x', max_results: 99 })
  assert.equal(capturedBody.max_results, 10, 'caps at 10')
  await tool.execute({ query: 'x', max_results: 0 })
  assert.equal(capturedBody.max_results, 1, 'floors at 1')
  await tool.execute({ query: 'x' })
  assert.equal(capturedBody.max_results, 5, 'defaults to 5')
})

test('webSearchTool: passes topic/time_range/include_domains through to Tavily', async () => {
  let capturedBody
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [], answer: null }),
      text: async () => '',
    }
  }
  const tool = webSearchTool()
  await tool.execute({
    query: 'recent Google OAuth changes',
    topic: 'news',
    time_range: 'year',
    include_domains: ['cloud.google.com', 'developers.google.com'],
  })
  assert.equal(capturedBody.topic, 'news')
  assert.equal(capturedBody.time_range, 'year')
  assert.deepEqual(capturedBody.include_domains, ['cloud.google.com', 'developers.google.com'])
})

test('webSearchTool: returns clear error when query is missing/empty', async () => {
  const tool = webSearchTool()
  const r1 = await tool.execute({})
  assert.match(r1, /query.*required/i)
  const r2 = await tool.execute({ query: '   ' })
  assert.match(r2, /query.*required/i)
})

test('webSearchTool: surfaces 4xx auth errors immediately (no retry)', async () => {
  let calls = 0
  global.fetch = async () => {
    calls++
    return {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: () => null },
      json: async () => ({ error: 'Invalid API key' }),
      text: async () => '{"error":"Invalid API key"}',
    }
  }
  const tool = webSearchTool()
  const result = await tool.execute({ query: 'x' })
  assert.match(result, /web_search failed/i)
  assert.match(result, /401/, 'surfaces the 401 status to the model')
  assert.equal(calls, 1, '4xx is not retried')
})

test('webSearchTool: retries on 429 then succeeds (rate limit recovery)', async () => {
  let calls = 0
  global.fetch = async () => {
    calls++
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: (k) => k.toLowerCase() === 'retry-after' ? '0' : null },
        json: async () => ({ error: 'rate limit' }),
        text: async () => 'rate limit',
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ results: [{ title: 'OK', url: 'x', content: 'y' }], answer: null }),
      text: async () => '',
    }
  }
  const tool = webSearchTool()
  const result = await tool.execute({ query: 'x' })
  const parsed = JSON.parse(result)
  assert.equal(parsed.results.length, 1)
  assert.equal(calls, 2, 'retried after 429')
})

test('webSearchTool: graceful response when TAVILY_API_KEY is missing', async () => {
  delete process.env.TAVILY_API_KEY
  // Re-import: the factory reads env at construction time.
  const mod = await import('../lib/ai/tools/web-search.js?nokey')
  const tool = mod.webSearchTool()
  const result = await tool.execute({ query: 'x' })
  assert.match(result, /unavailable|not configured/i, 'tells the model the tool is unavailable')
  assert.match(result, /training-data|out of date/i, 'instructs honest fallback')
  // Restore for subsequent tests in the file (none currently follow).
  process.env.TAVILY_API_KEY = 'tvly-test-fixture-key-do-not-use'
})
