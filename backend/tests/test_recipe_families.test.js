import {
  FAMILY_VARIANTS,
  FAMILY_IDS,
  FAMILY_DESCRIPTIONS,
  familyVariant,
} from '../../lib/ai/recipe-families.js'
import { parseFamily, classifyRecipeFamily } from '../../lib/ai/design-tokens.js'
import { formatRecipesForPrompt } from '../../lib/ai/recipes.js'

describe('FAMILY_VARIANTS structure', () => {
  test('every non-baseline family has navbar_glass and landing_page variants', () => {
    const families = FAMILY_IDS.filter((id) => id !== 'saas-clean')
    for (const fid of families) {
      expect(FAMILY_VARIANTS[fid]).toBeDefined()
      expect(FAMILY_VARIANTS[fid].navbar_glass).toBeDefined()
      expect(FAMILY_VARIANTS[fid].landing_page).toBeDefined()
    }
  })

  test('every variant preserves file path contract', () => {
    for (const fid of Object.keys(FAMILY_VARIANTS)) {
      expect(FAMILY_VARIANTS[fid].navbar_glass.file).toBe('components/Navbar.jsx')
      expect(FAMILY_VARIANTS[fid].landing_page.file).toBe('pages/Landing.jsx')
    }
  })

  test('every variant preserves test-id contract', () => {
    for (const fid of Object.keys(FAMILY_VARIANTS)) {
      expect(FAMILY_VARIANTS[fid].navbar_glass.code).toContain('data-testid="navbar"')
      expect(FAMILY_VARIANTS[fid].navbar_glass.code).toContain('data-testid="navbar-brand"')
      expect(FAMILY_VARIANTS[fid].navbar_glass.code).toContain('data-testid="navbar-signup"')
      expect(FAMILY_VARIANTS[fid].landing_page.code).toContain('data-testid="landing-page"')
      expect(FAMILY_VARIANTS[fid].landing_page.code).toContain('data-testid="hero-headline"')
      expect(FAMILY_VARIANTS[fid].landing_page.code).toContain('data-testid="hero-primary-cta"')
      expect(FAMILY_VARIANTS[fid].landing_page.code).toContain('data-testid="landing-features"')
    }
  })

  test('variants ALL use CSS variable colors only (no hardcoded Tailwind color classes)', () => {
    const banned = /\b(text|bg|border)-(white|black|violet|indigo|gray|slate|cyan|red|green|blue|amber|rose|emerald)\b/
    for (const fid of Object.keys(FAMILY_VARIANTS)) {
      for (const recipeId of Object.keys(FAMILY_VARIANTS[fid])) {
        const code = FAMILY_VARIANTS[fid][recipeId].code
        expect({ fid, recipeId, hasBanned: banned.test(code) }).toEqual({ fid, recipeId, hasBanned: false })
      }
    }
  })

  test('variants each render <Navbar> and <Footer> at the page level (not router)', () => {
    for (const fid of Object.keys(FAMILY_VARIANTS)) {
      const code = FAMILY_VARIANTS[fid].landing_page.code
      expect(code).toMatch(/<Navbar\s/)
      expect(code).toMatch(/<Footer\s/)
    }
  })
})

describe('familyVariant()', () => {
  test('returns null for baseline saas-clean', () => {
    expect(familyVariant('saas-clean', 'navbar_glass')).toBe(null)
  })

  test('returns null for unknown family', () => {
    expect(familyVariant('unicorn-mode', 'navbar_glass')).toBe(null)
  })

  test('returns null when recipe is not overridden', () => {
    expect(familyVariant('editorial-serif', 'settings_page')).toBe(null)
  })

  test('returns the variant when family + recipe both exist', () => {
    const v = familyVariant('editorial-serif', 'navbar_glass')
    expect(v).not.toBeNull()
    expect(v.file).toBe('components/Navbar.jsx')
  })
})

