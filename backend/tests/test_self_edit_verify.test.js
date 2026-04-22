/**
 * Tests for the extracted self-edit-verify helper. Mocks global fetch
 * and uses a real temp file on disk so the revert-on-build-break path
 * can be observed end-to-end.
 */

import fs from 'fs'
import path from 'path'

import { verifyAndRevertSelfEdit } from '../../lib/ai/self-edit-verify.js'

const TEST_REL = `.test-artifacts/verify-test-${process.pid}.txt`
const TEST_FULL = path.join('/app', TEST_REL)
const ORIGINAL = 'original content\n'
const MODIFIED = 'modified (possibly broken) content\n'

const realFetch = global.fetch

function writeTestFile(content) {
  fs.mkdirSync(path.dirname(TEST_FULL), { recursive: true })
  fs.writeFileSync(TEST_FULL, content)
}

function cleanupTestFile() {
  try { fs.unlinkSync(TEST_FULL) } catch {}
  try { fs.rmdirSync(path.dirname(TEST_FULL)) } catch {}
}

beforeEach(() => {
  writeTestFile(MODIFIED)
})

afterEach(() => {
  cleanupTestFile()
  global.fetch = realFetch
})

function mockFetchOk(html = '<!doctype html><html><body>hello</body></html>') {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => html,
  })
}

function mockFetchBroken(html = '<pre>Build Error: Expected }\nUnexpected token\n  at /app/foo.js:12</pre>') {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: async () => html,
  })
}

function mockFetchThrow(err = new Error('fetch failed')) {
  global.fetch = jest.fn().mockRejectedValue(err)
}

describe('verifyAndRevertSelfEdit — healthy build', () => {
  it('returns verified:true and does NOT mutate editResult', async () => {
    mockFetchOk()
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    const r = await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'search_replace', { waitMs: 0 })
    expect(r).toEqual(expect.objectContaining({ verified: true, reverted: false }))
    expect(editResult.success).toBe(true)
    expect(editResult.errors).toEqual([])
    // File on disk is untouched
    expect(fs.readFileSync(TEST_FULL, 'utf8')).toBe(MODIFIED)
  })

  it('hits /?_verify=<ts> with cache-busting + timeout', async () => {
    mockFetchOk()
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'edit_lines', { waitMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toMatch(/^http:\/\/localhost:3000\/\?_verify=\d+$/)
    expect(init.headers['Cache-Control']).toBe('no-cache')
    expect(init.headers.Accept).toBe('text/html')
  })
})

describe('verifyAndRevertSelfEdit — broken build', () => {
  it('reverts the file and pushes a BUILD BROKEN error when HTML contains markers', async () => {
    mockFetchBroken()
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    const r = await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'search_replace', { waitMs: 0 })
    expect(r.verified).toBe(false)
    expect(r.reverted).toBe(true)
    expect(editResult.success).toBe(false)
    expect(editResult.errors.length).toBeGreaterThanOrEqual(1)
    expect(editResult.errors.join('\n')).toMatch(/BUILD BROKEN/)
    // File on disk now contains ORIGINAL (reverted)
    expect(fs.readFileSync(TEST_FULL, 'utf8')).toBe(ORIGINAL)
  })

  it('uses the edit_lines-specific error wording when label=edit_lines', async () => {
    mockFetchBroken()
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'edit_lines', { waitMs: 0 })
    expect(editResult.errors.join('\n')).toMatch(/To fix this:/)
    expect(editResult.errors.join('\n')).toMatch(/read_files/)
  })

  it('reverts when pageRes.ok=false even without build-error markers', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'Server unavailable',
    })
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    const r = await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'search_replace', { waitMs: 0 })
    expect(r.verified).toBe(false)
    expect(r.reverted).toBe(true)
    expect(editResult.success).toBe(false)
  })

  it('error text is extracted from the page HTML', async () => {
    mockFetchBroken('<div>Error: Unexpected token xyzmarker at line 42</div>')
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    const r = await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'edit_lines', { waitMs: 0 })
    expect(r.error).toMatch(/xyzmarker/)
  })
})

describe('verifyAndRevertSelfEdit — fetch throws', () => {
  it('reverts and returns verified:false when the dev server is unreachable', async () => {
    mockFetchThrow()
    const editResult = { success: true, errors: [], originalContent: ORIGINAL }
    const r = await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'search_replace', { waitMs: 0 })
    expect(r.verified).toBe(false)
    expect(r.reverted).toBe(true)
    expect(editResult.success).toBe(false)
    expect(editResult.errors[0]).toMatch(/server crashed/)
    expect(fs.readFileSync(TEST_FULL, 'utf8')).toBe(ORIGINAL)
  })
})

describe('verifyAndRevertSelfEdit — guards', () => {
  it('does not blow up when originalContent is missing (cannot revert)', async () => {
    mockFetchBroken()
    const editResult = { success: true, errors: [] }
    const r = await verifyAndRevertSelfEdit({ path: TEST_REL }, editResult, 'search_replace', { waitMs: 0 })
    expect(r.verified).toBe(false)
    // Revert did nothing (file stays modified), but editResult still mutated.
    expect(editResult.success).toBe(false)
    expect(editResult.errors.length).toBeGreaterThanOrEqual(1)
  })
})
