/**
 * Brief builder wave orchestration tests.
 * Uses a mocked OpenAI-compatible provider to verify:
 *  - buildWave streams expected events
 *  - files outside the wave's declared file list are dropped
 *  - retry-on-empty-toolcall works
 *  - runAllWaves aborts when scaffold wave fails
 *  - runAllWaves runs every wave in plan order
 */

import { buildWave, runAllWaves } from '../../lib/ai/brief-builder.js'

// ── Helpers ─────────────────────────────────────────────────────────
function makeStreamingProvider(toolCallsByCall) {
  let callIdx = 0
  const messageLog = []
  const p = {
    chatWithToolsStream: async function* (messages) {
      messageLog.push(messages)
      const tool_calls = toolCallsByCall[callIdx++] || []
      yield { type: 'tool_calls', tool_calls }
    },
    chatWithTools: async () => ({ content: '', tool_calls: toolCallsByCall[callIdx++] || [] }),
    messageLog,
  }
  return p
}

function makeToolCall(files) {
  return [
    {
      function: {
        name: 'create_files',
        arguments: JSON.stringify({ files }),
      },
    },
  ]
}

async function collectEvents(gen) {
  const events = []
  let result
  while (true) {
    const next = await gen.next()
    if (next.done) { result = next.value; break }
    events.push(next.value)
  }
  return { events, result }
}

const testPlan = {
  archetypeId: 'saas_tool',
  brand: { name: 'TestApp', description: 'test', audience: 'devs', tone: 'Confident', colors: 'Dark violet' },
  routes: [
    { id: 'landing', file: 'pages/Landing.jsx', description: '' },
    { id: 'signup', file: 'pages/Signup.jsx', description: '' },
  ],
  components: [],
  flows: [{ id: 'signup_to_dashboard', desc: 'Signup → dashboard' }],
  dataShapes: [{ name: 'User', fields: ['id', 'email'] }],
  waves: [
    { id: 'scaffold', label: 'Scaffolding', files: ['app/page.jsx', 'components/Navbar.jsx'] },
    { id: 'public', label: 'Public pages', files: ['pages/Landing.jsx'] },
    { id: 'auth', label: 'Auth pages', files: ['pages/Signup.jsx'] },
  ],
}

// ── Tests ───────────────────────────────────────────────────────────
describe('buildWave', () => {
  test('emits wave_start → files_saved → wave_complete', async () => {
    const provider = makeStreamingProvider([
      makeToolCall([
        { path: 'app/page.jsx', content: 'export default function App() { return null }' + ' '.repeat(100) },
        { path: 'components/Navbar.jsx', content: 'export default function Navbar() { return null }' + ' '.repeat(100) },
      ]),
    ])
    const saved = []
    const gen = buildWave({
      plan: testPlan,
      wave: testPlan.waves[0],
      filesBuiltSoFar: [],
      provider,
      waveIndex: 0,
      wavesTotal: 3,
      onFilesProduced: async (files) => {
        files.forEach((f) => saved.push(f))
        return files.map((f) => ({ ...f, id: 'id_' + f.path, action: 'created' }))
      },
    })
    const { events, result } = await collectEvents(gen)
    const types = events.map((e) => e.event)
    expect(types[0]).toBe('wave_start')
    expect(types).toContain('wave_complete')
    expect(types).toContain('files_saved')
    expect(result.files.length).toBe(2)
    expect(saved.map((f) => f.path).sort()).toEqual(['app/page.jsx', 'components/Navbar.jsx'])
  })

  test('drops files outside the declared wave set', async () => {
    const provider = makeStreamingProvider([
      makeToolCall([
        { path: 'app/page.jsx', content: 'x'.repeat(200) },
        { path: 'components/Navbar.jsx', content: 'x'.repeat(200) },
        { path: 'pages/Dashboard.jsx', content: 'x'.repeat(200) }, // NOT in scaffold wave
      ]),
    ])
    const gen = buildWave({
      plan: testPlan,
      wave: testPlan.waves[0],
      filesBuiltSoFar: [],
      provider,
      waveIndex: 0,
      wavesTotal: 3,
      onFilesProduced: async (files) => files.map((f) => ({ ...f, id: 'id', action: 'created' })),
    })
    const { events, result } = await collectEvents(gen)
    const complete = events.find((e) => e.event === 'wave_complete')
    expect(complete.data.filesBuilt).toEqual(expect.arrayContaining(['app/page.jsx', 'components/Navbar.jsx']))
    expect(complete.data.filesDropped).toContain('pages/Dashboard.jsx')
    expect(result.files.length).toBe(2)
  })

  test('emits wave_error when no expected files produced', async () => {
    const provider = {
      chatWithToolsStream: async function* () { yield { type: 'tool_calls', tool_calls: [] } },
      chatWithTools: async () => ({ content: '', tool_calls: [] }),
    }
    const gen = buildWave({
      plan: testPlan,
      wave: testPlan.waves[0],
      filesBuiltSoFar: [],
      provider,
      waveIndex: 0,
      wavesTotal: 3,
      onFilesProduced: async (files) => files,
    })
    const { events, result } = await collectEvents(gen)
    expect(events.some((e) => e.event === 'wave_error')).toBe(true)
    expect(result.error).toBe('no_expected_files')
  })

  test('recovers from tool_args_delta when tool_calls is empty', async () => {
    const provider = {
      chatWithToolsStream: async function* () {
        yield { type: 'tool_args_delta', delta: JSON.stringify({ files: [
          { path: 'app/page.jsx', content: 'x'.repeat(200) },
          { path: 'components/Navbar.jsx', content: 'x'.repeat(200) },
        ]}) }
        yield { type: 'tool_calls', tool_calls: [] }
      },
      chatWithTools: async () => ({ content: '', tool_calls: [] }),
    }
    const gen = buildWave({
      plan: testPlan,
      wave: testPlan.waves[0],
      filesBuiltSoFar: [],
      provider,
      waveIndex: 0,
      wavesTotal: 3,
      onFilesProduced: async (files) => files.map((f) => ({ ...f, id: 'id', action: 'created' })),
    })
    const { result } = await collectEvents(gen)
    expect(result.files.length).toBe(2)
  })
})

