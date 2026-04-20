/**
 * Design-tokens module tests.
 * Verifies:
 *  - parseTokens() validation (accepts essential palette; merges defaults)
 *  - buildThemeFile() produces valid JS that exports DESIGN_TOKENS/cssVars/ThemeProvider
 *  - formatTokensForPrompt() produces useful builder context
 *  - analyzeDesignTokens() calls the provider with vision payload + json mode
 */

import {
  FALLBACK_TOKENS,
  parseTokens,
  buildThemeFile,
  formatTokensForPrompt,
  analyzeDesignTokens,
  parseBlueprint,
  formatBlueprintForPrompt,
  analyzeLayoutBlueprint,
  primaryFontName,
  buildGoogleFontsHref,
  GOOGLE_FONTS_ALLOWLIST,
} from '../../lib/ai/design-tokens.js'

describe('parseTokens', () => {
  test('returns null for empty/bad input', () => {
    expect(parseTokens(null)).toBe(null)
    expect(parseTokens('')).toBe(null)
    expect(parseTokens('not json')).toBe(null)
    expect(parseTokens('{}')).toBe(null)
  })

  test('accepts a fully-populated JSON string', () => {
    const input = JSON.stringify({
      bg: '#FAF7F2', ink: '#2D1810', primary: '#8B4513',
      surface: '#FFFFFF', surface2: '#F5EFE6', border: 'rgba(45,24,16,0.12)',
      inkMuted: 'rgba(45,24,16,0.65)', primaryInk: '#FFFFFF', accent: '#D4A574',
      radius: '0.25rem', radiusLg: '0.5rem',
      fontDisplay: '"Playfair Display", serif',
      fontBody: '"Inter", sans-serif',
      mode: 'light', vibe: 'editorial-minimal',
      avoid: ['no purple', 'no glass blur'],
    })
    const out = parseTokens(input)
    expect(out).not.toBeNull()
    expect(out.primary).toBe('#8B4513')
    expect(out.mode).toBe('light')
    expect(out.vibe).toBe('editorial-minimal')
    expect(out.avoid).toEqual(['no purple', 'no glass blur'])
  })

  test('accepts an object directly (not a string)', () => {
    const out = parseTokens({ bg: '#fff', ink: '#000', primary: '#f00' })
    expect(out).not.toBeNull()
    expect(out.primary).toBe('#f00')
  })

  test('rejects when essential keys (bg/ink/primary) missing', () => {
    expect(parseTokens('{"bg":"#fff"}')).toBe(null)
    expect(parseTokens(JSON.stringify({ bg: '#fff', ink: '#000' }))).toBe(null)
  })

  test('merges fallback for missing non-essential keys', () => {
    const out = parseTokens(JSON.stringify({ bg: '#111', ink: '#fff', primary: '#f0f' }))
    expect(out.surface).toBe(FALLBACK_TOKENS.surface)
    expect(out.radius).toBe(FALLBACK_TOKENS.radius)
    expect(out.fontBody).toBe(FALLBACK_TOKENS.fontBody)
  })

  test('coerces invalid mode to "dark"', () => {
    const out = parseTokens(JSON.stringify({ bg: '#111', ink: '#fff', primary: '#f00', mode: 'sepia' }))
    expect(out.mode).toBe('dark')
  })

  test('caps avoid list at 6 entries and drops non-strings', () => {
    const avoid = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 42, null]
    const out = parseTokens(JSON.stringify({ bg: '#111', ink: '#fff', primary: '#f00', avoid }))
    expect(out.avoid).toHaveLength(6)
    expect(out.avoid.every((x) => typeof x === 'string')).toBe(true)
  })
})

