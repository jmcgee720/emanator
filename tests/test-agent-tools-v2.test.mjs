// ── Agent Tools v2 Tests ──
// Real filesystem, scope-enforced. No mocking — these tools run against
// an isolated temp directory so we can verify they truly read, write,
// edit, exec, search, and list.

import { test, describe, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  searchFilesTool,
  listFilesTool,
  buildDefaultToolset,
  resolveInScope,
  normalizeScope,
} from '../lib/ai/agent-tools-v2.js'

let TMP
let scope

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-v2-'))
  // Seed some files
  fs.mkdirSync(path.join(TMP, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(TMP, 'lib', 'ai'), { recursive: true })
  fs.mkdirSync(path.join(TMP, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'lib', 'ai', 'streaming.js'), "export const x = 'streaming-engine'\n// line 2\n// line 3")
  fs.writeFileSync(path.join(TMP, 'lib', 'foo.js'), "export const foo = 1")
  fs.writeFileSync(path.join(TMP, 'node_modules', 'should-not-see.js'), 'secret')
  scope = {
    rootDirs: [TMP],
    excludePaths: [path.join(TMP, 'node_modules')],
  }
})

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

/* ── scope helpers ───────────────────────────────────────────────────── */

describe('agent-tools-v2 — scope enforcement', () => {
  test('resolveInScope: in-scope absolute path → resolves', () => {
    const ns = normalizeScope(scope)
    const abs = resolveInScope(ns, path.join(TMP, 'lib', 'foo.js'))
    assert.equal(abs, path.join(TMP, 'lib', 'foo.js'))
  })

  test('resolveInScope: relative path anchored to first root', () => {
    const ns = normalizeScope(scope)
    const abs = resolveInScope(ns, 'lib/foo.js')
    assert.equal(abs, path.join(TMP, 'lib', 'foo.js'))
  })

  test('resolveInScope: out-of-scope path → throws', () => {
    const ns = normalizeScope(scope)
    assert.throws(() => resolveInScope(ns, '/etc/passwd'), /out of scope/)
  })

  test('resolveInScope: traversal that escapes root → throws', () => {
    const ns = normalizeScope(scope)
    assert.throws(() => resolveInScope(ns, '../../../etc/hosts'), /out of scope/)
  })

  test('resolveInScope: excluded directory → throws', () => {
    const ns = normalizeScope(scope)
    assert.throws(
      () => resolveInScope(ns, 'node_modules/should-not-see.js'),
      /excluded directory/
    )
  })

  test('resolveInScope: null/empty → throws', () => {
    const ns = normalizeScope(scope)
    assert.throws(() => resolveInScope(ns, ''), /non-empty string/)
    assert.throws(() => resolveInScope(ns, null), /non-empty string/)
  })

  test('resolveInScope: null byte → throws', () => {
    const ns = normalizeScope(scope)
    assert.throws(() => resolveInScope(ns, 'lib/foo\0.js'), /null byte/)
  })
})

/* ── read_file ───────────────────────────────────────────────────────── */

describe('agent-tools-v2 — read_file', () => {
  test('reads a file with line numbers', async () => {
    const t = readFileTool(scope)
    const out = await t.execute({ path: 'lib/ai/streaming.js' })
    assert.match(out, /streaming\.js/)
    assert.match(out, /1\| export const x/)
    assert.match(out, /3 lines/)
  })

  test('rejects out-of-scope path', async () => {
    const t = readFileTool(scope)
    await assert.rejects(t.execute({ path: '/etc/passwd' }), /out of scope/)
  })

  test('rejects excluded directory', async () => {
    const t = readFileTool(scope)
    await assert.rejects(
      t.execute({ path: 'node_modules/should-not-see.js' }),
      /excluded directory/
    )
  })

  test('rejects directory (not a file)', async () => {
    const t = readFileTool(scope)
    await assert.rejects(t.execute({ path: 'lib' }), /not a file/)
  })

  test('truncates oversized files', async () => {
    const big = 'x'.repeat(500 * 1024)
    fs.writeFileSync(path.join(TMP, 'big.txt'), big)
    const t = readFileTool({ ...scope, maxFileBytes: 1024 })
    const out = await t.execute({ path: 'big.txt' })
    assert.match(out, /truncated at 1024 bytes/)
  })
})

