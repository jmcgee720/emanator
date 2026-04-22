/**
 * Tests for the extracted deterministic-file emitters (refactored Feb 2026).
 * Asserts that theme.js + assets.js + VFS map + primitives are emitted in
 * the right order with the right side effects, fault-tolerant on every
 * individual failure.
 */

import { emitDeterministicFiles } from '../../lib/ai/pipeline/deterministic-files.js'

async function drain(gen) {
  const events = []
  while (true) {
    const next = await gen.next()
    if (next.done) break
    events.push(next.value)
  }
  return events
}

function mockAi() {
  const saved = []
  return {
    saveFiles: jest.fn().mockImplementation(async (pid, files) => {
      saved.push(...files)
      return files
    }),
    _saved: saved,
  }
}

function makeDeps(overrides = {}) {
  return {
    buildThemeFile: jest.fn().mockReturnValue('export const DESIGN_TOKENS = {}'),
    buildAssetsFileContent: jest.fn().mockReturnValue('export const LOGO_URL = "x"'),
    buildBrandVfsMap: jest.fn().mockReturnValue([]),
    buildPrimitiveFiles: jest.fn().mockReturnValue([]),
    buildStripeFiles: jest.fn().mockReturnValue([]),
    needsCommerceTemplates: jest.fn().mockReturnValue(false),
    ...overrides,
  }
}

