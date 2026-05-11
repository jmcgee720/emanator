// ── GitHub Reader Tests ──
//
// Proves that on serverless, read_file / list_files / search_files fetch
// from the live GitHub repo (NOT the tree-shaken Lambda bundle at /var/task).
// This is what fixes the user's observation that the AI couldn't find the
// streaming engine because it wasn't in the deployed bundle.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildGithubReader } from '../lib/ai/github-writer.js'

function makeFetchMock(scriptedResponses) {
  const calls = []
  let i = 0
  return {
    calls,
    async fetch(url, init = {}) {
      calls.push({ url, method: init.method || 'GET', headers: init.headers })
      const handler = scriptedResponses[i++]
      if (typeof handler === 'function') return handler({ url, init })
      return handler
    },
  }
}

function jsonResponse(status, bodyObj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return bodyObj },
    async text() { return JSON.stringify(bodyObj) },
  }
}

function b64(s) { return Buffer.from(s, 'utf-8').toString('base64') }

/* ──────────────────────────────────────────────────────────────────── */

describe('buildGithubReader — configuration', () => {
  test('returns null without token', () => {
    assert.equal(buildGithubReader({ repo: 'a/b' }), null)
  })
  test('returns null without repo', () => {
    assert.equal(buildGithubReader({ token: 't' }), null)
  })
  test('throws on malformed repo', () => {
    assert.throws(() => buildGithubReader({ token: 't', repo: 'no-slash' }), /must be in "owner\/name"/)
  })
  test('exposes the expected API surface', () => {
    const r = buildGithubReader({ token: 't', repo: 'a/b', fetch: () => {} })
    assert.equal(r.isConfigured, true)
    assert.equal(r.repo, 'a/b')
    assert.equal(r.branch, 'main')
    assert.equal(typeof r.readFile, 'function')
    assert.equal(typeof r.listFiles, 'function')
    assert.equal(typeof r.searchFiles, 'function')
  })
})

describe('readFile — fetches from GitHub Contents API', () => {
  test('returns { content, lineCount, source } for a real file', async () => {
    const sourceCode = 'export const x = 1\nexport const y = 2\n// line 3'
    const mock = makeFetchMock([
      jsonResponse(200, { content: b64(sourceCode), encoding: 'base64', sha: 'abc' }),
    ])
    const r = buildGithubReader({ token: 'T', repo: 'jmcgee720/emanator', branch: 'main', fetch: mock.fetch })
    const out = await r.readFile('lib/api/stream-handler-v2.js')
    assert.equal(out.content, sourceCode)
    assert.equal(out.lineCount, 3)
    assert.equal(out.source, 'jmcgee720/emanator@main/lib/api/stream-handler-v2.js')

    // Verify request was made correctly
    assert.match(mock.calls[0].url, /\/repos\/jmcgee720\/emanator\/contents\/lib\/api\/stream-handler-v2\.js\?ref=main/)
    assert.equal(mock.calls[0].headers.Authorization, 'Bearer T')
  })

  test('rejects 404 with a clear error', async () => {
    const mock = makeFetchMock([jsonResponse(404, { message: 'Not Found' })])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', branch: 'main', fetch: mock.fetch })
    await assert.rejects(() => r.readFile('lib/missing.js'), /not found on a\/b@main/)
  })

  test('rejects a directory result (Contents API returns array for dirs)', async () => {
    const mock = makeFetchMock([jsonResponse(200, [{ name: 'foo.js', path: 'lib/foo.js', type: 'file' }])])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await assert.rejects(() => r.readFile('lib'), /is a directory, not a file/)
  })

  test('truncates content over maxBytes', async () => {
    const huge = 'x'.repeat(500_000)
    const mock = makeFetchMock([jsonResponse(200, { content: b64(huge), encoding: 'base64' })])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    const out = await r.readFile('big.txt', 1024)
    assert.ok(out.content.length < 2000)
    assert.match(out.content, /truncated at 1024 bytes/)
  })
})

