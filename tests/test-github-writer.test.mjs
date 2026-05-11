// ── GitHub Writer Tests ──
//
// Mocks fetch to validate the Contents API round-trip. Proves:
//   • write_file PUT with no sha when creating
//   • write_file PUT with sha when updating existing
//   • edit_file fetches → modifies → PUTs with sha
//   • Error paths: missing config, bad repo format, file not found, ambiguous old_str
//   • Custom commit messages flow through

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildGithubWriter, buildMissingConfigWriter } from '../lib/ai/github-writer.js'

/* ── Fetch mock helpers ──────────────────────────────────────────── */

function makeFetchMock(scriptedResponses) {
  const calls = []
  let i = 0
  return {
    calls,
    async fetch(url, init = {}) {
      calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers })
      const handler = scriptedResponses[i++]
      if (typeof handler === 'function') {
        return handler({ url, init })
      }
      // Already a response-shaped object (built via jsonResponse) — return as-is
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

/* ── Tests ───────────────────────────────────────────────────────── */

describe('buildGithubWriter — configuration', () => {
  test('returns null when GITHUB_TOKEN is missing', () => {
    const w = buildGithubWriter({ repo: 'a/b', branch: 'main' })
    assert.equal(w, null)
  })

  test('returns null when GITHUB_REPO is missing', () => {
    const w = buildGithubWriter({ token: 'x', branch: 'main' })
    assert.equal(w, null)
  })

  test('throws on malformed GITHUB_REPO', () => {
    assert.throws(
      () => buildGithubWriter({ token: 'x', repo: 'no-slash', branch: 'main' }),
      /must be in "owner\/name" format/
    )
  })

  test('builds OK with all params', () => {
    const w = buildGithubWriter({ token: 't', repo: 'a/b', branch: 'main', fetch: () => {} })
    assert.equal(w.isConfigured, true)
    assert.equal(w.repo, 'a/b')
    assert.equal(w.branch, 'main')
    assert.equal(typeof w.writeFile, 'function')
    assert.equal(typeof w.editFile, 'function')
  })

  test('defaults branch to "main"', () => {
    const w = buildGithubWriter({ token: 't', repo: 'a/b', fetch: () => {} })
    assert.equal(w.branch, 'main')
  })
})

describe('buildGithubWriter — writeFile (create)', () => {
  test('creates a new file (404 on GET → PUT without sha)', async () => {
    const mock = makeFetchMock([
      jsonResponse(404, { message: 'Not Found' }),
      jsonResponse(201, { commit: { sha: 'newcommit123', html_url: 'https://github.com/a/b/commit/newcommit123' } }),
    ])
    const w = buildGithubWriter({ token: 'TOK', repo: 'a/b', branch: 'main', fetch: mock.fetch })
    const result = await w.writeFile('lib/new.js', 'export const x = 1', 'add new.js')
    assert.match(result, /Committed lib\/new\.js → a\/b@main/)
    assert.match(result, /newcomm/)

    // Verify the PUT body
    const putCall = mock.calls[1]
    assert.equal(putCall.method, 'PUT')
    const body = JSON.parse(putCall.body)
    assert.equal(body.message, 'add new.js')
    assert.equal(body.branch, 'main')
    assert.equal(body.sha, undefined, 'no sha on create')
    assert.equal(Buffer.from(body.content, 'base64').toString('utf-8'), 'export const x = 1')
  })

  test('PUT URL is /repos/{owner}/{repo}/contents/{path}', async () => {
    const mock = makeFetchMock([
      jsonResponse(404, {}),
      jsonResponse(201, { commit: { sha: 'abc' } }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'jmcgee720/emanator', branch: 'main', fetch: mock.fetch })
    await w.writeFile('lib/ai/foo.js', 'x', 'msg')
    assert.match(mock.calls[1].url, /api\.github\.com\/repos\/jmcgee720\/emanator\/contents\/lib\/ai\/foo\.js/)
  })

  test('rejects non-string content', async () => {
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: () => {} })
    await assert.rejects(() => w.writeFile('lib/x.js', { not: 'string' }), /content must be a string/)
  })
})

