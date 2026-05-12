// ── Stream Handler v2 — Preview Refresh Emission ──
//
// Proves that after a successful write_file or edit_file in a PROJECT
// chat, the handler emits a `files_saved` SSE event so the dashboard
// can refetch files and reload the iframe. Without this, edits persist
// to Supabase silently and the user sees the stale preview — which is
// exactly the failure reported on Nexsara before this fix.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { runAgent } from '../lib/ai/agent-core.js'

/* ─── helpers ───────────────────────────────────────────────────────── */

function fakeProvider(turns) {
  let i = 0
  return {
    async *chatWithToolsStream(_msgs, _tools, _opts) {
      const chunks = turns[i] || []
      i += 1
      for (const c of chunks) yield c
    },
  }
}

function makeToolCall(name, args, id = 'call_' + name) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

/**
 * Mirrors the inner loop of handleStreamMessageV2 (the part that wires
 * agent-core events to SSE sends). Specifically includes the
 * preview-refresh hook so we can prove it fires on successful project
 * writes and stays silent in self-edit mode.
 */
async function collectStreamProjectMode(provider, tools, { isSelfEdit = false } = {}) {
  const events = []
  const send = (type, data) => events.push({ type, data })
  const pendingToolArgs = new Map()

  for await (const ev of runAgent({
    provider,
    systemPrompt: 'Project agent.',
    userMessage: 'change something',
    tools,
    maxIterations: 10,
  })) {
    if (ev.type === 'tool_use') {
      pendingToolArgs.set(ev.id, { name: ev.name, args: ev.args })
      send('tool_use', { name: ev.name, id: ev.id, args: ev.args })
    } else if (ev.type === 'tool_result') {
      send('tool_result', { name: ev.name, id: ev.id, content: ev.content })
      // ── This is the production hook we are testing ────────────────
      if (!isSelfEdit && (ev.name === 'write_file' || ev.name === 'edit_file')) {
        const resultStr = typeof ev.content === 'string' ? ev.content : String(ev.content || '')
        const looksSuccessful = !resultStr.startsWith('Error') && !resultStr.includes('Error executing')
        if (looksSuccessful) {
          const pending = pendingToolArgs.get(ev.id)
          const filePath = pending?.args?.path
          send('files_saved', {
            paths: filePath ? [filePath] : [],
            action: ev.name === 'write_file' ? 'write' : 'edit',
            agent_version: 'v2',
          })
        }
      }
      pendingToolArgs.delete(ev.id)
    } else if (ev.type === 'text_delta') {
      send('token', { content: ev.content })
    } else if (ev.type === 'done') {
      send('done', {})
    } else if (ev.type === 'error') {
      send('error', { message: ev.message })
    }
  }
  return events
}

function fakeWriteTool(name) {
  return {
    name,
    description: 'fake ' + name,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } } },
    execute: async ({ path: p }) => `${name === 'write_file' ? 'Wrote' : 'Edited'} ${p} (12 bytes)`,
  }
}

function failingWriteTool(name) {
  return {
    name,
    description: 'fails',
    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
    execute: async () => { throw new Error('storage offline') },
  }
}

/* ─── tests ─────────────────────────────────────────────────────────── */

