// ── Agent Tools v2 — Writer Routing Tests ──
//
// Proves that when a writer is passed to buildDefaultToolset:
//   • write_file calls writer.writeFile, NOT the local filesystem
//   • edit_file calls writer.editFile, NOT the local filesystem
//   • Tool descriptions reflect the writer's commit target
//   • Read tools still go to local fs
//   • Path normalization: absolute scope-relative paths get stripped
//     of the scope root before being handed to the writer (so the agent
//     uses "lib/foo.js" not "/var/task/lib/foo.js" in GitHub URLs).

import { test, describe, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildDefaultToolset, writeFileTool, editFileTool } from '../lib/ai/agent-tools-v2.js'

let TMP, scope

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-writer-'))
  fs.writeFileSync(path.join(TMP, 'foo.js'), 'const x = 1')
  scope = { rootDirs: [TMP], excludePaths: [] }
})
after(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

function spyWriter() {
  const calls = []
  return {
    calls,
    isConfigured: true,
    repo: 'jmcgee720/emanator',
    branch: 'main',
    async writeFile(path, content, message) {
      calls.push({ op: 'write', path, content, message })
      return `Committed ${path}`
    },
    async editFile(path, old_str, new_str, message) {
      calls.push({ op: 'edit', path, old_str, new_str, message })
      return `Edited ${path}`
    },
  }
}

describe('write_file: with writer → routes to writer (NOT fs)', () => {
  test('writeFileTool with writer calls writer.writeFile and does not touch fs', async () => {
    const writer = spyWriter()
    const tool = writeFileTool(scope, writer)
    const out = await tool.execute({ path: 'new.js', content: 'export const n = 1', message: 'add new.js' })
    assert.match(out, /Committed new\.js/)
    assert.equal(writer.calls.length, 1)
    assert.deepEqual(writer.calls[0], { op: 'write', path: 'new.js', content: 'export const n = 1', message: 'add new.js' })
    // The fs at TMP/new.js must NOT exist — proves we didn't fall through to disk
    assert.equal(fs.existsSync(path.join(TMP, 'new.js')), false)
  })

  test('writeFileTool without writer uses fs (backward compat)', async () => {
    const tool = writeFileTool(scope) // no writer
    await tool.execute({ path: 'localonly.js', content: 'export const y = 2' })
    assert.equal(fs.existsSync(path.join(TMP, 'localonly.js')), true)
    assert.equal(fs.readFileSync(path.join(TMP, 'localonly.js'), 'utf-8'), 'export const y = 2')
  })

  test('writer mode: tool description mentions the commit target', () => {
    const writer = spyWriter()
    const tool = writeFileTool(scope, writer)
    assert.match(tool.description, /jmcgee720\/emanator@main/)
    assert.match(tool.description, /GitHub/)
  })

  test('writer mode: scope is still enforced (out-of-scope path rejected)', async () => {
    const writer = spyWriter()
    const tool = writeFileTool(scope, writer)
    await assert.rejects(
      tool.execute({ path: '/etc/passwd', content: 'x' }),
      /out of scope/
    )
    assert.equal(writer.calls.length, 0, 'writer must not be called for out-of-scope paths')
  })

  test('absolute scope-relative path is stripped to repo-relative before writer call', async () => {
    const writer = spyWriter()
    const tool = writeFileTool(scope, writer)
    // Caller passes an absolute path within scope; writer should see the
    // repo-relative form (no leading TMP prefix).
    await tool.execute({ path: path.join(TMP, 'sub/deep.js'), content: 'x' })
    assert.equal(writer.calls[0].path, 'sub/deep.js')
  })
})

describe('edit_file: with writer → routes to writer (NOT fs)', () => {
  test('editFileTool with writer calls writer.editFile, fs unchanged', async () => {
    const writer = spyWriter()
    const tool = editFileTool(scope, writer)
    const before = fs.readFileSync(path.join(TMP, 'foo.js'), 'utf-8')
    const out = await tool.execute({ path: 'foo.js', old_str: 'const x = 1', new_str: 'const x = 999', message: 'bump x' })
    assert.match(out, /Edited foo\.js/)
    assert.equal(writer.calls.length, 1)
    assert.deepEqual(writer.calls[0], { op: 'edit', path: 'foo.js', old_str: 'const x = 1', new_str: 'const x = 999', message: 'bump x' })
    // Local fs must NOT have been touched
    assert.equal(fs.readFileSync(path.join(TMP, 'foo.js'), 'utf-8'), before)
  })

  test('rejects empty old_str before contacting writer', async () => {
    const writer = spyWriter()
    const tool = editFileTool(scope, writer)
    await assert.rejects(tool.execute({ path: 'foo.js', old_str: '', new_str: 'y' }), /non-empty string/)
    assert.equal(writer.calls.length, 0)
  })
})

describe('buildDefaultToolset(scope, writer) — full set wiring', () => {
  test('write_file / edit_file route to writer; reads stay local', async () => {
    const writer = spyWriter()
    const tools = buildDefaultToolset(scope, writer)
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    await byName.write_file.execute({ path: 'x.js', content: '1' })
    await byName.edit_file.execute({ path: 'foo.js', old_str: 'const x = 1', new_str: 'const x = 2' })
    assert.equal(writer.calls.length, 2)

    // read_file should still pull from the local fs (TMP/foo.js)
    const readOut = await byName.read_file.execute({ path: 'foo.js' })
    assert.match(readOut, /foo\.js/)
    assert.match(readOut, /const x = 1/, 'local fs unchanged because writes went to writer')
  })

  test('writer-configured=false → tools error with setup instructions on write', async () => {
    const stubMissing = {
      isConfigured: false,
      async writeFile() { throw new Error('GitHub writer is not configured. Set GITHUB_TOKEN, GITHUB_REPO.') },
      async editFile() { throw new Error('GitHub writer is not configured.') },
    }
    const tools = buildDefaultToolset(scope, stubMissing)
    const wf = tools.find((t) => t.name === 'write_file')
    assert.match(wf.description, /not configured/)
    await assert.rejects(wf.execute({ path: 'x.js', content: 'y' }), /not configured/)
  })
})
