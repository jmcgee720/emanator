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