describe('emitDeterministicFiles — theme emission (Step 3a)', () => {
  it('always emits theme.js (even when imageAssets is empty)', async () => {
    const ai = mockAi()
    const deps = makeDeps()
    await drain(emitDeterministicFiles({
      plan: { designTokens: { vibe: 'editorial' } },
      imageAssets: [],
      projectId: 'p1',
      aiService: ai,
      deps,
    }))
    expect(deps.buildThemeFile).toHaveBeenCalledTimes(1)
    const themeFiles = ai._saved.filter((f) => f.path === 'components/theme.js')
    expect(themeFiles).toHaveLength(1)
  })

  it('swallows buildThemeFile errors without aborting the rest', async () => {
    const ai = mockAi()
    const deps = makeDeps({
      buildThemeFile: jest.fn().mockImplementation(() => { throw new Error('theme boom') }),
    })
    await drain(emitDeterministicFiles({
      plan: { designTokens: {} },
      imageAssets: [{ role: 'logo', name: 'logo.png', dataUrl: 'data:image/png;base64,x' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    // assets.js should still have been saved despite the theme.js failure
    const paths = ai._saved.map((f) => f.path)
    expect(paths).toContain('components/assets.js')
  })
})

describe('emitDeterministicFiles — assets + VFS emission (Step 3b)', () => {
  it('skips assets.js when imageAssets is empty', async () => {
    const ai = mockAi()
    const deps = makeDeps()
    const events = await drain(emitDeterministicFiles({
      plan: { designTokens: {} },
      imageAssets: [],
      projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildAssetsFileContent).not.toHaveBeenCalled()
    expect(ai._saved.map((f) => f.path)).not.toContain('components/assets.js')
    expect(events.filter((e) => e.event === 'generated_images_map')).toHaveLength(0)
  })

  it('emits assets.js when imageAssets has entries', async () => {
    const ai = mockAi()
    const deps = makeDeps()
    await drain(emitDeterministicFiles({
      plan: { designTokens: {} },
      imageAssets: [{ role: 'logo', name: 'l.png' }, { role: 'hero', name: 'h.png' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildAssetsFileContent).toHaveBeenCalledTimes(1)
    expect(ai._saved.find((f) => f.path === 'components/assets.js')).toBeDefined()
  })

  it('yields generated_images_map SSE event when VFS map is non-empty', async () => {
    const ai = mockAi()
    const vfs = [{ placeholder: '/logo.png', dataUrl: 'data:image/png;base64,x' }]
    const deps = makeDeps({ buildBrandVfsMap: jest.fn().mockReturnValue(vfs) })
    const events = await drain(emitDeterministicFiles({
      plan: { designTokens: {} },
      imageAssets: [{ role: 'logo' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    const vfsEvent = events.find((e) => e.event === 'generated_images_map')
    expect(vfsEvent).toBeDefined()
    expect(vfsEvent.data.source).toBe('brand_vfs')
    expect(vfsEvent.data.images).toEqual(vfs)
  })

  it('no SSE event when VFS map is empty', async () => {
    const ai = mockAi()
    const deps = makeDeps({ buildBrandVfsMap: jest.fn().mockReturnValue([]) })
    const events = await drain(emitDeterministicFiles({
      plan: { designTokens: {} },
      imageAssets: [{ role: 'logo' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    expect(events.filter((e) => e.event === 'generated_images_map')).toHaveLength(0)
  })

  it('assets.js failure does not abort primitives emit', async () => {
    const ai = mockAi()
    const primitives = [{ path: 'components/primitives/Hero.jsx', content: 'hero' }]
    const deps = makeDeps({
      buildAssetsFileContent: jest.fn().mockImplementation(() => { throw new Error('assets fail') }),
      buildPrimitiveFiles: jest.fn().mockReturnValue(primitives),
    })
    await drain(emitDeterministicFiles({
      plan: { designTokens: {}, layoutBlueprint: { hero_composition: 'x' }, brand: { name: 'b' } },
      imageAssets: [{ role: 'logo' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    expect(ai._saved.find((f) => f.path === 'components/primitives/Hero.jsx')).toBeDefined()
  })
})

describe('emitDeterministicFiles — primitives emission (Step 3c)', () => {
  it('skips primitives when layoutBlueprint is missing', async () => {
    const ai = mockAi()
    const deps = makeDeps()
    const plan = { designTokens: {} }
    await drain(emitDeterministicFiles({
      plan, imageAssets: [], projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildPrimitiveFiles).not.toHaveBeenCalled()
    expect(plan.primitivesEmitted).toBeUndefined()
  })

  it('emits primitives and records paths on plan.primitivesEmitted', async () => {
    const ai = mockAi()
    const primitives = [
      { path: 'components/primitives/Hero.jsx', content: 'hero' },
      { path: 'components/primitives/FeatureGrid.jsx', content: 'fg' },
    ]
    const deps = makeDeps({ buildPrimitiveFiles: jest.fn().mockReturnValue(primitives) })
    const plan = { designTokens: {}, layoutBlueprint: { hero_composition: 'split-50-50' }, brand: { name: 'acme' } }
    await drain(emitDeterministicFiles({
      plan, imageAssets: [], projectId: 'p1', aiService: ai, deps,
    }))
    expect(plan.primitivesEmitted).toEqual(['components/primitives/Hero.jsx', 'components/primitives/FeatureGrid.jsx'])
  })

  it('passes hasHeroAsset=true when imageAssets has a hero/photo role', async () => {
    const ai = mockAi()
    const deps = makeDeps({ buildPrimitiveFiles: jest.fn().mockReturnValue([]) })
    await drain(emitDeterministicFiles({
      plan: { designTokens: {}, layoutBlueprint: {}, brand: {} },
      imageAssets: [{ role: 'hero' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildPrimitiveFiles).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ hasHeroAsset: true }),
    )
  })

  it('passes hasHeroAsset=false when only logo is uploaded', async () => {
    const ai = mockAi()
    const deps = makeDeps({ buildPrimitiveFiles: jest.fn().mockReturnValue([]) })
    await drain(emitDeterministicFiles({
      plan: { designTokens: {}, layoutBlueprint: {}, brand: {} },
      imageAssets: [{ role: 'logo' }],
      projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildPrimitiveFiles).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ hasHeroAsset: false }),
    )
  })

  it('zero primitive files → no plan.primitivesEmitted update, no saveFiles call', async () => {
    const ai = mockAi()
    const deps = makeDeps({ buildPrimitiveFiles: jest.fn().mockReturnValue([]) })
    const plan = { designTokens: {}, layoutBlueprint: {}, brand: {} }
    await drain(emitDeterministicFiles({
      plan, imageAssets: [], projectId: 'p1', aiService: ai, deps,
    }))
    expect(plan.primitivesEmitted).toBeUndefined()
    expect(ai._saved.find((f) => f.path?.startsWith('components/primitives/'))).toBeUndefined()
  })

  it('primitives failure does not throw', async () => {
    const ai = mockAi()
    const deps = makeDeps({
      buildPrimitiveFiles: jest.fn().mockImplementation(() => { throw new Error('fail') }),
    })
    await expect(drain(emitDeterministicFiles({
      plan: { designTokens: {}, layoutBlueprint: {}, brand: {} },
      imageAssets: [],
      projectId: 'p1', aiService: ai, deps,
    }))).resolves.not.toThrow()
  })
})

describe('emitDeterministicFiles — commerce templates (Step 3d)', () => {
  it('skips Stripe templates when needsCommerceTemplates returns false', async () => {
    const ai = mockAi()
    const deps = makeDeps({
      needsCommerceTemplates: jest.fn().mockReturnValue(false),
    })
    const plan = { designTokens: {}, archetype: { id: 'blog' } }
    await drain(emitDeterministicFiles({
      plan, imageAssets: [], projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildStripeFiles).not.toHaveBeenCalled()
    expect(plan.commerceEmitted).toBeUndefined()
  })

  it('emits Stripe files when needsCommerceTemplates returns true', async () => {
    const ai = mockAi()
    const stripeFiles = [
      { path: 'app/api/checkout/route.js', content: 'x' },
      { path: 'lib/pricing-packages.js', content: 'x' },
    ]
    const deps = makeDeps({
      needsCommerceTemplates: jest.fn().mockReturnValue(true),
      buildStripeFiles: jest.fn().mockReturnValue(stripeFiles),
    })
    const plan = { designTokens: {}, archetype: { id: 'ecommerce' }, brief: { summary: 'stripe checkout' } }
    await drain(emitDeterministicFiles({
      plan, imageAssets: [], projectId: 'p1', aiService: ai, deps,
    }))
    expect(deps.buildStripeFiles).toHaveBeenCalledWith(plan)
    expect(plan.commerceEmitted).toEqual(['app/api/checkout/route.js', 'lib/pricing-packages.js'])
    const saved = ai._saved.map((f) => f.path)
    expect(saved).toContain('app/api/checkout/route.js')
    expect(saved).toContain('lib/pricing-packages.js')
  })

  it('Stripe files failure does not abort (non-fatal)', async () => {
    const ai = mockAi()
    const deps = makeDeps({
      needsCommerceTemplates: jest.fn().mockReturnValue(true),
      buildStripeFiles: jest.fn().mockImplementation(() => { throw new Error('boom') }),
    })
    await expect(drain(emitDeterministicFiles({
      plan: { designTokens: {} }, imageAssets: [], projectId: 'p1', aiService: ai, deps,
    }))).resolves.not.toThrow()
  })
})

describe('emitDeterministicFiles — composition', () => {
  it('full happy path: theme + assets + VFS + primitives all emit', async () => {    const ai = mockAi()
    const primitives = [{ path: 'components/primitives/Hero.jsx', content: 'h' }]
    const deps = makeDeps({
      buildBrandVfsMap: jest.fn().mockReturnValue([{ placeholder: '/logo.png', dataUrl: 'data:...' }]),
      buildPrimitiveFiles: jest.fn().mockReturnValue(primitives),
    })
    const plan = { designTokens: { vibe: 'luxury' }, layoutBlueprint: { hero_composition: 'split-50-50' }, brand: { name: 'acme' } }
    const events = await drain(emitDeterministicFiles({
      plan, imageAssets: [{ role: 'logo' }], projectId: 'p1', aiService: ai, deps,
    }))

    const paths = ai._saved.map((f) => f.path)
    expect(paths).toContain('components/theme.js')
    expect(paths).toContain('components/assets.js')
    expect(paths).toContain('components/primitives/Hero.jsx')
    expect(events.find((e) => e.event === 'generated_images_map')).toBeDefined()
    expect(plan.primitivesEmitted).toEqual(['components/primitives/Hero.jsx'])
  })
})
