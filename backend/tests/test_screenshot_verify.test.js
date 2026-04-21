/**
 * Unit tests for Session 28 (4/7) — screenshot-verify.js.
 *
 * Coverage:
 *  - pickInspectionFiles filters to canonical paths, truncates large files
 *  - buildVerifyRequest produces correct multi-part Vision message
 *    (text block + capped image_url parts with detail:low)
 *  - parseVerifyResult validates + coerces the JSON response
 *  - verifyBuild orchestration (non-blocking on error / empty inputs)
 *  - formatVerifyForRepairPrompt produces a per-file prompt block
 */

import {
  pickInspectionFiles,
  buildVerifyRequest,
  parseVerifyResult,
  verifyBuild,
  formatVerifyForRepairPrompt,
  findingsToReviewShape,
  shouldContinueVisualLoop,
} from '../../lib/ai/screenshot-verify.js'

describe('pickInspectionFiles', () => {
  test('returns empty for missing/empty input', () => {
    expect(pickInspectionFiles(null)).toEqual([])
    expect(pickInspectionFiles([])).toEqual([])
  })

  test('picks only canonical inspection paths', () => {
    const files = [
      { path: 'app/page.jsx', content: 'landing code' },
      { path: 'components/Navbar.jsx', content: 'nav code' },
      { path: 'components/SomeRandom.jsx', content: 'random' },
      { path: 'components/AuthContext.jsx', content: 'auth' },
      { path: 'components/Landing.jsx', content: 'landing component' },
    ]
    const out = pickInspectionFiles(files)
    const paths = out.map(f => f.path)
    expect(paths).toContain('app/page.jsx')
    expect(paths).toContain('components/Navbar.jsx')
    expect(paths).toContain('components/Landing.jsx')
    expect(paths).not.toContain('components/SomeRandom.jsx')
    expect(paths).not.toContain('components/AuthContext.jsx')
  })

  test('truncates files larger than MAX_CODE_CHARS', () => {
    const big = 'X'.repeat(5000)
    const out = pickInspectionFiles([{ path: 'app/page.jsx', content: big }])
    expect(out[0].content.length).toBeLessThan(big.length)
    expect(out[0].content).toContain('[truncated')
  })

  test('gracefully skips files missing content', () => {
    const out = pickInspectionFiles([
      { path: 'app/page.jsx' },
      { path: 'components/Landing.jsx', content: 'ok' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('components/Landing.jsx')
  })
})

describe('buildVerifyRequest', () => {
  test('returns text-only content when no reference images', () => {
    const content = buildVerifyRequest(
      [{ path: 'app/page.jsx', content: 'code' }],
      [],
    )
    expect(Array.isArray(content)).toBe(true)
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('app/page.jsx')
  })

  test('attaches reference image_url parts with detail:low, capped at 3', () => {
    const refs = [
      { role: 'aesthetic', data: 'AAAA', name: 'moodboard.png' },
      { role: 'structural', data: 'BBBB', name: 'layout.png' },
      { role: 'aesthetic', data: 'CCCC', name: 'ref3.png' },
      { role: 'aesthetic', data: 'DDDD', name: 'ref4.png' }, // over cap
    ]
    const content = buildVerifyRequest(
      [{ path: 'app/page.jsx', content: 'code' }],
      refs,
    )
    const imageParts = content.filter(c => c.type === 'image_url')
    expect(imageParts).toHaveLength(3)
    for (const part of imageParts) {
      expect(part.image_url.detail).toBe('low')
      expect(part.image_url.url).toMatch(/^data:image\//)
    }
  })

  test('embeds the user note on each reference in the text block', () => {
    const content = buildVerifyRequest(
      [{ path: 'components/Landing.jsx', content: 'ok' }],
      [{ role: 'aesthetic', data: 'X', name: 'a.png', note: 'match the warm editorial tone' }],
    )
    expect(content[0].text).toContain('match the warm editorial tone')
    expect(content[0].text).toContain('role=aesthetic')
  })

  test('preserves pre-formed data URIs without re-prefixing', () => {
    const content = buildVerifyRequest(
      [{ path: 'app/page.jsx', content: 'ok' }],
      [{ role: 'aesthetic', data: 'data:image/png;base64,ALREADY', name: 'x.png' }],
    )
    const img = content.find(c => c.type === 'image_url')
    expect(img.image_url.url).toBe('data:image/png;base64,ALREADY')
  })
})

describe('parseVerifyResult', () => {
  test('returns null for unparseable input', () => {
    expect(parseVerifyResult(null)).toBeNull()
    expect(parseVerifyResult('')).toBeNull()
    expect(parseVerifyResult('not-json')).toBeNull()
    expect(parseVerifyResult('[]')).toBeNull() // array, not object
  })

  test('accepts a well-formed JSON response', () => {
    const raw = JSON.stringify({
      matches: false,
      confidence: 0.8,
      findings: [
        { file: 'components/Landing.jsx', category: 'palette', issue: 'wrong color', fix: 'use var(--primary)' },
      ],
      summary: 'palette off',
    })
    const out = parseVerifyResult(raw)
    expect(out.matches).toBe(false)
    expect(out.confidence).toBe(0.8)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].category).toBe('palette')
    expect(out.summary).toBe('palette off')
  })

  test('accepts an object directly (not a string)', () => {
    const out = parseVerifyResult({ matches: true, confidence: 0.9, findings: [], summary: 'all good' })
    expect(out.matches).toBe(true)
  })

  test('coerces invalid categories to "other"', () => {
    const raw = JSON.stringify({
      matches: false,
      confidence: 0.5,
      findings: [{ file: 'x', category: 'made-up-category', issue: 'y', fix: 'z' }],
    })
    const out = parseVerifyResult(raw)
    expect(out.findings[0].category).toBe('other')
  })

  test('clamps findings to 6 max', () => {
    const findings = Array.from({ length: 10 }, (_, i) => ({
      file: 'f', category: 'other', issue: `issue ${i}`, fix: '',
    }))
    const out = parseVerifyResult({ matches: false, confidence: 0.5, findings })
    expect(out.findings).toHaveLength(6)
  })

  test('defaults confidence to 0.5 when missing/out-of-range', () => {
    expect(parseVerifyResult({ matches: true, findings: [] }).confidence).toBe(0.5)
    expect(parseVerifyResult({ matches: true, confidence: 5, findings: [] }).confidence).toBe(0.5)
    expect(parseVerifyResult({ matches: true, confidence: -1, findings: [] }).confidence).toBe(0.5)
  })

  test('filters findings with empty/missing issue text', () => {
    const out = parseVerifyResult({
      matches: false,
      confidence: 0.5,
      findings: [
        { file: 'a', category: 'palette', issue: '', fix: 'x' },
        { file: 'b', category: 'palette', issue: 'real issue', fix: 'y' },
        { category: 'palette', fix: 'z' }, // no issue
      ],
    })
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].issue).toBe('real issue')
  })
})