describe('runAllWaves', () => {
  test('runs every wave in order and accumulates files', async () => {
    const provider = makeStreamingProvider([
      makeToolCall([
        { path: 'app/page.jsx', content: 'x'.repeat(200) },
        { path: 'components/Navbar.jsx', content: 'x'.repeat(200) },
      ]),
      makeToolCall([{ path: 'pages/Landing.jsx', content: 'x'.repeat(200) }]),
      makeToolCall([{ path: 'pages/Signup.jsx', content: 'x'.repeat(200) }]),
    ])
    const gen = runAllWaves({
      plan: testPlan,
      provider,
      saveFiles: async (files) => files.map((f) => ({ ...f, id: 'id_' + f.path, action: 'created' })),
    })
    const { events, result } = await collectEvents(gen)
    const waveStarts = events.filter((e) => e.event === 'wave_start')
    const waveCompletes = events.filter((e) => e.event === 'wave_complete')
    expect(waveStarts.length).toBe(3)
    expect(waveCompletes.length).toBe(3)
    expect(waveStarts.map((e) => e.data.waveId)).toEqual(['scaffold', 'public', 'auth'])
    expect(result.files.length).toBe(4)
    expect(result.aborted).toBe(false)
  })

  test('aborts when scaffold wave produces nothing', async () => {
    const provider = {
      chatWithToolsStream: async function* () { yield { type: 'tool_calls', tool_calls: [] } },
      chatWithTools: async () => ({ content: '', tool_calls: [] }),
    }
    const gen = runAllWaves({
      plan: testPlan,
      provider,
      saveFiles: async (files) => files,
    })
    const { events, result } = await collectEvents(gen)
    expect(result.aborted).toBe(true)
    expect(events.some((e) => e.event === 'build_aborted')).toBe(true)
    // Only scaffold wave should run — abort before public/auth
    const waveStarts = events.filter((e) => e.event === 'wave_start')
    expect(waveStarts.length).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Prompt-content tests — guard against regression where hard rules
// against duplicate navbars / ignored logo uploads silently disappear.
// ──────────────────────────────────────────────────────────────────────
import { buildWaveSystemPrompt } from '../../lib/ai/brief-builder.js'

const samplePlan = {
  archetypeId: 'saas_tool',
  brand: { name: 'Acme', description: 'Demo', audience: 'PMs', tone: 'Friendly', colors: 'violet' },
  routes: [
    { id: 'landing', file: 'pages/Landing.jsx', description: 'Hero + features' },
    { id: 'signup', file: 'pages/Signup.jsx' },
  ],
  flows: [{ id: 'signup_to_dashboard', desc: 'Signup → dashboard' }],
  components: [],
  dataShapes: [],
  waves: [],
}

describe('buildWaveSystemPrompt — hard rules enforcement', () => {
  const wave = { id: 'scaffold', label: 'Scaffold', files: ['app/page.jsx', 'components/Navbar.jsx'] }

  test('HARD RULE #15 (ROUTER CLEANLINESS / no Navbar in router) is present', () => {
    const prompt = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(prompt).toContain('ROUTER CLEANLINESS')
    expect(prompt).toMatch(/MUST NOT render.*Navbar/i)
    expect(prompt).toMatch(/DUPLICATE navbars?/i)
  })

  test('HARD RULE #16 (USE PROVIDED IMAGE ASSETS) is present', () => {
    const prompt = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(prompt).toContain('USE PROVIDED IMAGE ASSETS')
    expect(prompt).toMatch(/NEVER leave a placeholder/i)
  })

  test('Image-asset context block appears only when imageAssets is populated', () => {
    const without = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(without).not.toContain('USER-PROVIDED IMAGE ASSETS')

    const withImg = buildWaveSystemPrompt({
      plan: { ...samplePlan, imageAssets: [{ role: 'logo', name: 'logo.png', index: 0 }] },
      wave,
      filesBuiltSoFar: [],
    })
    expect(withImg).toContain('USER-PROVIDED IMAGE ASSETS')
    expect(withImg).toContain('components/assets.js')
    expect(withImg).toContain('LOGO_URL')
    expect(withImg).toMatch(/MUST render <img src=\{LOGO_URL\}/i)
  })

  test('hero image context mentions HERO_URL export when a hero asset is present', () => {
    const prompt = buildWaveSystemPrompt({
      plan: { ...samplePlan, imageAssets: [
        { role: 'logo', name: 'logo.png', index: 0 },
        { role: 'hero', name: 'hero.jpg', index: 1 },
      ]},
      wave,
      filesBuiltSoFar: [],
    })
    expect(prompt).toContain('LOGO_URL')
    expect(prompt).toContain('HERO_URL')
    expect(prompt).toMatch(/hero section MUST render <img src=\{HERO_URL\}/i)
  })

  test('HARD RULE #17 (BRAND COPY DISCIPLINE) is present with concrete examples', () => {
    const prompt = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(prompt).toContain('BRAND COPY DISCIPLINE')
    expect(prompt).toMatch(/NOT "Get Started"/)
    expect(prompt).toMatch(/Welcome to \$\{plan\.brand\.name\}|Welcome to .+brand/)
  })

  test('generic placeholder ban in rule 9 names real offenders', () => {
    const prompt = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(prompt).toContain('Lorem ipsum')
    expect(prompt).toContain('Welcome to our platform')
    expect(prompt).toContain('Get started today')
  })

  test('HARD RULE #18 (THEME-TOKEN DISCIPLINE) bans hardcoded color classes', () => {
    const prompt = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(prompt).toContain('THEME-TOKEN DISCIPLINE')
    expect(prompt).toMatch(/NEVER hardcode colors/)
    expect(prompt).toContain('bg-[var(--primary)]')
    expect(prompt).toContain('text-[var(--ink)]')
    expect(prompt).toMatch(/bg-<color>-<shade>/)
  })

  test('DESIGN TOKENS block appears when plan.designTokens is populated', () => {
    const withTokens = buildWaveSystemPrompt({
      plan: {
        ...samplePlan,
        designTokens: {
          bg: '#0a0a0a', ink: '#fff', primary: '#ff5a4e',
          surface: '#111', surface2: '#1a1a1a', border: 'rgba(255,255,255,0.1)',
          inkMuted: 'rgba(255,255,255,0.6)', primaryInk: '#000', accent: '#ffcc00',
          radius: '0.5rem', radiusLg: '1rem',
          fontDisplay: '"GT Sectra", serif', fontBody: '"Inter", sans-serif',
          mode: 'dark', vibe: 'editorial-dark', avoid: [],
        },
      },
      wave,
      filesBuiltSoFar: [],
    })
    expect(withTokens).toContain('DESIGN TOKENS')
    expect(withTokens).toContain('editorial-dark')
    expect(withTokens).toContain('#ff5a4e')
    expect(withTokens).toContain('bg-[var(--primary)]')
    expect(withTokens).toContain('ThemeProvider')
  })

  test('DESIGN TOKENS block is absent when plan has no designTokens', () => {
    const prompt = buildWaveSystemPrompt({ plan: samplePlan, wave, filesBuiltSoFar: [] })
    expect(prompt).not.toContain('═══ DESIGN TOKENS')
  })
})

// ──────────────────────────────────────────────────────────────────────
// Image-in-wave tests — the builder must receive the actual reference
// images as OpenAI vision image_url content parts for every wave when
// plan.imageAssets is populated. This is the "builder LLM sees the
// reference while writing code" fix.
// ──────────────────────────────────────────────────────────────────────
describe('buildWave — reference-image attachment', () => {
  const planWithImages = {
    ...testPlan,
    imageAssets: [
      { role: 'logo', name: 'logo.png', dataUrl: 'data:image/png;base64,AAAA', index: 0 },
      { role: 'hero', name: 'hero.jpg', dataUrl: 'data:image/jpeg;base64,BBBB', index: 1 },
    ],
  }

  async function runAndCaptureMessages(plan) {
    const provider = makeStreamingProvider([
      makeToolCall([
        { path: 'app/page.jsx', content: 'export default function App() { return null }' + ' '.repeat(100) },
        { path: 'components/Navbar.jsx', content: 'export default function Navbar() { return null }' + ' '.repeat(100) },
      ]),
    ])
    const gen = buildWave({
      plan,
      wave: plan.waves[0],
      filesBuiltSoFar: [],
      provider,
      waveIndex: 0,
      wavesTotal: 3,
      onFilesProduced: async (files) => files.map((f) => ({ ...f, id: 'x', action: 'created' })),
    })
    await collectEvents(gen)
    return provider.messageLog[0]
  }

  test('user message is a multi-part array when imageAssets are present', async () => {
    const messages = await runAndCaptureMessages(planWithImages)
    const userMsg = messages[1]
    expect(Array.isArray(userMsg.content)).toBe(true)
  })

  test('user message contains one image_url part per reference (capped at 2)', async () => {
    const messages = await runAndCaptureMessages(planWithImages)
    const userContent = messages[1].content
    const imgs = userContent.filter((c) => c.type === 'image_url')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].image_url.url).toBe('data:image/png;base64,AAAA')
    expect(imgs[1].image_url.url).toBe('data:image/jpeg;base64,BBBB')
  })

  test('excess images beyond 2 are dropped to control token cost', async () => {
    const many = {
      ...testPlan,
      imageAssets: [
        { role: 'logo', dataUrl: 'data:image/png;base64,A', index: 0 },
        { role: 'hero', dataUrl: 'data:image/png;base64,B', index: 1 },
        { role: 'reference', dataUrl: 'data:image/png;base64,C', index: 2 },
        { role: 'reference', dataUrl: 'data:image/png;base64,D', index: 3 },
      ],
    }
    const messages = await runAndCaptureMessages(many)
    const imgs = messages[1].content.filter((c) => c.type === 'image_url')
    expect(imgs).toHaveLength(2)
  })

  test('text part includes the "USE these as visual source of truth" directive', async () => {
    const messages = await runAndCaptureMessages(planWithImages)
    const text = messages[1].content.find((c) => c.type === 'text')
    expect(text).toBeDefined()
    expect(text.text).toMatch(/Reference image/i)
    expect(text.text).toMatch(/visual source of truth/i)
    expect(text.text).toMatch(/palette, typography mood, and composition/i)
  })

  test('user message is a plain string when no imageAssets — no regression', async () => {
    const messages = await runAndCaptureMessages(testPlan)
    expect(typeof messages[1].content).toBe('string')
  })

  test('image_url parts use detail=low to keep token cost reasonable', async () => {
    const messages = await runAndCaptureMessages(planWithImages)
    const imgs = messages[1].content.filter((c) => c.type === 'image_url')
    expect(imgs.every((i) => i.image_url.detail === 'low')).toBe(true)
  })
})