describe('listFiles — uses Git Tree API + glob filter', () => {
  test('returns paths matching the glob pattern', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, {
        tree: [
          { path: 'lib/ai/agent-core.js', type: 'blob' },
          { path: 'lib/ai/agent-tools-v2.js', type: 'blob' },
          { path: 'lib/api/stream-handler-v2.js', type: 'blob' },
          { path: 'lib/ai/foo.js', type: 'blob' },
          { path: 'README.md', type: 'blob' },
          { path: 'lib/ai', type: 'tree' }, // directory — should be filtered out
        ],
      }),
    ])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    const matches = await r.listFiles('*stream*')
    assert.ok(matches.includes('lib/api/stream-handler-v2.js'))
    // Should NOT include tree (directory) entries
    assert.equal(matches.includes('lib/ai'), false)
  })

  test('matches exact filenames (e.g. "agent-core.js")', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, {
        tree: [
          { path: 'lib/ai/agent-core.js', type: 'blob' },
          { path: 'lib/ai/other.js', type: 'blob' },
        ],
      }),
    ])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    const matches = await r.listFiles('agent-core.js')
    assert.deepEqual(matches, ['lib/ai/agent-core.js'])
  })

  test('respects basePath filter (only files under that prefix)', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, {
        tree: [
          { path: 'lib/ai/foo.js', type: 'blob' },
          { path: 'lib/api/foo.js', type: 'blob' },
          { path: 'app/foo.js', type: 'blob' },
        ],
      }),
    ])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    const matches = await r.listFiles('foo.js', 'lib/ai')
    assert.deepEqual(matches, ['lib/ai/foo.js'])
  })

  test('caches the tree for subsequent calls (only one HTTP request)', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { tree: [{ path: 'lib/x.js', type: 'blob' }] }),
    ])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await r.listFiles('*.js')
    await r.listFiles('x.js')
    await r.listFiles('*.ts')
    assert.equal(mock.calls.length, 1, 'tree must be cached, not re-fetched per call')
  })

  test('surfaces tree API errors with body excerpt', async () => {
    const mock = makeFetchMock([jsonResponse(403, { message: 'API rate limit exceeded' })])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await assert.rejects(() => r.listFiles('*.js'), /GitHub GET tree failed \(403\)/)
  })
})

describe('searchFiles — uses GitHub Code Search API', () => {
  test('builds query with repo qualifier and returns formatted matches', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, {
        items: [
          { path: 'lib/api/stream-handler-v2.js', html_url: 'https://github.com/a/b/blob/main/lib/api/stream-handler-v2.js' },
          { path: 'lib/ai/agent-core.js', html_url: 'https://github.com/a/b/blob/main/lib/ai/agent-core.js' },
        ],
      }),
    ])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    const out = await r.searchFiles('handleStreamMessageV2')
    assert.match(out, /lib\/api\/stream-handler-v2\.js/)
    assert.match(out, /lib\/ai\/agent-core\.js/)
    // Verify the query string was built correctly
    assert.match(mock.calls[0].url, /\/search\/code\?q=/)
    assert.match(decodeURIComponent(mock.calls[0].url), /handleStreamMessageV2 repo:a\/b/)
  })

  test('appends path: qualifier when basePath provided', async () => {
    const mock = makeFetchMock([jsonResponse(200, { items: [] })])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await r.searchFiles('foo', 'lib/ai')
    assert.match(decodeURIComponent(mock.calls[0].url), /path:lib\/ai/)
  })

  test('returns no-match message when search has zero results', async () => {
    const mock = makeFetchMock([jsonResponse(200, { items: [] })])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', branch: 'main', fetch: mock.fetch })
    const out = await r.searchFiles('zzz-does-not-exist-9999')
    assert.match(out, /no matches for "zzz-does-not-exist-9999" in a\/b@main/)
  })

  test('surfaces search errors with body excerpt', async () => {
    const mock = makeFetchMock([jsonResponse(422, { message: 'Validation Failed' })])
    const r = buildGithubReader({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await assert.rejects(() => r.searchFiles('x'), /GitHub search failed \(422\)/)
  })
})

describe('reader applied to readFileTool — proves the user-reported scenario is fixed', () => {
  test('reading a file that is NOT in /var/task BUT IS on GitHub succeeds', async () => {
    // This is the exact scenario from the user's screenshot: lib/api/stream-handler-v2.js
    // doesn't exist in the Lambda bundle, but it does exist on GitHub.
    const realCode = 'import { runAgent } from "@/lib/ai/agent-core"\nexport async function handleStreamMessageV2() {}'
    const { readFileTool } = await import('../lib/ai/agent-tools-v2.js')
    const mock = makeFetchMock([
      jsonResponse(200, { content: b64(realCode), encoding: 'base64', sha: 'a' }),
    ])
    const reader = buildGithubReader({ token: 'T', repo: 'jmcgee720/emanator', branch: 'main', fetch: mock.fetch })
    const tool = readFileTool(
      { rootDirs: ['/var/task'], excludePaths: ['/var/task/node_modules', '/var/task/.next'] },
      reader
    )
    const out = await tool.execute({ path: '/var/task/lib/api/stream-handler-v2.js' })
    assert.match(out, /handleStreamMessageV2/)
    assert.match(out, /jmcgee720\/emanator@main/)
    // The Lambda fs is empty for this path — proves we did NOT fall through to fs
    const fs = await import('node:fs')
    assert.equal(fs.existsSync('/var/task/lib/api/stream-handler-v2.js'), false)
  })
})
