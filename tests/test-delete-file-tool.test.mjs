// ── delete_file tool tests ──
// Covers the new delete_file tool across all three backends:
//   1. Local filesystem (Core System self-edit, dev mode)
//   2. Project-fs adapter (Nexsara / user projects via Supabase)
//   3. GitHub writer (Core System self-edit, production)
//
// Each backend gets idempotent-delete coverage (deleting a missing
// file returns success, never throws) plus normal happy-path + error
// cases. Regression guard for the "AI can't delete crashing
// middleware.js" gap reported live.

import { test, describe, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { deleteFileTool } from '../lib/ai/agent-tools-v2.js'
import { buildProjectFs } from '../lib/ai/project-fs.js'

/* ─── 1. Local filesystem backend ─────────────────────────────────── */

describe('delete_file (local fs backend)', () => {
  let TMP, tool
  before(() => {
    TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-tool-fs-'))
    tool = deleteFileTool({ rootDirs: [TMP] })
  })
  after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })

  test('deletes an existing file', async () => {
    const p = path.join(TMP, 'a.txt')
    fs.writeFileSync(p, 'hello')
    const result = await tool.execute({ path: p })
    assert.match(result, /Deleted/)
    assert.equal(fs.existsSync(p), false)
  })

  test('idempotent: deleting a missing file does not throw', async () => {
    const result = await tool.execute({ path: path.join(TMP, 'never-existed.txt') })
    assert.match(result, /not present|already deleted|never existed/i)
  })

  test('refuses to delete a directory', async () => {
    const d = path.join(TMP, 'subdir')
    fs.mkdirSync(d, { recursive: true })
    await assert.rejects(
      () => tool.execute({ path: d }),
      /directory/i,
    )
    assert.equal(fs.existsSync(d), true)
  })

  test('refuses paths outside scope', async () => {
    await assert.rejects(
      () => tool.execute({ path: '/etc/passwd' }),
      /out of scope/i,
    )
  })
})

/* ─── 2. Project-fs (Supabase) backend ────────────────────────────── */

describe('delete_file (project-fs / Supabase backend)', () => {
  // In-memory db fixture mimicking lib/supabase/db.js shape.
  function makeFakeDb(initialFiles) {
    const store = new Map(initialFiles.map(f => [`${f.project_id}:${f.path}`, f]))
    return {
      projectFiles: {
        async findByPath(projectId, p) {
          return store.get(`${projectId}:${p}`) || null
        },
        async deleteByPath(projectId, p) {
          const key = `${projectId}:${p}`
          if (!store.has(key)) return { deleted: false, reason: 'not-found' }
          store.delete(key)
          return { deleted: true, path: p }
        },
        async upsert() { throw new Error('not used in this test') },
      },
    }
  }

  test('deletes an existing project file', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'middleware.js', content: 'broken' }])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const msg = await fs.deleteFile('middleware.js')
    assert.match(msg, /Deleted/)
    assert.match(msg, /middleware\.js/)
    assert.match(msg, /Nexsara/)
    assert.equal(await db.projectFiles.findByPath('p1', 'middleware.js'), null)
  })

  test('idempotent: deleting a non-existent file returns success', async () => {
    const db = makeFakeDb([])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const msg = await fs.deleteFile('does-not-exist.js')
    assert.match(msg, /not present|already deleted|never existed/i)
  })

  test('strips leading slash from paths (matches write/edit behavior)', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'app/page.jsx', content: 'x' }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    const msg = await fs.deleteFile('/app/page.jsx')
    assert.match(msg, /Deleted/)
  })

  test('rejects empty path', async () => {
    const db = makeFakeDb([])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    await assert.rejects(() => fs.deleteFile(''), /non-empty/i)
  })
})

/* ─── 3. Writer-based (GitHub) backend via the tool ────────────────── */

describe('delete_file (writer-backed)', () => {
  function fakeWriter({ existing = true, throwOnDelete = false } = {}) {
    return {
      isConfigured: true,
      repo: 'jmcgee720/emanator',
      branch: 'main',
      async deleteFile(repoPath) {
        if (throwOnDelete) throw new Error('rate limited')
        if (!existing) return `${repoPath} was not present (already deleted or never existed).`
        return `Deleted ${repoPath} on jmcgee720/emanator@main (abc1234). Vercel will redeploy automatically.`
      },
    }
  }

  // Build a TMP scope so resolveInScope passes for absolute repo-style paths.
  function buildToolWith(writer) {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-tool-writer-'))
    return { tool: deleteFileTool({ rootDirs: [TMP] }, writer), cleanup: () => fs.rmSync(TMP, { recursive: true, force: true }) }
  }

  test('delegates to writer.deleteFile when a writer is configured', async () => {
    const { tool, cleanup } = buildToolWith(fakeWriter({ existing: true }))
    try {
      const result = await tool.execute({ path: 'middleware.js' })
      assert.match(result, /Deleted middleware\.js/)
      assert.match(result, /Vercel will redeploy/)
    } finally { cleanup() }
  })

  test('writer-backed idempotent delete returns success', async () => {
    const { tool, cleanup } = buildToolWith(fakeWriter({ existing: false }))
    try {
      const result = await tool.execute({ path: 'gone.js' })
      assert.match(result, /not present|already deleted|never existed/i)
    } finally { cleanup() }
  })

  test('propagates writer errors with context', async () => {
    const { tool, cleanup } = buildToolWith(fakeWriter({ throwOnDelete: true }))
    try {
      await assert.rejects(() => tool.execute({ path: 'a.js' }), /rate limited/)
    } finally { cleanup() }
  })

  test('errors clearly when a writer is configured but does not support delete', async () => {
    const incompleteWriter = { isConfigured: true, repo: 'r', branch: 'b' /* no deleteFile */ }
    const { tool, cleanup } = buildToolWith(incompleteWriter)
    try {
      await assert.rejects(() => tool.execute({ path: 'a.js' }), /does not support deletes/i)
    } finally { cleanup() }
  })
})

/* ─── 4. Tool schema sanity ────────────────────────────────────────── */

describe('delete_file tool schema', () => {
  test('declares path as required', () => {
    const tool = deleteFileTool({ rootDirs: ['/tmp'] })
    assert.equal(tool.name, 'delete_file')
    assert.deepEqual(tool.input_schema.required, ['path'])
  })

  test('description includes idempotency promise', () => {
    const tool = deleteFileTool({ rootDirs: ['/tmp'] })
    assert.match(tool.description, /Idempotent/i)
  })

  test('writer-aware description mentions auto-redeploy', () => {
    const tool = deleteFileTool({ rootDirs: ['/tmp'] }, {
      isConfigured: true,
      repo: 'jmcgee720/emanator',
      branch: 'main',
      async deleteFile() { return 'ok' },
    })
    assert.match(tool.description, /jmcgee720\/emanator@main/)
    assert.match(tool.description, /redeploy/i)
  })
})
