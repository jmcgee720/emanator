import { computeQualityScore } from '../../lib/ai/quality-score.js'

// Build a minimal "perfect" manifest + signals so we can assert the score
// engine returns 100 on a pristine build.
function perfectSignals() {
  return {
    manifest: {
      integrity: [
        { name: 'theme', pass: true },
        { name: 'assets', pass: true },
        { name: 'logo', pass: true },
        { name: 'navbar', pass: true },
      ],
      assets: {
        emitted: true,
        exports: [
          { name: 'LOGO_URL', role: 'logo', sourceFile: 'logo.png' },
          { name: 'HERO_URL', role: 'hero', sourceFile: 'hero.jpg' },
        ],
        missing: [],
      },
      theme: {
        emitted: true,
        tokens: {
          primary: '#ff6600',
          fontDisplay: '"Fraunces", Georgia, serif',
        },
      },
      warnings: [],
    },
    screenshotVerify: {
      matches: true,
      confidence: 1,
      findings: [],
      summary: 'all good',
    },
    visualLoopSummary: null, // no repair needed
  }
}

describe('computeQualityScore — shape', () => {
  it('returns {total, grade, gradeColor, headline, components[]}', () => {
    const s = computeQualityScore({})
    expect(s).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        grade: expect.any(String),
        gradeColor: expect.any(String),
        headline: expect.any(String),
        components: expect.any(Array),
      })
    )
    expect(s.components.length).toBe(5) // integrity, verify, repair, assets, warnings
  })

  it('clamps score to 0..100', () => {
    const s = computeQualityScore({})
    expect(s.total).toBeGreaterThanOrEqual(0)
    expect(s.total).toBeLessThanOrEqual(100)
  })

  it('every component has {name, points, max, note}', () => {
    const s = computeQualityScore({})
    for (const c of s.components) {
      expect(c).toEqual(expect.objectContaining({
        name: expect.any(String),
        points: expect.any(Number),
        max: expect.any(Number),
        note: expect.any(String),
      }))
      expect(c.points).toBeLessThanOrEqual(c.max)
      expect(c.points).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('computeQualityScore — grade thresholds', () => {
  it('perfect signals score >=90 and grade is excellent', () => {
    const s = computeQualityScore(perfectSignals())
    expect(s.total).toBeGreaterThanOrEqual(90)
    expect(s.grade).toBe('excellent')
    expect(s.gradeColor).toBe('emerald')
    expect(s.headline).toBe('Ship it.')
  })

  it('empty signals land in the "ok" band', () => {
    // integrity=15, verify=15, repair=15, assets=7, warnings=10  → 62 ok
    const s = computeQualityScore({})
    expect(s.total).toBe(62)
    expect(s.grade).toBe('ok')
    expect(s.gradeColor).toBe('amber')
  })

  it('disaster signals land in "needs-work"', () => {
    const signals = {
      manifest: {
        integrity: [{ pass: false }, { pass: false }, { pass: false }],
        assets: { emitted: false, exports: [], missing: ['LOGO_URL', 'HERO_URL'] },
        theme: { emitted: false, tokens: null },
        warnings: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
      },
      screenshotVerify: {
        matches: false,
        confidence: 0.2,
        findings: [{}, {}, {}, {}, {}, {}], // 6 findings = 0 factor
        summary: 'bad',
      },
      visualLoopSummary: { rounds: [{}, {}, {}], finalMatches: false },
    }
    const s = computeQualityScore(signals)
    expect(s.total).toBeLessThan(60)
    expect(s.grade).toBe('needs-work')
    expect(s.gradeColor).toBe('rose')
  })

  it('headline varies by band', () => {
    expect(computeQualityScore(perfectSignals()).headline).toMatch(/ship/i)
    expect(computeQualityScore({}).headline).toMatch(/usable/i)
  })
})

describe('scoreIntegrity (via computeQualityScore)', () => {
  const get = (manifest) => computeQualityScore({ manifest }).components.find((c) => c.name === 'Integrity')

  it('all passing = 30/30', () => {
    const c = get({ integrity: [{ pass: true }, { pass: true }, { pass: true }] })
    expect(c.points).toBe(30)
    expect(c.note).toMatch(/3\/3/)
  })

  it('half passing = 15/30', () => {
    const c = get({ integrity: [{ pass: true }, { pass: false }] })
    expect(c.points).toBe(15)
  })

  it('no checks run = neutral 15/30', () => {
    const c = get({})
    expect(c.points).toBe(15)
    expect(c.note).toMatch(/no integrity/i)
  })

  it('non-array integrity defaults to neutral', () => {
    const c = get({ integrity: null })
    expect(c.points).toBe(15)
  })
})

describe('scoreVerify (via computeQualityScore)', () => {
  const get = (screenshotVerify) => computeQualityScore({ screenshotVerify }).components.find((c) => c.name === 'Visual verify')

  it('MATCH at 100% = 30/30', () => {
    const c = get({ matches: true, confidence: 1, findings: [] })
    expect(c.points).toBe(30)
    expect(c.note).toMatch(/MATCH/)
  })

  it('MATCH at 60% confidence scales to 18', () => {
    const c = get({ matches: true, confidence: 0.6, findings: [] })
    expect(c.points).toBe(18)
  })

  it('mismatch with 1 finding at 100% confidence = 25', () => {
    // 30 * (1 - 1/6) * 1 = 25
    const c = get({ matches: false, confidence: 1, findings: [{}] })
    expect(c.points).toBe(25)
    expect(c.note).toMatch(/1 finding/)
  })

  it('mismatch with 6+ findings = 0 regardless of confidence', () => {
    const c = get({ matches: false, confidence: 1, findings: Array(6).fill({}) })
    expect(c.points).toBe(0)
  })

  it('no verify run = neutral 15', () => {
    const c = get(null)
    expect(c.points).toBe(15)
    expect(c.note).toMatch(/no vision/i)
  })

  it('missing confidence defaults to 0.5', () => {
    const c = get({ matches: true, findings: [] })
    expect(c.points).toBe(15)
  })
})

describe('scoreRepairEfficiency (via computeQualityScore)', () => {
  const get = (visualLoopSummary) => computeQualityScore({ visualLoopSummary }).components.find((c) => c.name === 'Repair efficiency')

  it('no loop needed = 15/15', () => {
    const c = get(null)
    expect(c.points).toBe(15)
    expect(c.note).toMatch(/no repair loop needed/i)
  })

  it('empty rounds array = 15/15', () => {
    const c = get({ rounds: [] })
    expect(c.points).toBe(15)
  })

  it('1 round reached MATCH = 15', () => {
    const c = get({ rounds: [{}], finalMatches: true })
    expect(c.points).toBe(15)
  })

  it('2 rounds reached MATCH = 10', () => {
    const c = get({ rounds: [{}, {}], finalMatches: true })
    expect(c.points).toBe(10)
  })

  it('3 rounds no MATCH = penalized further', () => {
    const c = get({ rounds: [{}, {}, {}], finalMatches: false })
    // base = max(0, 15 - 2*5) = 5 ; minus 3 for partial = 2
    expect(c.points).toBe(2)
  })

  it('5 rounds floored at 0', () => {
    const c = get({ rounds: [{}, {}, {}, {}, {}], finalMatches: false })
    expect(c.points).toBe(0)
  })
})

describe('scoreAssets (via computeQualityScore)', () => {
  const get = (manifest) => computeQualityScore({ manifest }).components.find((c) => c.name === 'Brand assets')

  it('logo + hero + brand palette + branded font = 15/15', () => {
    const c = get({
      assets: { exports: [{ role: 'logo' }, { role: 'hero' }] },
      theme: { tokens: { primary: '#ff6600', fontDisplay: '"Fraunces", serif' } },
    })
    expect(c.points).toBe(15)
    expect(c.note).toContain('logo')
    expect(c.note).toContain('hero')
    expect(c.note).toContain('palette')
    expect(c.note).toContain('font')
  })

  it('logo only = 6 pts', () => {
    const c = get({ assets: { exports: [{ role: 'logo' }] }, theme: null })
    expect(c.points).toBe(6)
  })

  it('photo counts as hero', () => {
    const c = get({ assets: { exports: [{ role: 'photo' }] }, theme: null })
    expect(c.points).toBe(4)
  })

  it('default palette (#0a0a0a) does not earn palette points', () => {
    const c = get({
      assets: { exports: [] },
      theme: { tokens: { primary: '#0a0a0a', fontDisplay: 'system-ui' } },
    })
    expect(c.points).toBe(0)
  })

  it('system-ui font does not earn font points', () => {
    const c = get({
      assets: { exports: [] },
      theme: { tokens: { primary: '#ff0000', fontDisplay: 'system-ui, sans-serif' } },
    })
    // palette yes (3), font no (0)
    expect(c.points).toBe(3)
  })

  it('missing manifest = neutral 7', () => {
    const c = get({})
    expect(c.points).toBe(7)
    expect(c.note).toMatch(/no asset manifest/i)
  })
})

describe('scoreWarnings (via computeQualityScore)', () => {
  const get = (manifest) => computeQualityScore({ manifest }).components.find((c) => c.name === 'Clean warnings')

  it('zero warnings = 10/10', () => {
    const c = get({ warnings: [] })
    expect(c.points).toBe(10)
  })

  it('3 warnings = 7', () => {
    const c = get({ warnings: ['a', 'b', 'c'] })
    expect(c.points).toBe(7)
  })

  it('floors at 0', () => {
    const c = get({ warnings: Array(20).fill('x') })
    expect(c.points).toBe(0)
  })

  it('missing warnings array = 10', () => {
    const c = get({})
    expect(c.points).toBe(10)
  })
})

describe('computeQualityScore — buildManifest integration', () => {
  it('buildManifest returns manifest.qualityScore', async () => {
    const { buildManifest } = await import('../../lib/ai/build-observatory.js')
    const m = buildManifest({
      imageAssets: [{ role: 'logo', name: 'logo.png', dataUrl: 'data:image/png;base64,QUJD' }],
      projectFiles: [
        { path: 'components/theme.js', content: 'export const DESIGN_TOKENS={}' },
        { path: 'components/assets.js', content: 'export const LOGO_URL = "x"' },
        { path: 'components/Navbar.jsx', content: '<img src={LOGO_URL} />' },
      ],
      designTokens: { primary: '#ff00ff', bg: '#000', ink: '#fff', fontDisplay: '"Inter", sans-serif' },
      screenshotVerify: { matches: true, confidence: 0.95, findings: [], summary: 'ok' },
    })
    expect(m.qualityScore).toBeDefined()
    expect(m.qualityScore.total).toBeGreaterThan(60)
    expect(m.qualityScore.components.length).toBe(5)
  })

  it('qualityScore present even when no signals available', async () => {
    const { buildManifest } = await import('../../lib/ai/build-observatory.js')
    const m = buildManifest({})
    expect(m.qualityScore).toBeDefined()
    expect(m.qualityScore.total).toBeGreaterThanOrEqual(0)
  })
})