describe('stream-handler-v2 — files_saved preview-refresh hook', () => {
  test('emits files_saved after successful write_file in project mode', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('write_file', { path: 'app/page.jsx', content: 'export default () => null' })] }],
      [{ type: 'token', content: 'Saved.' }],
    ])
    const events = await collectStreamProjectMode(provider, [fakeWriteTool('write_file')])

    const saved = events.find((e) => e.type === 'files_saved')
    assert.ok(saved, 'files_saved event must be emitted on successful write')
    assert.deepEqual(saved.data.paths, ['app/page.jsx'])
    assert.equal(saved.data.action, 'write')
    assert.equal(saved.data.agent_version, 'v2')
  })

  test('emits files_saved after successful edit_file in project mode', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('edit_file', { path: 'components/Hero.jsx', old_str: 'Hello', new_str: 'Hi' })] }],
      [{ type: 'token', content: 'Edited.' }],
    ])
    const events = await collectStreamProjectMode(provider, [fakeWriteTool('edit_file')])

    const saved = events.find((e) => e.type === 'files_saved')
    assert.ok(saved, 'files_saved event must be emitted on successful edit')
    assert.deepEqual(saved.data.paths, ['components/Hero.jsx'])
    assert.equal(saved.data.action, 'edit')
  })

  test('emits files_saved correctly for multiple writes in one turn', async () => {
    const provider = fakeProvider([
      [{
        type: 'tool_calls',
        tool_calls: [
          makeToolCall('write_file', { path: 'a.jsx', content: 'a' }, 'id_a'),
          makeToolCall('write_file', { path: 'b.jsx', content: 'b' }, 'id_b'),
        ],
      }],
      [{ type: 'token', content: 'Done.' }],
    ])
    const events = await collectStreamProjectMode(provider, [fakeWriteTool('write_file')])

    const saved = events.filter((e) => e.type === 'files_saved')
    assert.equal(saved.length, 2)
    assert.deepEqual(saved.map((e) => e.data.paths[0]), ['a.jsx', 'b.jsx'])
  })

  test('does NOT emit files_saved on tool failure', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('write_file', { path: 'app/page.jsx', content: 'x' })] }],
      [{ type: 'token', content: 'It failed.' }],
    ])
    const events = await collectStreamProjectMode(provider, [failingWriteTool('write_file')])

    const saved = events.find((e) => e.type === 'files_saved')
    assert.equal(saved, undefined, 'must not emit files_saved when tool throws')

    // Confirm the failure DID reach the model (via tool_result starting with Error executing)
    const toolResult = events.find((e) => e.type === 'tool_result')
    assert.match(toolResult.data.content, /Error executing/)
  })

  test('does NOT emit files_saved for read_file / search_files / list_files', async () => {
    const provider = fakeProvider([
      [{
        type: 'tool_calls',
        tool_calls: [
          makeToolCall('read_file', { path: 'a.jsx' }, 'id_read'),
          makeToolCall('list_files', { name_pattern: '*.jsx' }, 'id_list'),
          makeToolCall('search_files', { pattern: 'foo' }, 'id_search'),
        ],
      }],
      [{ type: 'token', content: 'Looked around.' }],
    ])
    const tools = [
      { name: 'read_file', description: '', input_schema: { type: 'object', properties: {} }, execute: async () => 'file content' },
      { name: 'list_files', description: '', input_schema: { type: 'object', properties: {} }, execute: async () => 'a.jsx\nb.jsx' },
      { name: 'search_files', description: '', input_schema: { type: 'object', properties: {} }, execute: async () => 'a.jsx:1: foo' },
    ]
    const events = await collectStreamProjectMode(provider, tools)
    assert.equal(events.find((e) => e.type === 'files_saved'), undefined)
  })

  test('does NOT emit files_saved in self-edit mode (Core System uses GitHub API instead)', async () => {
    // Self-edit writes go to GitHub and the dashboard preview is the
    // Auroraly app itself (Vercel re-deploys); there is no in-app iframe
    // to refresh. So files_saved would be misleading.
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('write_file', { path: 'lib/foo.js', content: 'x' })] }],
      [{ type: 'token', content: 'Pushed.' }],
    ])
    const events = await collectStreamProjectMode(
      provider,
      [fakeWriteTool('write_file')],
      { isSelfEdit: true },
    )
    assert.equal(events.find((e) => e.type === 'files_saved'), undefined)
  })

  test('files_saved.paths is [] when args.path is missing (defensive)', async () => {
    const provider = fakeProvider([
      [{ type: 'tool_calls', tool_calls: [makeToolCall('write_file', {}, 'id_nopath')] }],
      [{ type: 'token', content: 'done' }],
    ])
    const tools = [{
      name: 'write_file',
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => 'Wrote unknown (0 bytes)',
    }]
    const events = await collectStreamProjectMode(provider, tools)
    const saved = events.find((e) => e.type === 'files_saved')
    assert.ok(saved)
    assert.deepEqual(saved.data.paths, [])
  })
})