describe('buildGithubWriter — writeFile (update)', () => {
  test('updates existing file (200 on GET → PUT with sha)', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { sha: 'oldsha', content: b64('old'), encoding: 'base64' }),
      jsonResponse(200, { commit: { sha: 'updatesha' } }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', branch: 'main', fetch: mock.fetch })
    const result = await w.writeFile('lib/foo.js', 'NEW CONTENT')
    assert.match(result, /Committed lib\/foo\.js/)
    assert.match(result, /updates/)

    const putBody = JSON.parse(mock.calls[1].body)
    assert.equal(putBody.sha, 'oldsha', 'must include sha on update')
    assert.equal(Buffer.from(putBody.content, 'base64').toString('utf-8'), 'NEW CONTENT')
  })

  test('uses default commit message when none provided', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { sha: 's1', content: b64('x'), encoding: 'base64' }),
      jsonResponse(200, { commit: { sha: 'c1' } }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await w.writeFile('lib/foo.js', 'y')
    const body = JSON.parse(mock.calls[1].body)
    assert.match(body.message, /Auroraly agent: update lib\/foo\.js/)
  })
})

describe('buildGithubWriter — editFile', () => {
  test('fetches, replaces unique old_str, PUTs with sha', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { sha: 'sha1', content: b64('const x = 1\nexport default x'), encoding: 'base64' }),
      jsonResponse(200, { commit: { sha: 'commit2', html_url: 'https://x' } }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    const result = await w.editFile('lib/foo.js', 'const x = 1', 'const x = 42')
    assert.match(result, /Edited lib\/foo\.js/)
    assert.match(result, /Replaced 1 occurrence/)
    const putBody = JSON.parse(mock.calls[1].body)
    assert.equal(putBody.sha, 'sha1')
    assert.equal(Buffer.from(putBody.content, 'base64').toString('utf-8'), 'const x = 42\nexport default x')
  })

  test('rejects when file does not exist (404)', async () => {
    const mock = makeFetchMock([jsonResponse(404, {})])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', branch: 'main', fetch: mock.fetch })
    await assert.rejects(
      () => w.editFile('lib/missing.js', 'x', 'y'),
      /does not exist on a\/b@main/
    )
  })

  test('rejects when old_str is not found in file content', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { sha: 's', content: b64('totally different'), encoding: 'base64' }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await assert.rejects(() => w.editFile('lib/x.js', 'NOPE', 'y'), /old_str not found/)
  })

  test('rejects when old_str matches multiple times', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { sha: 's', content: b64('dup\ndup\nend'), encoding: 'base64' }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await assert.rejects(() => w.editFile('lib/x.js', 'dup', 'y'), /multiple locations/)
  })

  test('rejects empty old_str', async () => {
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: () => {} })
    await assert.rejects(() => w.editFile('lib/x.js', '', 'y'), /non-empty string/)
  })

  test('surfaces non-2xx PUT errors with body excerpt', async () => {
    const mock = makeFetchMock([
      jsonResponse(200, { sha: 's', content: b64('hello'), encoding: 'base64' }),
      jsonResponse(403, { message: 'Resource not accessible by personal access token' }),
    ])
    const w = buildGithubWriter({ token: 'T', repo: 'a/b', fetch: mock.fetch })
    await assert.rejects(
      () => w.editFile('lib/x.js', 'hello', 'world'),
      /GitHub PUT lib\/x\.js failed \(403\)/
    )
  })
})

describe('buildGithubWriter — auth headers', () => {
  test('all requests include Bearer token and api-version header', async () => {
    const mock = makeFetchMock([
      jsonResponse(404, {}),
      jsonResponse(201, { commit: { sha: 'a' } }),
    ])
    const w = buildGithubWriter({ token: 'MYTOKEN', repo: 'a/b', fetch: mock.fetch })
    await w.writeFile('x.js', 'y', 'm')
    for (const c of mock.calls) {
      assert.equal(c.headers['Authorization'], 'Bearer MYTOKEN')
      assert.equal(c.headers['X-GitHub-Api-Version'], '2022-11-28')
      assert.equal(c.headers['Accept'], 'application/vnd.github+json')
    }
  })
})

describe('buildMissingConfigWriter', () => {
  test('isConfigured=false and writes throw with setup instructions', async () => {
    const w = buildMissingConfigWriter(['GITHUB_TOKEN', 'GITHUB_REPO'])
    assert.equal(w.isConfigured, false)
    await assert.rejects(() => w.writeFile('x', 'y'), /GitHub writer is not configured/)
    await assert.rejects(() => w.editFile('x', 'o', 'n'), /GITHUB_TOKEN.*GITHUB_REPO/)
  })
})