describe('verifyBuild orchestration', () => {
  const fakeProvider = (returnValue) => ({
    chat: jest.fn(async () => returnValue),
  })

  test('returns null when no inspection files available', async () => {
    const out = await verifyBuild({
      files: [{ path: 'random.js', content: 'x' }],
      referenceImages: [{ data: 'x' }],
      provider: fakeProvider('{}'),
    })
    expect(out).toBeNull()
  })

  test('returns null when no reference images', async () => {
    const out = await verifyBuild({
      files: [{ path: 'app/page.jsx', content: 'x' }],
      referenceImages: [],
      provider: fakeProvider('{}'),
    })
    expect(out).toBeNull()
  })

  test('returns null gracefully on provider failure (non-blocking)', async () => {
    const out = await verifyBuild({
      files: [{ path: 'app/page.jsx', content: 'x' }],
      referenceImages: [{ data: 'x' }],
      provider: { chat: async () => { throw new Error('rate limit') } },
    })
    expect(out).toBeNull()
  })

  test('happy path: parses provider JSON response', async () => {
    const provider = fakeProvider(JSON.stringify({
      matches: true,
      confidence: 0.95,
      findings: [],
      summary: 'all good',
    }))
    const out = await verifyBuild({
      files: [{ path: 'app/page.jsx', content: 'x' }],
      referenceImages: [{ data: 'x' }],
      provider,
    })
    expect(out.matches).toBe(true)
    expect(out.confidence).toBe(0.95)
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })
})

describe('formatVerifyForRepairPrompt', () => {
  test('returns empty string when matches=true', () => {
    const out = formatVerifyForRepairPrompt({ matches: true, confidence: 1, findings: [], summary: 'ok' })
    expect(out).toBe('')
  })

  test('returns empty string when findings empty', () => {
    const out = formatVerifyForRepairPrompt({ matches: false, confidence: 0.5, findings: [], summary: '' })
    expect(out).toBe('')
  })

  test('groups findings per file', () => {
    const out = formatVerifyForRepairPrompt({
      matches: false,
      confidence: 0.5,
      findings: [
        { file: 'components/Landing.jsx', category: 'palette', issue: 'wrong color', fix: 'swap bg' },
        { file: 'components/Landing.jsx', category: 'typography', issue: 'wrong font', fix: 'use serif' },
        { file: 'components/Navbar.jsx', category: 'imagery', issue: 'missing logo', fix: 'import LOGO_URL' },
      ],
      summary: 'several gaps',
    })
    // Landing has 2 bullets, Navbar has 1
    expect(out).toContain('components/Landing.jsx')
    expect(out).toContain('components/Navbar.jsx')
    expect(out).toContain('[palette]')
    expect(out).toContain('wrong color')
    expect(out).toContain('FIX: swap bg')
    expect(out).toContain('several gaps')
  })
})

