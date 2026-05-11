// ── Project Files Adapter Tests ──
//
// Proves that the v2 agent can read, edit, write, list, and search files
// in a user project (Supabase project_files) using the same interface as
// the GitHub adapter. This is the core of Step 4 — getting project chats
// off v1's broken engine and onto the clean v2 loop.

import { test, describe, beforeEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildProjectFs } from '../lib/ai/project-fs.js'

function makeFakeDb(initialFiles = []) {
  // In-memory replica of db.projectFiles. Mirrors the real shape from
  // lib/supabase/db.js so tests stay faithful to production.
  const files = new Map() // key: `${projectId}|${path}` → row
  for (const f of initialFiles) files.set(`${f.project_id}|${f.path}`, { ...f })
  return {
    projectFiles: {
      async findByPath(projectId, filePath) {
        return files.get(`${projectId}|${filePath}`) || null
      },
      async findByProjectId(projectId) {
        return [...files.values()].filter((f) => f.project_id === projectId)
      },
      async findIndexByProjectId(projectId) {
        return [...files.values()]
          .filter((f) => f.project_id === projectId)
          .map((f) => ({ path: f.path, file_type: f.file_type, size: (f.content || '').length }))
      },
      async upsert(projectId, filePath, content, file_type = 'text') {
        const key = `${projectId}|${filePath}`
        const existing = files.get(key)
        const next = {
          id: existing?.id || `id_${Math.random().toString(36).slice(2)}`,
          project_id: projectId,
          path: filePath,
          content,
          file_type,
          version: (existing?.version || 0) + 1,
        }
        files.set(key, next)
        return { action: existing ? 'updated' : 'created', file: next }
      },
    },
    _files: files, // exposed for test introspection
  }
}

/* ── Configuration ──────────────────────────────────────────────── */

describe('buildProjectFs — configuration', () => {
  test('returns null without db', () => {
    assert.equal(buildProjectFs({ projectId: 'p1' }), null)
  })
  test('returns null without projectId', () => {
    assert.equal(buildProjectFs({ db: makeFakeDb() }), null)
  })
  test('returns null if db has no projectFiles namespace', () => {
    assert.equal(buildProjectFs({ db: {}, projectId: 'p1' }), null)
  })
  test('exposes the same interface as the GitHub adapter', () => {
    const fs = buildProjectFs({ db: makeFakeDb(), projectId: 'p1', projectName: 'Nexsara' })
    assert.equal(fs.isConfigured, true)
    assert.equal(fs.repo, 'Nexsara')
    assert.equal(fs.branch, 'project')
    assert.equal(typeof fs.readFile, 'function')
    assert.equal(typeof fs.writeFile, 'function')
    assert.equal(typeof fs.editFile, 'function')
    assert.equal(typeof fs.listFiles, 'function')
    assert.equal(typeof fs.searchFiles, 'function')
  })
})

/* ── readFile ───────────────────────────────────────────────────── */

describe('readFile', () => {
  test('returns content + lineCount + source for an existing file', async () => {
    const db = makeFakeDb([
      { project_id: 'p1', path: 'src/App.jsx', content: 'export const App = () => null\nexport default App', file_type: 'jsx' },
    ])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const out = await fs.readFile('src/App.jsx')
    assert.equal(out.content, 'export const App = () => null\nexport default App')
    assert.equal(out.lineCount, 2)
    assert.equal(out.source, 'Nexsara/src/App.jsx')
  })

  test('rejects when file is not in the project', async () => {
    const db = makeFakeDb()
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'P' })
    await assert.rejects(() => fs.readFile('does-not-exist.js'), /not found in P/)
  })

  test('truncates content over maxBytes', async () => {
    const big = 'x'.repeat(500_000)
    const db = makeFakeDb([{ project_id: 'p1', path: 'big.txt', content: big }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    const out = await fs.readFile('big.txt', 1024)
    assert.ok(out.content.length < 2000)
    assert.match(out.content, /truncated at 1024 bytes/)
  })

  test('normalizes leading slashes', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'src/foo.js', content: 'x' }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    const out = await fs.readFile('/src/foo.js')
    assert.equal(out.content, 'x')
  })
})