describe('buildThemeFile', () => {
  const tokens = {
    bg: '#FAF7F2', surface: '#FFFFFF', surface2: '#F5EFE6', border: 'rgba(45,24,16,0.12)',
    ink: '#2D1810', inkMuted: 'rgba(45,24,16,0.65)',
    primary: '#8B4513', primaryInk: '#FFFFFF', accent: '#D4A574',
    radius: '0.25rem', radiusLg: '0.5rem',
    fontDisplay: '"Playfair Display", serif',
    fontBody: '"Inter", sans-serif',
    mode: 'light', vibe: 'editorial-minimal',
    avoid: [],
  }

  test('emits DESIGN_TOKENS, cssVars, and ThemeProvider exports', () => {
    const out = buildThemeFile(tokens)
    expect(out).toContain('export const DESIGN_TOKENS')
    expect(out).toContain('export const cssVars')
    expect(out).toContain('export function ThemeProvider')
    expect(out).toContain('export default ThemeProvider')
  })

  test('inlines the user\'s palette values', () => {
    const out = buildThemeFile(tokens)
    expect(out).toContain('#FAF7F2')
    expect(out).toContain('#8B4513')
    expect(out).toContain('Playfair Display')
  })

  test('merges FALLBACK_TOKENS for missing keys so the file is always valid', () => {
    const out = buildThemeFile({ bg: '#111' })
    expect(out).toContain('#111')
    expect(out).toContain(FALLBACK_TOKENS.primary)
  })

  test('escapes backticks in font family strings', () => {
    const t = { ...tokens, fontDisplay: '"Bad`Font", serif' }
    const out = buildThemeFile(t)
    expect(out).toContain('Bad\\`Font')
    // The DESIGN_TOKENS / cssVars blocks must still evaluate as plain JS.
    const jsOnly = out.split('export function ThemeProvider')[0]
      .replace(/export default ThemeProvider/g, '')
      .replace(/export /g, '')
    expect(() => new Function(jsOnly + '\nreturn DESIGN_TOKENS')).not.toThrow()
  })

  test('sets CSS custom properties via `--var` naming', () => {
    const out = buildThemeFile(tokens)
    expect(out).toContain("'--bg'")
    expect(out).toContain("'--primary'")
    expect(out).toContain("'--ink-muted'")
    expect(out).toContain("'--font-display'")
    expect(out).toContain("'--radius'")
  })

  test('ThemeProvider applies tokens as style + sets data-theme attr', () => {
    const out = buildThemeFile(tokens)
    expect(out).toMatch(/data-theme=\{DESIGN_TOKENS\.mode\}/)
    expect(out).toMatch(/data-vibe=\{DESIGN_TOKENS\.vibe\}/)
    expect(out).toContain('...cssVars')
  })

  test('null input returns a valid fallback theme file', () => {
    const out = buildThemeFile(null)
    expect(out).toContain('export const DESIGN_TOKENS')
    expect(out).toContain(FALLBACK_TOKENS.primary)
  })
})

describe('formatTokensForPrompt', () => {
  test('lists the palette + vibe for builder grounding', () => {
    const text = formatTokensForPrompt({
      bg: '#0a0a0a', ink: '#fff', primary: '#ff5a4e', primaryInk: '#000',
      surface: '#111', surface2: '#1a1a1a', border: 'rgba(255,255,255,0.1)',
      inkMuted: 'rgba(255,255,255,0.6)', accent: '#ffcc00',
      radius: '0.5rem', radiusLg: '1rem',
      fontDisplay: '"GT Sectra", serif', fontBody: '"Inter", sans-serif',
      mode: 'dark', vibe: 'editorial-dark',
      avoid: ['no glass blur', 'no gradients'],
    })
    expect(text).toContain('editorial-dark')
    expect(text).toContain('#ff5a4e')
    expect(text).toContain('GT Sectra')
    expect(text).toContain('no glass blur')
    expect(text).toContain('no gradients')
  })

  test('defaults to "avoid violet/indigo/cyan" when no explicit avoid list', () => {
    const text = formatTokensForPrompt(FALLBACK_TOKENS)
    expect(text).toMatch(/AVOID: generic violet\/indigo\/cyan/)
  })
})

