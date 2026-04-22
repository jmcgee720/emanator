/**
 * Tests for the extracted art-direction fan-out (refactored Feb 2026).
 * Uses the same dep-injection pattern as the visual-loop tests so no
 * ESM module-mocking framework is needed.
 */

import { runArtDirectionFanout } from '../../lib/ai/pipeline/art-direction-fanout.js'

async function drain(gen) {
  const events = []
  let result
  while (true) {
    const next = await gen.next()
    if (next.done) { result = next.value; break }
    events.push(next.value)
  }
  return { events, result }
}

function makeDeps(overrides = {}) {
  return {
    analyzeArtDirection: jest.fn().mockResolvedValue(null),
    analyzeDesignTokens: jest.fn().mockResolvedValue(null),
    classifyRecipeFamily: jest.fn().mockResolvedValue(null),
    analyzeLayoutBlueprint: jest.fn().mockResolvedValue(null),
    mapImageAssets: jest.fn().mockReturnValue([]),
    ...overrides,
  }
}

const img = (role, data = 'data:image/png;base64,AAA') => ({ type: 'image', role, data, name: `${role}.png` })

describe('runArtDirectionFanout — no-op paths', () => {
  it('returns default empty result when no attachments', async () => {
    const deps = makeDeps()
    const gen = runArtDirectionFanout({ attachments: [], provider: {}, buildTimings: [], deps })
    const { events, result } = await drain(gen)
    expect(events).toEqual([])
    expect(result).toEqual({
      artDirection: null, designTokens: null, recipeFamily: null, layoutBlueprint: null, imageAssets: [],
    })
    expect(deps.analyzeDesignTokens).not.toHaveBeenCalled()
    expect(deps.mapImageAssets).not.toHaveBeenCalled()
  })

  it('ignores non-image attachments', async () => {
    const deps = makeDeps()
    const gen = runArtDirectionFanout({
      attachments: [{ type: 'text', data: 'hello' }, { type: 'image' /* no data */ }],
      provider: {}, buildTimings: [], deps,
    })
    const { events } = await drain(gen)
    expect(events).toEqual([])
    expect(deps.analyzeDesignTokens).not.toHaveBeenCalled()
  })
})

describe('runArtDirectionFanout — brand-only uploads', () => {
  it('maps brand assets and re-uses them for aesthetic extraction', async () => {
    const deps = makeDeps({
      analyzeArtDirection: jest.fn().mockResolvedValue('elegant editorial'),
      analyzeDesignTokens: jest.fn().mockResolvedValue({ vibe: 'editorial', primary: '#ff6600' }),
      classifyRecipeFamily: jest.fn().mockResolvedValue({ family: 'editorial-serif', confidence: 0.9, reason: 'serif headings' }),
      mapImageAssets: jest.fn().mockReturnValue([{ role: 'logo', name: 'logo.png' }]),
    })
    const timings = []
    const gen = runArtDirectionFanout({
      attachments: [img('brand', 'data:image/png;base64,X')],
      provider: { name: 'p' },
      buildTimings: timings,
      deps,
    })
    const { events, result } = await drain(gen)

    expect(deps.analyzeArtDirection).toHaveBeenCalledTimes(1)
    expect(deps.analyzeDesignTokens).toHaveBeenCalledTimes(1)
    expect(deps.classifyRecipeFamily).toHaveBeenCalledTimes(1)
    expect(deps.analyzeLayoutBlueprint).not.toHaveBeenCalled()

    expect(result.artDirection).toBe('elegant editorial')
    expect(result.designTokens?.primary).toBe('#ff6600')
    expect(result.recipeFamily?.family).toBe('editorial-serif')
    expect(result.layoutBlueprint).toBeNull()
    expect(result.imageAssets).toHaveLength(1)

    const eventNames = events.map((e) => e.event)
    expect(eventNames).toContain('status')
    expect(eventNames).toContain('art_direction')
    expect(eventNames).toContain('design_tokens')
    expect(eventNames).toContain('recipe_family')

    expect(timings.map((t) => t.stage)).toEqual(expect.arrayContaining(['art_direction', 'design_tokens', 'recipe_family']))
  })

  it('status event carries accurate count', async () => {
    const deps = makeDeps()
    const gen = runArtDirectionFanout({
      attachments: [img('brand'), img('brand'), img('brand')],
      provider: {}, buildTimings: [], deps,
    })
    const { events } = await drain(gen)
    const status = events.find((e) => e.event === 'status')
    expect(status.data.detail).toContain('3 reference images')
  })
})

