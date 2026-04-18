/**
 * Brief reviewer tests.
 * Uses mocked provider to verify review logic + repair wave mechanics.
 */

import { reviewBuild, repairBuild } from '../../lib/ai/brief-reviewer.js'

const plan = {
  archetypeId: 'saas_tool',
  brand: { name: 'X' },
  routes: [
    { id: 'landing', file: 'pages/Landing.jsx' },
    { id: 'signup', file: 'pages/Signup.jsx' },
    { id: 'dashboard', file: 'pages/Dashboard.jsx' },
  ],
  flows: [
    { id: 'signup_to_dashboard', desc: 'Signup → dashboard' },
    { id: 'logout', desc: 'Logout clears auth' },
  ],
  components: [],
  dataShapes: [],
  waves: [],
}

function makeProvider({ chatResponse, streamToolCalls, streamToolArgs } = {}) {
  return {
    chat: jest.fn().mockResolvedValue(chatResponse || '{"ok":true}'),
    chatWithToolsStream: async function* () {
      if (streamToolArgs) yield { type: 'tool_args_delta', delta: streamToolArgs }
      yield { type: 'tool_calls', tool_calls: streamToolCalls || [] }
    },
  }
}

describe('reviewBuild', () => {
  test('ok=true when LLM returns ok', async () => {
    const provider = makeProvider({ chatResponse: '{"ok":true,"missing":[],"broken":[]}' })
    const result = await reviewBuild({
      plan,
      filesBuilt: [{ path: 'app/page.jsx', content: 'x'.repeat(500) }],
      provider,
    })
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  test('ok=false when LLM returns missing flows', async () => {
    const provider = makeProvider({ chatResponse: '{"ok":false,"missing":["flow:signup_to_dashboard"],"broken":[]}' })
    const result = await reviewBuild({
      plan,
      filesBuilt: [{ path: 'app/page.jsx', content: 'x'.repeat(500) }],
      provider,
    })
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('flow:signup_to_dashboard')
  })

  test('handles malformed JSON gracefully', async () => {
    const provider = makeProvider({ chatResponse: 'not json at all' })
    const result = await reviewBuild({
      plan,
      filesBuilt: [{ path: 'app/page.jsx', content: 'x'.repeat(500) }],
      provider,
    })
    // Malformed → default shape, ok=true (missing=[] broken=[])
    expect(result.ok).toBe(true)
  })

  test('returns not-ok when no files built', async () => {
    const provider = makeProvider({ chatResponse: '{}' })
    const result = await reviewBuild({
      plan,
      filesBuilt: [],
      provider,
    })
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('no files produced')
  })

  test('provider failure returns ok=true with note (non-blocking)', async () => {
    const provider = { chat: jest.fn().mockRejectedValue(new Error('timeout')) }
    const result = await reviewBuild({
      plan,
      filesBuilt: [{ path: 'app/page.jsx', content: 'x'.repeat(500) }],
      provider,
    })
    expect(result.ok).toBe(true)
    expect(result.notes.some((n) => n.includes('review skipped'))).toBe(true)
  })
})

describe('repairBuild', () => {
  async function collect(gen) {
    const events = []
    let result
    while (true) {
      const next = await gen.next()
      if (next.done) { result = next.value; break }
      events.push(next.value)
    }
    return { events, result }
  }

  test('emits repair_start, produces update files, saves', async () => {
    const provider = makeProvider({
      streamToolCalls: [{
        function: {
          name: 'create_files',
          arguments: JSON.stringify({ files: [{ path: 'pages/Signup.jsx', content: 'export default function Signup() { return null }' + ' '.repeat(100) }] }),
        },
      }],
    })
    const gen = repairBuild({
      plan,
      review: { ok: false, missing: ['pages/Signup.jsx'], broken: [], notes: [] },
      filesBuilt: [{ path: 'app/page.jsx', content: 'x'.repeat(200) }],
      provider,
      saveFiles: async (files) => files.map((f) => ({ ...f, id: 'id_' + f.path, action: 'created' })),
    })
    const { events, result } = await collect(gen)
    expect(events[0].event).toBe('repair_start')
    expect(events.some((e) => e.event === 'files_saved')).toBe(true)
    expect(result.filesRepaired).toContain('pages/Signup.jsx')
  })

  test('returns error when LLM produces nothing', async () => {
    const provider = makeProvider({ streamToolCalls: [] })
    const gen = repairBuild({
      plan,
      review: { ok: false, missing: ['pages/Signup.jsx'], broken: [], notes: [] },
      filesBuilt: [],
      provider,
      saveFiles: async (files) => files,
    })
    const { result } = await collect(gen)
    expect(result.error).toBe('no repair files produced')
  })

  test('recovers from tool_args_delta when tool_calls empty', async () => {
    const provider = makeProvider({
      streamToolArgs: JSON.stringify({ files: [{ path: 'pages/Signup.jsx', content: 'x'.repeat(200) }] }),
      streamToolCalls: [],
    })
    const gen = repairBuild({
      plan,
      review: { ok: false, missing: ['pages/Signup.jsx'], broken: [], notes: [] },
      filesBuilt: [],
      provider,
      saveFiles: async (files) => files.map((f) => ({ ...f, id: 'x', action: 'updated' })),
    })
    const { result } = await collect(gen)
    expect(result.filesRepaired).toContain('pages/Signup.jsx')
  })
})