describe('formatRecipesForPrompt() — family swap', () => {
  test('uses baseline when no family passed', () => {
    const out = formatRecipesForPrompt(['navbar_glass'])
    expect(out).toContain('components/Navbar.jsx')
    // Baseline has the rounded glass backdrop blur
    expect(out).toMatch(/backdrop-blur/)
  })

  test('uses baseline when family="saas-clean"', () => {
    const out = formatRecipesForPrompt(['navbar_glass'], 'saas-clean')
    expect(out).toMatch(/backdrop-blur/)
  })

  test('swaps to editorial-serif variant when requested', () => {
    const out = formatRecipesForPrompt(['navbar_glass'], 'editorial-serif')
    expect(out).toContain('components/Navbar.jsx')
    // Editorial variant uses uppercase tracking-[0.2em] small-caps
    expect(out).toMatch(/uppercase tracking-\[0\.2em\]/)
    expect(out).not.toMatch(/backdrop-blur/)
  })

  test('swaps to brutalist-raw variant when requested', () => {
    const out = formatRecipesForPrompt(['landing_page'], 'brutalist-raw')
    expect(out).toMatch(/monospace/)
    expect(out).toMatch(/border-\[3px\]/)
  })

  test('swaps to luxury-minimal variant when requested', () => {
    const out = formatRecipesForPrompt(['landing_page'], 'luxury-minimal')
    expect(out).toMatch(/tracking-\[0\.4em\]/)
  })

  test('swaps to playful-illustrated variant when requested', () => {
    const out = formatRecipesForPrompt(['navbar_glass'], 'playful-illustrated')
    expect(out).toMatch(/rounded-full/)
  })

  test('non-overridden recipes still pull from baseline inside a family swap', () => {
    // Landing is overridden in editorial; settings_page is not — both emitted side by side.
    const out = formatRecipesForPrompt(['landing_page', 'settings_page'], 'editorial-serif')
    expect(out).toContain('pages/Landing.jsx')
    expect(out).toContain('pages/Settings.jsx')
  })
})

describe('parseFamily()', () => {
  test('returns null for bad input', () => {
    expect(parseFamily(null)).toBe(null)
    expect(parseFamily('{}')).toBe(null)
    expect(parseFamily('{"family":"unknown-id"}')).toBe(null)
    expect(parseFamily('not json')).toBe(null)
  })

  test('accepts a valid family choice', () => {
    const out = parseFamily('{"family":"editorial-serif","confidence":0.82,"reason":"clear serif typography"}')
    expect(out.family).toBe('editorial-serif')
    expect(out.confidence).toBeCloseTo(0.82)
    expect(out.reason).toBe('clear serif typography')
  })

  test('clamps/defaults invalid confidence', () => {
    const lo = parseFamily('{"family":"saas-clean","confidence":-1}')
    const hi = parseFamily('{"family":"saas-clean","confidence":17}')
    expect(lo.confidence).toBe(0.5)
    expect(hi.confidence).toBe(0.5)
  })

  test('truncates long reason strings', () => {
    const out = parseFamily(JSON.stringify({
      family: 'saas-clean',
      confidence: 0.5,
      reason: 'x'.repeat(500),
    }))
    expect(out.reason.length).toBe(200)
  })
})

describe('classifyRecipeFamily()', () => {
  test('returns null for empty attachments', async () => {
    expect(await classifyRecipeFamily([], {})).toBe(null)
    expect(await classifyRecipeFamily(null, {})).toBe(null)
  })

  test('calls provider with vision payload + json_object mode', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({
      family: 'luxury-minimal', confidence: 0.73, reason: 'generous whitespace + thin hairlines',
    }))
    const out = await classifyRecipeFamily(
      [{ type: 'image', data: 'AAAA', name: 'ref.png' }],
      { chat }
    )
    expect(chat).toHaveBeenCalled()
    const [messages, opts] = chat.mock.calls[0]
    expect(opts.response_format).toEqual({ type: 'json_object' })
    expect(messages[0].content).toContain('saas-clean')
    expect(messages[0].content).toContain('editorial-serif')
    expect(out.family).toBe('luxury-minimal')
  })

  test('returns null when provider fails', async () => {
    const provider = { chat: jest.fn().mockRejectedValue(new Error('rate limit')) }
    expect(await classifyRecipeFamily([{ type: 'image', data: 'A' }], provider)).toBe(null)
  })

  test('returns null when response is not a valid family id', async () => {
    const provider = { chat: jest.fn().mockResolvedValue('{"family":"fake"}') }
    expect(await classifyRecipeFamily([{ type: 'image', data: 'A' }], provider)).toBe(null)
  })
})

describe('FAMILY_DESCRIPTIONS', () => {
  test('every family id has a description', () => {
    for (const fid of FAMILY_IDS) {
      expect(FAMILY_DESCRIPTIONS[fid]).toBeDefined()
      expect(FAMILY_DESCRIPTIONS[fid].length).toBeGreaterThan(40)
    }
  })
})