describe('runArtDirectionFanout — tagged uploads', () => {
  it('aesthetic uploads feed the design-token pipeline, structural feed blueprint', async () => {
    const deps = makeDeps({
      analyzeDesignTokens: jest.fn().mockResolvedValue({ vibe: 'luxury', primary: '#000' }),
      analyzeLayoutBlueprint: jest.fn().mockResolvedValue({ sections_order: ['hero', 'features'] }),
    })
    const gen = runArtDirectionFanout({
      attachments: [img('aesthetic'), img('structural')],
      provider: {}, buildTimings: [], deps,
    })
    const { events, result } = await drain(gen)

    // aesthetic call received the 1 aesthetic attachment
    expect(deps.analyzeDesignTokens).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'aesthetic' })]),
      expect.anything(),
    )
    // blueprint call received the 1 structural attachment
    expect(deps.analyzeLayoutBlueprint).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'structural' })]),
      expect.anything(),
    )
    expect(result.layoutBlueprint?.sections_order).toEqual(['hero', 'features'])
    expect(events.some((e) => e.event === 'layout_blueprint')).toBe(true)
  })

  it('no structural uploads → layout blueprint call skipped entirely', async () => {
    const deps = makeDeps()
    const gen = runArtDirectionFanout({
      attachments: [img('aesthetic')],
      provider: {}, buildTimings: [], deps,
    })
    await drain(gen)
    expect(deps.analyzeLayoutBlueprint).not.toHaveBeenCalled()
  })

  it('brand uploads still feed design tokens when no aesthetic tag', async () => {
    const deps = makeDeps({
      analyzeDesignTokens: jest.fn().mockResolvedValue({ vibe: 'brand-fallback', primary: '#fff' }),
    })
    const gen = runArtDirectionFanout({
      attachments: [img('brand')],
      provider: {}, buildTimings: [], deps,
    })
    const { result } = await drain(gen)
    expect(deps.analyzeDesignTokens).toHaveBeenCalled()
    expect(result.designTokens?.vibe).toBe('brand-fallback')
  })

  it('untagged attachments are treated as brand', async () => {
    const deps = makeDeps({ mapImageAssets: jest.fn().mockReturnValue([{ role: 'logo' }]) })
    const gen = runArtDirectionFanout({
      attachments: [{ type: 'image', data: 'd' }], // no role
      provider: {}, buildTimings: [], deps,
    })
    const { result } = await drain(gen)
    expect(deps.mapImageAssets).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    )
    expect(result.imageAssets).toEqual([{ role: 'logo' }])
  })
})

describe('runArtDirectionFanout — fault tolerance', () => {
  it('one failed Vision call does not abort the rest', async () => {
    const deps = makeDeps({
      analyzeArtDirection: jest.fn().mockRejectedValue(new Error('art dir fail')),
      analyzeDesignTokens: jest.fn().mockResolvedValue({ vibe: 'ok', primary: '#fff' }),
      classifyRecipeFamily: jest.fn().mockResolvedValue({ family: 'saas-clean', confidence: 0.5, reason: 'default' }),
    })
    const gen = runArtDirectionFanout({
      attachments: [img('brand')],
      provider: {}, buildTimings: [], deps,
    })
    const { result } = await drain(gen)
    expect(result.artDirection).toBeNull()
    expect(result.designTokens?.vibe).toBe('ok')
    expect(result.recipeFamily?.family).toBe('saas-clean')
  })

  it('all failed calls yield safe nulls + never throw', async () => {
    const deps = makeDeps({
      analyzeArtDirection: jest.fn().mockRejectedValue(new Error('a')),
      analyzeDesignTokens: jest.fn().mockRejectedValue(new Error('b')),
      classifyRecipeFamily: jest.fn().mockRejectedValue(new Error('c')),
      analyzeLayoutBlueprint: jest.fn().mockRejectedValue(new Error('d')),
    })
    const gen = runArtDirectionFanout({
      attachments: [img('brand'), img('structural')],
      provider: {}, buildTimings: [], deps,
    })
    const { result } = await drain(gen)
    expect(result.artDirection).toBeNull()
    expect(result.designTokens).toBeNull()
    expect(result.recipeFamily).toBeNull()
    expect(result.layoutBlueprint).toBeNull()
    expect(Array.isArray(result.imageAssets)).toBe(true)
  })

  it('timings recorded even when calls throw', async () => {
    const deps = makeDeps({
      analyzeArtDirection: jest.fn().mockRejectedValue(new Error('nope')),
      analyzeDesignTokens: jest.fn().mockRejectedValue(new Error('nope')),
    })
    const timings = []
    const gen = runArtDirectionFanout({
      attachments: [img('brand')],
      provider: {}, buildTimings: timings, deps,
    })
    await drain(gen)
    expect(timings.map((t) => t.stage)).toEqual(expect.arrayContaining(['art_direction', 'design_tokens', 'recipe_family']))
    for (const t of timings) expect(t.ms).toBeGreaterThanOrEqual(0)
  })

  it('suppresses failed-call emissions (no event when result is null)', async () => {
    const deps = makeDeps({
      analyzeArtDirection: jest.fn().mockResolvedValue(null),
      analyzeDesignTokens: jest.fn().mockResolvedValue(null),
      classifyRecipeFamily: jest.fn().mockResolvedValue(null),
    })
    const gen = runArtDirectionFanout({
      attachments: [img('brand')],
      provider: {}, buildTimings: [], deps,
    })
    const { events } = await drain(gen)
    const nonStatus = events.filter((e) => e.event !== 'status')
    expect(nonStatus).toEqual([]) // no art_direction/design_tokens/recipe_family events when results are null
  })
})
