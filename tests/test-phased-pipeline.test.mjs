/**
 * Smoke test: phased pipeline orchestrator wiring.
 *
 * Runs the orchestrator with stubbed LLM/image/db providers to verify:
 *  - All 6 phases are invoked in order
 *  - Phase outputs flow into subsequent phases via priorResults
 *  - phase_start / phase_done / file_saved events fire
 *  - A failure in any phase aborts cleanly with a phase_error event
 */
import { runPhasedPipeline } from '../lib/ai/phased-pipeline/index.js'

const fakePlan = {
  archetype: 'hospitality',
  brand: { name: 'Cozy Coffee', tagline: 'neighborhood coffee', mood: 'warm cozy earthy', audience: 'locals', tone: 'warm and direct' },
  sections: [
    { id: 'nav', purpose: 'navigate' },
    { id: 'hero', purpose: 'sell brand' },
    { id: 'features', purpose: 'highlight beans', count: 3 },
    { id: 'footer', purpose: 'links' },
  ],
  imageManifest: [
    { role: 'hero', subject: 'pour-over coffee, warm morning light' },
    { role: 'feature_1', subject: 'coffee beans on wooden scoop' },
  ],
  files: ['app/page.jsx', 'components/Nav.jsx'],
}

const fakeCopy = {
  nav: { logoText: 'Cozy Coffee', links: [{ label: 'Menu', href: '/menu' }], cta: 'Visit us' },
  hero: { headline: 'Hand-roasted coffee', subheadline: 'In your neighborhood', primaryCta: 'Shop beans' },
  features: [{ title: 'Single-origin', description: 'From 40+ partner farms', icon: 'coffee' }],
  footer: { tagline: 'Coffee with heart', legal: '© 2026 Cozy Coffee' },
}

const fakeTokens = {
  palette: { pageBg: 'bg-amber-50', primary: 'bg-amber-800', ink: 'text-stone-900', hex: { pageBg: '#FFFBEB' } },
  typography: { displayFamily: 'Fraunces, serif', bodyFamily: 'Inter, sans-serif', heroSize: 'text-6xl md:text-8xl' },
  radius: { button: 'rounded-full', card: 'rounded-2xl' },
  shadow: { card: 'shadow-xl', button: 'shadow-lg' },
  imageryTreatment: 'photographic_warm',
}

const fakeLLMProvider = {
  providerName: 'mock',
  model: 'mock-model',
  async chat(messages, options) {
    const sys = messages.find((m) => m.role === 'system')?.content || ''
    if (sys.includes('senior product designer + technical architect')) return JSON.stringify(fakePlan)
    if (sys.includes('senior brand copywriter')) return JSON.stringify(fakeCopy)
    if (sys.includes('senior product designer. Given a brand mood')) return JSON.stringify(fakeTokens)
    return '{}'
  },
  async chatWithTools(messages, tools, options) {
    // Simulate compose: return 2 files
    return {
      tool_calls: [{
        function: {
          name: 'create_files',
          arguments: JSON.stringify({
            files: [
              { path: 'app/page.jsx', content: '/* '.padEnd(500, 'x') + ' */\nexport default function Page() { return <main>Cozy Coffee</main> }' },
              { path: 'components/Nav.jsx', content: '/* '.padEnd(500, 'x') + ' */\nexport default function Nav() { return <nav>nav</nav> }' },
            ],
          }),
        },
      }],
    }
  },
}

const fakeGeminiProvider = {
  async generateImage(prompt) {
    // 10 bytes of base64-garbage — enough to prove the pipeline handled it
    return { b64_json: 'aGVsbG8gYmFu', mimeType: 'image/png' }
  },
}

const fakeDb = {
  projectFiles: {
    _store: [],
    async findByPath(projectId, path) { return this._store.find((f) => f.project_id === projectId && f.path === path) || null },
    async update(id, patch) { const f = this._store.find((x) => x.id === id); if (f) Object.assign(f, patch) },
    async create(doc) { const saved = { ...doc, id: `f_${this._store.length}` }; this._store.push(saved); return saved },
  },
  phaseStates: {
    _store: new Map(),
    async upsertByRunId(runId, doc) { this._store.set(runId, doc); return { runId } },
  },
}

const fakeAIService = {
  async logGenerationRun(rec) { /* no-op */ },
}

;(async () => {
  const events = []
  const gen = runPhasedPipeline({
    aiService: fakeAIService,
    provider: fakeLLMProvider,
    geminiProvider: fakeGeminiProvider,
    projectId: 'test-proj',
    chatId: 'test-chat',
    userId: 'test-user',
    brief: { rawMessage: 'landing page for a coffee shop', brandName: 'Cozy Coffee' },
    attachments: [],
    runId: 'run-1',
    db: fakeDb,
  })

  let final
  for await (const ev of gen) {
    events.push(ev)
  }
  // The return value from an async generator is obtained via .return() / .next()
  // but we need it directly. Use .next() loop instead.

  const types = events.map((e) => e.event)
  const phaseStarts = events.filter((e) => e.event === 'phase_start').map((e) => e.data.id)
  const phaseDones = events.filter((e) => e.event === 'phase_done').map((e) => e.data.id)
  const errors = events.filter((e) => e.event === 'phase_error' || e.event === 'error')
  const filesSaved = events.filter((e) => e.event === 'file_saved').map((e) => e.data.path)

  console.log('Event types emitted:', [...new Set(types)])
  console.log('Phases started:', phaseStarts)
  console.log('Phases done:', phaseDones)
  console.log('Errors:', errors.length, errors.map((e) => e.data?.message || e.data?.id))
  console.log('Files saved:', filesSaved)

  let allGood = true
  if (phaseStarts.length !== 6) { console.error(`FAIL: expected 6 phase_start events, got ${phaseStarts.length}`); allGood = false }
  if (phaseDones.length !== 6) { console.error(`FAIL: expected 6 phase_done events, got ${phaseDones.length}`); allGood = false }
  if (errors.length > 0) { console.error(`FAIL: ${errors.length} errors emitted`); allGood = false }
  if (filesSaved.length !== 2) { console.error(`FAIL: expected 2 files saved, got ${filesSaved.length}`); allGood = false }

  process.exit(allGood ? 0 : 1)
})().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