/* ── writeFile ──────────────────────────────────────────────────── */

describe('writeFile', () => {
  test('creates a new file and reports "Created"', async () => {
    const db = makeFakeDb()
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const out = await fs.writeFile('src/new.jsx', 'export const N = 1')
    assert.match(out, /Created src\/new\.jsx in Nexsara/)
    assert.equal(db._files.get('p1|src/new.jsx').content, 'export const N = 1')
  })

  test('overwrites an existing file and reports "Updated"', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'src/A.jsx', content: 'old' }])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const out = await fs.writeFile('src/A.jsx', 'completely new')
    assert.match(out, /Updated src\/A\.jsx in Nexsara/)
    assert.equal(db._files.get('p1|src/A.jsx').content, 'completely new')
  })

  test('rejects non-string content', async () => {
    const fs = buildProjectFs({ db: makeFakeDb(), projectId: 'p1' })
    await assert.rejects(() => fs.writeFile('x.js', { not: 'string' }), /content must be a string/)
  })
})

/* ── editFile ───────────────────────────────────────────────────── */

describe('editFile', () => {
  test('replaces unique old_str with new_str', async () => {
    const db = makeFakeDb([
      { project_id: 'p1', path: 'src/App.jsx', content: 'const title = "Nexsara"\nconst tagline = "AI"' },
    ])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const out = await fs.editFile('src/App.jsx', 'const title = "Nexsara"', 'const title = "Nexsara Pro"')
    assert.match(out, /Edited src\/App\.jsx in Nexsara/)
    assert.equal(db._files.get('p1|src/App.jsx').content, 'const title = "Nexsara Pro"\nconst tagline = "AI"')
  })

  test('rejects when old_str is not found', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'x.js', content: 'totally different' }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    await assert.rejects(() => fs.editFile('x.js', 'NOPE', 'y'), /old_str not found/)
  })

  test('rejects when old_str matches multiple times', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'x.js', content: 'dup\ndup\nend' }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    await assert.rejects(() => fs.editFile('x.js', 'dup', 'y'), /multiple locations/)
  })

  test('rejects when file does not exist', async () => {
    const fs = buildProjectFs({ db: makeFakeDb(), projectId: 'p1', projectName: 'P' })
    await assert.rejects(() => fs.editFile('missing.js', 'a', 'b'), /not found in P/)
  })

  test('rejects empty old_str', async () => {
    const fs = buildProjectFs({ db: makeFakeDb(), projectId: 'p1' })
    await assert.rejects(() => fs.editFile('x.js', '', 'y'), /non-empty string/)
  })
})

/* ── listFiles ──────────────────────────────────────────────────── */

describe('listFiles', () => {
  let db, fs
  beforeEach(() => {
    db = makeFakeDb([
      { project_id: 'p1', path: 'src/App.jsx', content: 'x' },
      { project_id: 'p1', path: 'src/Performance.jsx', content: 'x' },
      { project_id: 'p1', path: 'src/components/Card.jsx', content: 'x' },
      { project_id: 'p1', path: 'src/utils.js', content: 'x' },
      { project_id: 'p1', path: 'README.md', content: 'x' },
      // Different project — must be filtered out
      { project_id: 'other', path: 'src/App.jsx', content: 'x' },
    ])
    fs = buildProjectFs({ db, projectId: 'p1', projectName: 'P' })
  })

  test('lists files matching a glob pattern', async () => {
    const out = await fs.listFiles('*.jsx')
    assert.ok(out.includes('src/App.jsx'))
    assert.ok(out.includes('src/Performance.jsx'))
    assert.ok(out.includes('src/components/Card.jsx'))
    assert.equal(out.includes('src/utils.js'), false)
    assert.equal(out.includes('README.md'), false)
  })

  test('respects basePath filter', async () => {
    const out = await fs.listFiles('*.jsx', 'src/components')
    assert.deepEqual(out, ['src/components/Card.jsx'])
  })

  test('only returns files for THIS project (scope enforcement)', async () => {
    const out = await fs.listFiles('App.jsx')
    assert.equal(out.length, 1, 'must not include the "other" project file')
    assert.equal(out[0], 'src/App.jsx')
  })
})