describe('analyzeDesignTokens', () => {
  test('returns null for empty attachments', async () => {
    expect(await analyzeDesignTokens([], {})).toBe(null)
    expect(await analyzeDesignTokens(null, {})).toBe(null)
  })

  test('returns null when no images actually have data', async () => {
    expect(await analyzeDesignTokens([{ type: 'image' }], { chat: jest.fn() })).toBe(null)
  })

  test('calls provider with vision image payload + json response_format', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({
      bg: '#111', ink: '#eee', primary: '#f00',
    }))
    const provider = { chat }
    const result = await analyzeDesignTokens(
      [{ type: 'image', data: 'AAAA', name: 'ref.png' }],
      provider
    )
    expect(chat).toHaveBeenCalled()
    const [messages, opts] = chat.mock.calls[0]
    expect(messages[0].role).toBe('system')
    const userContent = messages[1].content
    expect(Array.isArray(userContent)).toBe(true)
    expect(userContent.some((c) => c.type === 'image_url')).toBe(true)
    expect(opts.response_format).toEqual({ type: 'json_object' })
    expect(result.primary).toBe('#f00')
  })

  test('returns null when provider throws (non-blocking on failure)', async () => {
    const provider = { chat: jest.fn().mockRejectedValue(new Error('rate limit')) }
    const result = await analyzeDesignTokens(
      [{ type: 'image', data: 'AAAA' }],
      provider
    )
    expect(result).toBe(null)
  })

  test('returns null when the provider response is not valid JSON', async () => {
    const provider = { chat: jest.fn().mockResolvedValue('I am not JSON.') }
    const result = await analyzeDesignTokens(
      [{ type: 'image', data: 'AAAA' }],
      provider
    )
    expect(result).toBe(null)
  })

  test('caps at 4 reference images in the vision payload', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({ bg: '#111', ink: '#eee', primary: '#f00' }))
    const provider = { chat }
    await analyzeDesignTokens(
      [
        { type: 'image', data: 'a' },
        { type: 'image', data: 'b' },
        { type: 'image', data: 'c' },
        { type: 'image', data: 'd' },
        { type: 'image', data: 'e' },
        { type: 'image', data: 'f' },
      ],
      provider
    )
    const [messages] = chat.mock.calls[0]
    const userContent = messages[1].content
    const imageCount = userContent.filter((c) => c.type === 'image_url').length
    expect(imageCount).toBe(4)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Layout blueprint — structural-reference extraction.
// ──────────────────────────────────────────────────────────────────────
describe('parseBlueprint', () => {
  test('returns null for missing sections_order', () => {
    expect(parseBlueprint(null)).toBe(null)
    expect(parseBlueprint('{}')).toBe(null)
    expect(parseBlueprint('{"hero_composition":"split-50-50"}')).toBe(null)
  })

  test('accepts a fully-populated blueprint', () => {
    const input = JSON.stringify({
      sections_order: ['hero', 'features-grid', 'pricing', 'faq'],
      hero_composition: 'full-bleed-image',
      hero_text_alignment: 'left',
      navbar_style: 'minimal-left-brand',
      feature_columns: 3,
      feature_card_style: 'hairline-outlined',
      pricing_pattern: 'three-column',
      spacing_rhythm: 'generous',
      noticeable_patterns: ['floating hero screenshot', 'dark CTAs'],
    })
    const out = parseBlueprint(input)
    expect(out.sections_order).toEqual(['hero', 'features-grid', 'pricing', 'faq'])
    expect(out.hero_composition).toBe('full-bleed-image')
    expect(out.feature_columns).toBe(3)
    expect(out.noticeable_patterns).toHaveLength(2)
  })

  test('coerces invalid enumerated values to safe defaults', () => {
    const input = JSON.stringify({
      sections_order: ['hero'],
      hero_composition: 'magical-floating-3d',
      feature_columns: 17,
      pricing_pattern: 'random-value',
    })
    const out = parseBlueprint(input)
    expect(out.hero_composition).toBe('split-50-50')
    expect(out.feature_columns).toBe(3)
    expect(out.pricing_pattern).toBe('three-column')
  })

  test('caps sections_order at 8 entries', () => {
    const input = JSON.stringify({
      sections_order: Array(12).fill('hero').map((s, i) => `${s}-${i}`),
    })
    const out = parseBlueprint(input)
    expect(out.sections_order).toHaveLength(8)
  })

  test('caps noticeable_patterns at 6 entries', () => {
    const input = JSON.stringify({
      sections_order: ['hero'],
      noticeable_patterns: Array(10).fill('observation'),
    })
    const out = parseBlueprint(input)
    expect(out.noticeable_patterns).toHaveLength(6)
  })

  test('rejects non-JSON', () => {
    expect(parseBlueprint('not json')).toBe(null)
  })
})