/* ── write_file ──────────────────────────────────────────────────────── */

describe('agent-tools-v2 — write_file', () => {
  test('writes a new file in scope', async () => {
    const t = writeFileTool(scope)
    const out = await t.execute({ path: 'lib/new.js', content: 'export const n = 1' })
    assert.match(out, /Wrote/)
    const onDisk = fs.readFileSync(path.join(TMP, 'lib', 'new.js'), 'utf-8')
    assert.equal(onDisk, 'export const n = 1')
  })

  test('overwrites an existing file completely', async () => {
    const t = writeFileTool(scope)
    await t.execute({ path: 'lib/foo.js', content: 'COMPLETELY NEW' })
    const onDisk = fs.readFileSync(path.join(TMP, 'lib', 'foo.js'), 'utf-8')
    assert.equal(onDisk, 'COMPLETELY NEW')
  })

  test('creates intermediate directories', async () => {
    const t = writeFileTool(scope)
    await t.execute({ path: 'deep/nested/path/file.js', content: 'x' })
    assert.equal(fs.existsSync(path.join(TMP, 'deep/nested/path/file.js')), true)
  })

  test('rejects out-of-scope writes', async () => {
    const t = writeFileTool(scope)
    await assert.rejects(t.execute({ path: '/tmp/escape.js', content: 'x' }), /out of scope/)
  })

  test('rejects non-string content', async () => {
    const t = writeFileTool(scope)
    await assert.rejects(t.execute({ path: 'x.js', content: { not: 'string' } }), /content must be/)
  })
})

/* ── edit_file ───────────────────────────────────────────────────────── */

describe('agent-tools-v2 — edit_file', () => {
  test('replaces unique old_str with new_str', async () => {
    fs.writeFileSync(path.join(TMP, 'lib', 'edit-me.js'), 'const greeting = "hello"\nconst other = 1')
    const t = editFileTool(scope)
    const out = await t.execute({
      path: 'lib/edit-me.js',
      old_str: 'const greeting = "hello"',
      new_str: 'const greeting = "hi"',
    })
    assert.match(out, /replaced 1 occurrence/)
    const onDisk = fs.readFileSync(path.join(TMP, 'lib', 'edit-me.js'), 'utf-8')
    assert.equal(onDisk, 'const greeting = "hi"\nconst other = 1')
  })

  test('rejects when old_str is not found', async () => {
    fs.writeFileSync(path.join(TMP, 'lib', 'edit2.js'), 'a = 1')
    const t = editFileTool(scope)
    await assert.rejects(
      t.execute({ path: 'lib/edit2.js', old_str: 'NONEXISTENT', new_str: 'x' }),
      /old_str not found/
    )
  })

  test('rejects when old_str matches multiple times', async () => {
    fs.writeFileSync(path.join(TMP, 'lib', 'dup.js'), 'dup\ndup\nend')
    const t = editFileTool(scope)
    await assert.rejects(
      t.execute({ path: 'lib/dup.js', old_str: 'dup', new_str: 'x' }),
      /multiple locations/
    )
  })

  test('rejects when file does not exist', async () => {
    const t = editFileTool(scope)
    await assert.rejects(
      t.execute({ path: 'lib/no-such.js', old_str: 'x', new_str: 'y' }),
      /does not exist/
    )
  })

  test('rejects empty old_str', async () => {
    fs.writeFileSync(path.join(TMP, 'lib', 'e3.js'), 'content')
    const t = editFileTool(scope)
    await assert.rejects(
      t.execute({ path: 'lib/e3.js', old_str: '', new_str: 'y' }),
      /non-empty string/
    )
  })
})

/* ── run_command ─────────────────────────────────────────────────────── */