/* ── searchFiles ────────────────────────────────────────────────── */

describe('searchFiles', () => {
  test('finds pattern across project files with file:line: prefix', async () => {
    const db = makeFakeDb([
      { project_id: 'p1', path: 'src/App.jsx', content: 'const title = "Nexsara"\nimport React from "react"' },
      { project_id: 'p1', path: 'src/Perf.jsx', content: 'fetch("/api/performance")' },
    ])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    const out = await fs.searchFiles('fetch')
    assert.match(out, /src\/Perf\.jsx:1:/)
    assert.match(out, /\/api\/performance/)
  })

  test('returns no-match string when nothing matches', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'x.js', content: 'nope' }])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'P' })
    const out = await fs.searchFiles('zzz-does-not-exist')
    assert.match(out, /no matches for "zzz-does-not-exist" in P/)
  })

  test('matches case-insensitively', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'x.js', content: 'HELLO world' }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    const out = await fs.searchFiles('hello')
    assert.match(out, /HELLO/)
  })

  test('caps results at 50 matches to avoid overwhelming the model', async () => {
    const lines = Array.from({ length: 200 }, () => 'match here').join('\n')
    const db = makeFakeDb([{ project_id: 'p1', path: 'big.js', content: lines }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    const out = await fs.searchFiles('match')
    const count = out.split('\n').length
    assert.ok(count <= 50, 'must cap results, got ' + count)
  })

  test('treats invalid regex as literal pattern (no crash)', async () => {
    const db = makeFakeDb([{ project_id: 'p1', path: 'x.js', content: 'function foo(' }])
    const fs = buildProjectFs({ db, projectId: 'p1' })
    // '(' alone is an invalid regex
    const out = await fs.searchFiles('foo(')
    assert.match(out, /x\.js/)
  })
})

/* ── End-to-end via the tool wiring ──────────────────────────────── */

describe('buildDefaultToolset(scope, writer, reader) with project-fs', () => {
  test('the same fs object works as BOTH writer AND reader', async () => {
    const { buildDefaultToolset } = await import('../lib/ai/agent-tools-v2.js')
    const db = makeFakeDb([{ project_id: 'p1', path: 'src/App.jsx', content: 'const x = 1' }])
    const fs = buildProjectFs({ db, projectId: 'p1', projectName: 'Nexsara' })
    const scope = { rootDirs: ['/proj'], excludePaths: [] }
    const tools = buildDefaultToolset(scope, fs, fs)
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    // read
    const readOut = await byName.read_file.execute({ path: 'src/App.jsx' })
    assert.match(readOut, /Nexsara\/src\/App\.jsx/)
    assert.match(readOut, /const x = 1/)

    // edit
    const editOut = await byName.edit_file.execute({ path: 'src/App.jsx', old_str: 'const x = 1', new_str: 'const x = 999' })
    assert.match(editOut, /Edited src\/App\.jsx/)
    assert.equal(db._files.get('p1|src/App.jsx').content, 'const x = 999')

    // write (new file)
    const writeOut = await byName.write_file.execute({ path: 'src/New.jsx', content: 'new file' })
    assert.match(writeOut, /Created src\/New\.jsx/)
    assert.equal(db._files.get('p1|src/New.jsx').content, 'new file')

    // list
    const listOut = await byName.list_files.execute({ name_pattern: '*.jsx' })
    assert.match(listOut, /src\/App\.jsx/)
    assert.match(listOut, /src\/New\.jsx/)

    // search
    const searchOut = await byName.search_files.execute({ pattern: 'const x = 999' })
    assert.match(searchOut, /src\/App\.jsx:1:/)
  })
})