describe('formatBlueprintForPrompt', () => {
  test('renders section order arrow-joined + patterns bulleted', () => {
    const text = formatBlueprintForPrompt({
      sections_order: ['hero', 'features', 'pricing'],
      hero_composition: 'split-50-50',
      hero_text_alignment: 'left',
      navbar_style: 'minimal-left-brand',
      feature_columns: 3,
      feature_card_style: 'filled-surface',
      pricing_pattern: 'three-column',
      spacing_rhythm: 'generous',
      noticeable_patterns: ['dark hero background'],
    })
    expect(text).toContain('hero → features → pricing')
    expect(text).toContain('• dark hero background')
    expect(text).toContain('YOUR COMPOSITION MUST MATCH')
  })

  test('returns empty string for null input', () => {
    expect(formatBlueprintForPrompt(null)).toBe('')
  })
})

describe('analyzeLayoutBlueprint', () => {
  test('returns null for empty input', async () => {
    expect(await analyzeLayoutBlueprint([], {})).toBe(null)
    expect(await analyzeLayoutBlueprint(null, {})).toBe(null)
  })

  test('calls provider with vision payload + json mode', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({
      sections_order: ['hero', 'features', 'pricing'],
      hero_composition: 'split-50-50',
    }))
    const out = await analyzeLayoutBlueprint(
      [{ type: 'image', data: 'AAAA', name: 'ref.png' }],
      { chat }
    )
    expect(chat).toHaveBeenCalled()
    const [messages, opts] = chat.mock.calls[0]
    expect(opts.response_format).toEqual({ type: 'json_object' })
    const userContent = messages[1].content
    expect(userContent.some((c) => c.type === 'image_url')).toBe(true)
    expect(out.sections_order).toEqual(['hero', 'features', 'pricing'])
  })

  test('inlines user placement notes in the prompt', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({
      sections_order: ['hero'],
    }))
    await analyzeLayoutBlueprint(
      [{ type: 'image', data: 'AAAA', name: 'ref.png', note: 'copy the exact pricing strip' }],
      { chat }
    )
    const [messages] = chat.mock.calls[0]
    const text = messages[1].content.find((c) => c.type === 'text').text
    expect(text).toContain('copy the exact pricing strip')
  })

  test('returns null when provider throws', async () => {
    const chat = jest.fn().mockRejectedValue(new Error('rate limit'))
    expect(await analyzeLayoutBlueprint([{ type: 'image', data: 'A' }], { chat })).toBe(null)
  })

  test('returns null when response is not valid JSON', async () => {
    const chat = jest.fn().mockResolvedValue('oops')
    expect(await analyzeLayoutBlueprint([{ type: 'image', data: 'A' }], { chat })).toBe(null)
  })

  test('caps at 4 images', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({ sections_order: ['hero'] }))
    await analyzeLayoutBlueprint(
      [
        { type: 'image', data: 'a' },
        { type: 'image', data: 'b' },
        { type: 'image', data: 'c' },
        { type: 'image', data: 'd' },
        { type: 'image', data: 'e' },
      ],
      { chat }
    )
    const imgs = chat.mock.calls[0][0][1].content.filter((c) => c.type === 'image_url')
    expect(imgs).toHaveLength(4)
  })
})