describe('findingsToReviewShape (Session 29 visual-repair bridge)', () => {
  test('returns empty shape when no findings', () => {
    expect(findingsToReviewShape(null)).toEqual({ missing: [], broken: [] })
    expect(findingsToReviewShape({ matches: true, findings: [] })).toEqual({ missing: [], broken: [] })
  })

  test('synthesizes broken[] entries with file: prefix repairBuild expects', () => {
    const out = findingsToReviewShape({
      matches: false,
      confidence: 0.6,
      summary: 'gaps',
      findings: [
        { file: 'components/Landing.jsx', category: 'palette', issue: 'hero uses wrong color', fix: 'use var(--primary)' },
        { file: 'components/Navbar.jsx', category: 'imagery', issue: 'logo missing', fix: 'import LOGO_URL' },
      ],
    })
    expect(out.missing).toEqual([])
    expect(out.broken).toHaveLength(2)
    // repairBuild parses file prefix via /^([^:]+):/ — the ':' must come after the file path
    expect(out.broken[0]).toMatch(/^components\/Landing\.jsx: vision-palette-/)
    expect(out.broken[1]).toMatch(/^components\/Navbar\.jsx: vision-imagery-/)
    // The suggested fix from Vision MUST survive into the repair prompt
    expect(out.broken[0]).toContain('use var(--primary)')
    expect(out.broken[1]).toContain('import LOGO_URL')
  })

  test('skips findings missing file or issue', () => {
    const out = findingsToReviewShape({
      matches: false, confidence: 0.5, findings: [
        { file: '', category: 'palette', issue: 'x', fix: '' },
        { file: 'app/page.jsx', category: 'other', issue: '', fix: '' },
        { file: 'app/page.jsx', category: 'other', issue: 'real issue', fix: '' },
      ],
    })
    expect(out.broken).toHaveLength(1)
    expect(out.broken[0]).toContain('app/page.jsx')
  })

  test('produces a slug that survives repairBuild\'s prefix regex parse', () => {
    const out = findingsToReviewShape({
      matches: false, confidence: 0.5, findings: [
        { file: 'components/Hero.jsx', category: 'spacing', issue: 'CRAMPED! hero: padding too small', fix: 'py-20' },
      ],
    })
    const brokenPathRegex = /^([^:]+):/  // same regex repairBuild uses
    const match = brokenPathRegex.exec(out.broken[0])
    expect(match).not.toBeNull()
    expect(match[1]).toBe('components/Hero.jsx')
  })
})

describe('shouldContinueVisualLoop (Session 32 N-round gate)', () => {
  const baseVerdict = (overrides = {}) => ({
    matches: false,
    confidence: 0.6,
    findings: [{ file: 'components/Landing.jsx', category: 'palette', issue: 'x', fix: 'y' }],
    summary: 'x',
    ...overrides,
  })

  test('stops with reason "no-verdict" when input is null', () => {
    expect(shouldContinueVisualLoop(null, 0, 3)).toEqual({ stop: true, reason: 'no-verdict' })
  })

  test('stops with reason "matches" when Vision says we\'re done', () => {
    const out = shouldContinueVisualLoop(baseVerdict({ matches: true }), 0, 3)
    expect(out).toEqual({ stop: true, reason: 'matches' })
  })

  test('stops with reason "no-findings" when findings array is empty', () => {
    const out = shouldContinueVisualLoop(baseVerdict({ findings: [] }), 0, 3)
    expect(out).toEqual({ stop: true, reason: 'no-findings' })
  })

  test('stops with reason "no-findings" when findings is not an array', () => {
    const out = shouldContinueVisualLoop(baseVerdict({ findings: null }), 0, 3)
    expect(out).toEqual({ stop: true, reason: 'no-findings' })
  })

  test('stops with reason "max-rounds" when on the final round', () => {
    // 0-indexed round: round=2 is the LAST of 3 rounds (0,1,2)
    const out = shouldContinueVisualLoop(baseVerdict(), 2, 3)
    expect(out).toEqual({ stop: true, reason: 'max-rounds' })
  })

  test('continues when there are findings and rounds remaining', () => {
    // round 0 of 3: two more repair opportunities remain
    expect(shouldContinueVisualLoop(baseVerdict(), 0, 3)).toEqual({ stop: false, reason: 'continue' })
    expect(shouldContinueVisualLoop(baseVerdict(), 1, 3)).toEqual({ stop: false, reason: 'continue' })
  })

  test('honours maxRounds=1 (degenerate single-shot)', () => {
    // With max=1, round=0 is both first and last — stop with max-rounds
    const out = shouldContinueVisualLoop(baseVerdict(), 0, 1)
    expect(out).toEqual({ stop: true, reason: 'max-rounds' })
  })

  test('matches=true short-circuits even on round 0', () => {
    const out = shouldContinueVisualLoop(baseVerdict({ matches: true }), 0, 5)
    expect(out.stop).toBe(true)
    expect(out.reason).toBe('matches')
  })
})