describe('agent-tools-v2 — run_command', () => {
  test('executes echo and returns stdout', async () => {
    const t = runCommandTool(scope)
    const out = await t.execute({ command: 'echo hello-from-bash' })
    assert.match(out, /hello-from-bash/)
  })

  test('surfaces non-zero exit code with stderr', async () => {
    const t = runCommandTool(scope)
    const out = await t.execute({ command: 'ls /no/such/path/at/all 2>&1' })
    // Non-zero exit OR stderr — must surface the failure detail
    assert.ok(
      /command failed/.test(out) || /No such file/.test(out) || /cannot access/.test(out),
      `expected failure indicator, got: ${out}`
    )
  })

  test('truncates massive output at 10KB', async () => {
    const t = runCommandTool(scope)
    const out = await t.execute({ command: "head -c 50000 /dev/urandom | base64 | head -c 50000" })
    assert.ok(out.length <= 10_500, `output should be capped at ~10KB, got ${out.length}`)
  })

  test('rejects empty command', async () => {
    const t = runCommandTool(scope)
    await assert.rejects(t.execute({ command: '' }), /non-empty string/)
  })

  test('runs in the first scope root as cwd', async () => {
    const t = runCommandTool(scope)
    const out = await t.execute({ command: 'pwd' })
    // /tmp paths on macOS may resolve through /private — accept either
    assert.ok(out.includes(TMP) || out.includes(path.basename(TMP)))
  })
})

/* ── search_files ────────────────────────────────────────────────────── */

describe('agent-tools-v2 — search_files', () => {
  test('finds matches with line numbers', async () => {
    const t = searchFilesTool(scope)
    const out = await t.execute({ pattern: 'streaming-engine' })
    assert.match(out, /streaming\.js/)
    assert.match(out, /streaming-engine/)
  })

  test('returns no-match string when pattern is absent', async () => {
    const t = searchFilesTool(scope)
    const out = await t.execute({ pattern: 'this-string-definitely-does-not-exist-xyz-9999' })
    assert.match(out, /no matches/)
  })

  test('rejects empty pattern', async () => {
    const t = searchFilesTool(scope)
    await assert.rejects(t.execute({ pattern: '' }), /pattern is required/)
  })
})

/* ── list_files ──────────────────────────────────────────────────────── */

describe('agent-tools-v2 — list_files', () => {
  test('lists files matching a name pattern', async () => {
    const t = listFilesTool(scope)
    const out = await t.execute({ name_pattern: 'streaming.js' })
    assert.match(out, /streaming\.js/)
  })

  test('respects excludePaths (skips node_modules)', async () => {
    // The seeded file at node_modules/should-not-see.js exists on disk but
    // must be excluded by the find command. The no-match message includes
    // the search pattern verbatim, so we assert the leading "(no files
    // match" sentinel rather than the absence of the filename string.
    const t = listFilesTool(scope)
    const out = await t.execute({ name_pattern: 'should-not-see.js' })
    assert.match(out, /^\(no files match/, 'must NOT return the file inside excluded node_modules')
  })

  test('returns no-match message when nothing found', async () => {
    const t = listFilesTool(scope)
    const out = await t.execute({ name_pattern: 'zzz-does-not-exist-9999.js' })
    assert.match(out, /no files match/)
  })

  test('rejects empty pattern', async () => {
    const t = listFilesTool(scope)
    await assert.rejects(t.execute({ name_pattern: '' }), /name_pattern is required/)
  })
})

/* ── default toolset ─────────────────────────────────────────────────── */

describe('agent-tools-v2 — buildDefaultToolset', () => {
  test('returns the 7 expected tools', () => {
    const tools = buildDefaultToolset(scope)
    const names = tools.map((t) => t.name).sort()
    assert.deepEqual(names, [
      'delete_file',
      'edit_file',
      'list_files',
      'read_file',
      'run_command',
      'search_files',
      'write_file',
    ])
  })

  test('each tool has name, description, input_schema, execute', () => {
    const tools = buildDefaultToolset(scope)
    for (const t of tools) {
      assert.ok(t.name, `${t.name}: missing name`)
      assert.ok(t.description, `${t.name}: missing description`)
      assert.ok(t.input_schema, `${t.name}: missing input_schema`)
      assert.equal(typeof t.execute, 'function', `${t.name}: execute must be function`)
    }
  })
})