describe('Google Fonts loader (Session 31)', () => {
  describe('primaryFontName', () => {
    test('extracts name from quoted first family', () => {
      expect(primaryFontName('"Playfair Display", Georgia, serif')).toBe('Playfair Display')
      expect(primaryFontName("'Inter', system-ui, sans-serif")).toBe('Inter')
    })
    test('returns null for system/generic stacks', () => {
      expect(primaryFontName('sans-serif')).toBeNull()
      expect(primaryFontName('system-ui, -apple-system')).toBeNull()
      expect(primaryFontName('serif')).toBeNull()
      expect(primaryFontName('monospace')).toBeNull()
    })
    test('returns null for missing/bad input', () => {
      expect(primaryFontName(null)).toBeNull()
      expect(primaryFontName('')).toBeNull()
      expect(primaryFontName(undefined)).toBeNull()
    })
    test('handles unquoted first family', () => {
      expect(primaryFontName('Inter, sans-serif')).toBe('Inter')
    })
  })

  describe('buildGoogleFontsHref', () => {
    test('returns empty string when both fonts are system stacks', () => {
      expect(buildGoogleFontsHref({ fontDisplay: 'system-ui', fontBody: 'sans-serif' })).toBe('')
    })
    test('returns empty string when fonts are not on allowlist (prevents 404s)', () => {
      expect(buildGoogleFontsHref({
        fontDisplay: '"Custom Internal Font", sans-serif',
        fontBody: '"Another Private", sans-serif',
      })).toBe('')
    })
    test('emits css2 URL with display=swap for allowlisted display font', () => {
      const href = buildGoogleFontsHref({ fontDisplay: '"Playfair Display", Georgia, serif', fontBody: 'system-ui' })
      expect(href).toContain('https://fonts.googleapis.com/css2?')
      expect(href).toContain('family=Playfair%20Display')
      expect(href).toContain('display=swap')
    })
    test('combines both fonts into a single href when both on allowlist', () => {
      const href = buildGoogleFontsHref({
        fontDisplay: '"Playfair Display", serif',
        fontBody: '"Inter", sans-serif',
      })
      expect(href).toContain('family=Playfair%20Display')
      expect(href).toContain('family=Inter')
      expect(href.match(/family=/g)).toHaveLength(2)
    })
    test('dedupes when display and body are the same font', () => {
      const href = buildGoogleFontsHref({ fontDisplay: '"Inter", sans-serif', fontBody: '"Inter", sans-serif' })
      expect(href.match(/family=/g)).toHaveLength(1)
    })
    test('returns empty for null/missing tokens', () => {
      expect(buildGoogleFontsHref(null)).toBe('')
      expect(buildGoogleFontsHref(undefined)).toBe('')
      expect(buildGoogleFontsHref({})).toBe('')
    })
    test('requests the common weight range (400..800)', () => {
      const href = buildGoogleFontsHref({ fontDisplay: '"Inter", sans-serif' })
      expect(href).toContain('wght@400;500;600;700;800')
    })
  })

  describe('GOOGLE_FONTS_ALLOWLIST', () => {
    test('includes common editorial + SaaS families', () => {
      expect(GOOGLE_FONTS_ALLOWLIST).toContain('Inter')
      expect(GOOGLE_FONTS_ALLOWLIST).toContain('Playfair Display')
      expect(GOOGLE_FONTS_ALLOWLIST).toContain('Fraunces')
      expect(GOOGLE_FONTS_ALLOWLIST).toContain('JetBrains Mono')
    })
  })

  describe('buildThemeFile integration', () => {
    test('emits GOOGLE_FONTS_HREF export with the resolved URL', () => {
      const out = buildThemeFile({
        fontDisplay: '"Playfair Display", serif',
        fontBody: '"Inter", sans-serif',
        bg: '#fff', ink: '#000', primary: '#000',
      })
      expect(out).toContain('export const GOOGLE_FONTS_HREF = `https://fonts.googleapis.com/css2?')
      expect(out).toContain('ensureGoogleFonts')
      expect(out).toContain('data-emanator-fonts')
    })
    test('emits empty GOOGLE_FONTS_HREF when no allowlisted fonts', () => {
      const out = buildThemeFile({
        fontDisplay: 'system-ui', fontBody: 'system-ui',
        bg: '#fff', ink: '#000', primary: '#000',
      })
      expect(out).toContain('export const GOOGLE_FONTS_HREF = ``')
    })
    test('ensureGoogleFonts guard is SSR-safe and idempotent', () => {
      const out = buildThemeFile({
        fontDisplay: '"Inter", sans-serif', bg: '#fff', ink: '#000', primary: '#000',
      })
      // SSR guard
      expect(out).toContain("typeof document === 'undefined'")
      // Idempotency probe — checks for a pre-existing link tag
      expect(out).toContain('data-emanator-fonts="1"')
    })
  })
})
