/**
 * Unit tests for Session 30 (6/7) — primitives.js.
 *
 * Coverage:
 *  - HERO_LAYOUTS / FEATURE_CARD_STYLES are immutable allowlists
 *  - buildHeroPrimitive generates valid JSX for each layout + alignment
 *  - buildFeatureGridPrimitive respects columns + card style
 *  - resolvePrimitivesFromBlueprint picks safe defaults for malformed input
 *  - buildPrimitiveFiles emits correct paths + content
 *  - formatPrimitivesForPrompt renders a compact builder-prompt block
 */

import {
  HERO_LAYOUTS,
  FEATURE_CARD_STYLES,
  buildHeroPrimitive,
  buildFeatureGridPrimitive,
  resolvePrimitivesFromBlueprint,
  buildPrimitiveFiles,
  formatPrimitivesForPrompt,
} from '../../lib/ai/primitives.js'

describe('HERO_LAYOUTS / FEATURE_CARD_STYLES', () => {
  test('HERO_LAYOUTS contains the 4 blueprint-aligned values', () => {
    expect(HERO_LAYOUTS).toEqual(expect.arrayContaining([
      'split-50-50', 'full-bleed-image', 'centered-text', 'stacked-image-below',
    ]))
  })
  test('FEATURE_CARD_STYLES contains 4 blueprint-aligned values', () => {
    expect(FEATURE_CARD_STYLES).toEqual(expect.arrayContaining([
      'hairline-outlined', 'filled-surface', 'no-border', 'shadowed-card',
    ]))
  })
  test('both are frozen/immutable', () => {
    expect(Object.isFrozen(HERO_LAYOUTS)).toBe(true)
    expect(Object.isFrozen(FEATURE_CARD_STYLES)).toBe(true)
  })
})

describe('buildHeroPrimitive', () => {
  const brand = { name: 'Acme', tagline: 'Ship faster', description: 'we help teams move quicker', audience: 'devs' }

  test('emits a valid Hero component for split-50-50 (default)', () => {
    const out = buildHeroPrimitive('split-50-50', brand, { hasHeroAsset: false })
    expect(out).toContain("export default function Hero()")
    expect(out).toContain('data-testid="hero-section"')
    expect(out).toContain('data-testid="hero-text-block"')
    expect(out).toContain('data-testid="hero-primary-cta"')
    expect(out).toContain('data-testid="hero-secondary-cta"')
    expect(out).toContain('Ship faster')
    expect(out).toContain('grid-cols-1 lg:grid-cols-2')
  })

  test('full-bleed-image layout includes absolute-positioned image', () => {
    const out = buildHeroPrimitive('full-bleed-image', brand, { hasHeroAsset: true })
    expect(out).toContain('absolute inset-0')
    expect(out).toContain("import { HERO_URL, PHOTO_0 } from '../assets'")
    expect(out).toContain('HERO_URL || PHOTO_0')
  })

  test('centered-text layout uses max-w-3xl + text-center', () => {
    const out = buildHeroPrimitive('centered-text', brand, { hasHeroAsset: false })
    expect(out).toContain('max-w-3xl text-center')
    // Without hero asset it should not try to render one
    expect(out).not.toContain('HERO_URL || PHOTO_0')
  })

  test('stacked-image-below layout renders text first then image', () => {
    const out = buildHeroPrimitive('stacked-image-below', brand, { hasHeroAsset: true })
    expect(out).toContain('mt-12 w-full rounded-[var(--radius-lg)]')
  })

  test('falls back to split-50-50 for unknown layout', () => {
    const out = buildHeroPrimitive('not-a-real-layout', brand, { hasHeroAsset: false })
    expect(out).toContain('grid-cols-1 lg:grid-cols-2')
    expect(out).toContain('Layout: split-50-50')
  })

  test('text alignment flows into style prop and class toggles', () => {
    const right = buildHeroPrimitive('split-50-50', brand, { hasHeroAsset: false, textAlignment: 'right' })
    expect(right).toContain("textAlign: 'right'")
    const center = buildHeroPrimitive('stacked-image-below', brand, { hasHeroAsset: false, textAlignment: 'center' })
    expect(center).toContain("textAlign: 'center'")
    expect(center).toContain('justify-center')
  })

  test('imports LOGO/HERO only when hasHeroAsset=true', () => {
    const without = buildHeroPrimitive('split-50-50', brand, { hasHeroAsset: false })
    const withIt = buildHeroPrimitive('split-50-50', brand, { hasHeroAsset: true })
    expect(without).not.toContain("import { HERO_URL")
    expect(withIt).toContain("import { HERO_URL, PHOTO_0 } from '../assets'")
  })

  test('always references theme CSS variables (no hardcoded colors)', () => {
    const out = buildHeroPrimitive('split-50-50', brand, { hasHeroAsset: false })
    expect(out).toContain('bg-[var(--primary)]')
    expect(out).toContain('text-[var(--ink)]')
    expect(out).toContain('border-[var(--border)]')
    expect(out).not.toMatch(/bg-violet-|bg-indigo-|text-white|bg-white\b/)
  })

  test('escapes backticks and $ in brand copy to prevent template-literal break', () => {
    // Use hasHeroAsset=true so brand.name lands in the alt attribute
    const out = buildHeroPrimitive('split-50-50', { name: 'Acme`Co', tagline: '${bad}', description: 'ok' }, { hasHeroAsset: true })
    // The `Acme` text survives despite the backtick in the middle being escaped
    expect(out).toContain('Acme')
    // The raw `${bad}` would break the template if not escaped — $ is escaped to \$
    expect(out).toContain('\\$')
    // Backtick escaped (prefixed with backslash in output)
    expect(out).toContain('\\`')
  })
})

describe('buildFeatureGridPrimitive', () => {
  const brand = { name: 'Acme', audience: 'teams' }

  test('emits 3-column grid for columns=3 (default)', () => {
    const out = buildFeatureGridPrimitive(3, 'filled-surface', brand)
    expect(out).toContain('grid-cols-1 md:grid-cols-2 lg:grid-cols-3')
    expect(out).toContain('data-testid="feature-grid-section"')
    expect(out).toContain('data-testid="feature-grid"')
    expect(out).toContain('data-testid="feature-card-0"')
  })

  test('2-column grid uses md:grid-cols-2', () => {
    const out = buildFeatureGridPrimitive(2, 'filled-surface', brand)
    expect(out).toContain('grid-cols-1 md:grid-cols-2')
    expect(out).not.toContain('lg:grid-cols-3')
    expect(out).not.toContain('lg:grid-cols-4')
  })

  test('4-column grid uses lg:grid-cols-4', () => {
    const out = buildFeatureGridPrimitive(4, 'filled-surface', brand)
    expect(out).toContain('lg:grid-cols-4')
  })

  test('hairline-outlined card style uses bg-transparent', () => {
    const out = buildFeatureGridPrimitive(3, 'hairline-outlined', brand)
    expect(out).toContain('border border-[var(--border)] bg-transparent')
  })

  test('shadowed-card style uses shadow-lg', () => {
    const out = buildFeatureGridPrimitive(3, 'shadowed-card', brand)
    expect(out).toContain('shadow-lg')
  })

  test('no-border style omits border class', () => {
    const out = buildFeatureGridPrimitive(3, 'no-border', brand)
    // Find the card className (between `className="p-6 rounded-[var(--radius-lg)] ` and ...`)
    const match = out.match(/rounded-\[var\(--radius-lg\)\] ([^"]+)"/)
    expect(match).not.toBeNull()
    expect(match[1]).not.toContain('border')
  })

  test('falls back to safe defaults for invalid columns/style', () => {
    const out = buildFeatureGridPrimitive(99, 'nonsense-style', brand)
    expect(out).toContain('grid-cols-1 md:grid-cols-2 lg:grid-cols-3')
    expect(out).toContain('bg-[var(--surface)] border border-[var(--border)]') // filled-surface default
  })

  test('renders 2x the column count in cards', () => {
    // e.g., 3-col grid produces 6 cards; 2-col produces 4 cards
    const out3 = buildFeatureGridPrimitive(3, 'filled-surface', brand)
    const cardsIn3 = [...out3.matchAll(/data-testid="feature-card-(\d+)"/g)]
    expect(cardsIn3).toHaveLength(6)

    const out2 = buildFeatureGridPrimitive(2, 'filled-surface', brand)
    const cardsIn2 = [...out2.matchAll(/data-testid="feature-card-(\d+)"/g)]
    expect(cardsIn2).toHaveLength(4)
  })
})

describe('resolvePrimitivesFromBlueprint', () => {
  test('picks directly from a valid blueprint', () => {
    const out = resolvePrimitivesFromBlueprint({
      hero_composition: 'full-bleed-image',
      hero_text_alignment: 'center',
      feature_columns: 4,
      feature_card_style: 'hairline-outlined',
    }, { hasHeroAsset: true })
    expect(out.hero.layout).toBe('full-bleed-image')
    expect(out.hero.textAlignment).toBe('center')
    expect(out.hero.hasHeroAsset).toBe(true)
    expect(out.featureGrid.columns).toBe(4)
    expect(out.featureGrid.cardStyle).toBe('hairline-outlined')
  })

  test('falls back to safe defaults when blueprint is null', () => {
    const out = resolvePrimitivesFromBlueprint(null, {})
    expect(out.hero.layout).toBe('split-50-50')
    expect(out.hero.textAlignment).toBe('left')
    expect(out.featureGrid.columns).toBe(3)
    expect(out.featureGrid.cardStyle).toBe('filled-surface')
  })

  test('rejects invalid enum values and uses safe defaults', () => {
    const out = resolvePrimitivesFromBlueprint({
      hero_composition: 'made-up-layout',
      hero_text_alignment: 'diagonal',
      feature_columns: 99,
      feature_card_style: 'not-real',
    }, {})
    expect(out.hero.layout).toBe('split-50-50')
    expect(out.hero.textAlignment).toBe('left')
    expect(out.featureGrid.columns).toBe(3)
    expect(out.featureGrid.cardStyle).toBe('filled-surface')
  })
})

describe('buildPrimitiveFiles', () => {
  test('emits two files with correct paths', () => {
    const files = buildPrimitiveFiles(
      { hero_composition: 'centered-text', feature_columns: 2, feature_card_style: 'no-border' },
      { name: 'X' },
      { hasHeroAsset: false },
    )
    expect(files).toHaveLength(2)
    const paths = files.map((f) => f.path)
    expect(paths).toContain('components/primitives/Hero.jsx')
    expect(paths).toContain('components/primitives/FeatureGrid.jsx')
  })

  test('Hero file reflects the chosen layout', () => {
    const files = buildPrimitiveFiles(
      { hero_composition: 'full-bleed-image', feature_columns: 3, feature_card_style: 'filled-surface' },
      { name: 'X' },
      { hasHeroAsset: true },
    )
    const hero = files.find((f) => f.path.endsWith('Hero.jsx'))
    expect(hero.content).toContain('Layout: full-bleed-image')
    expect(hero.content).toContain('absolute inset-0')
  })

  test('FeatureGrid file reflects the chosen columns + style', () => {
    const files = buildPrimitiveFiles(
      { hero_composition: 'split-50-50', feature_columns: 4, feature_card_style: 'shadowed-card' },
      { name: 'X' },
      { hasHeroAsset: false },
    )
    const grid = files.find((f) => f.path.endsWith('FeatureGrid.jsx'))
    expect(grid.content).toContain('Grid: 4 columns')
    expect(grid.content).toContain('Card style: shadowed-card')
    expect(grid.content).toContain('lg:grid-cols-4')
    expect(grid.content).toContain('shadow-lg')
  })
})

describe('formatPrimitivesForPrompt', () => {
  test('returns empty string when blueprint is null', () => {
    expect(formatPrimitivesForPrompt(null)).toBe('')
    expect(formatPrimitivesForPrompt(undefined)).toBe('')
  })

  test('lists the two primitive imports + resolved params', () => {
    const out = formatPrimitivesForPrompt({
      hero_composition: 'full-bleed-image',
      hero_text_alignment: 'center',
      feature_columns: 2,
      feature_card_style: 'hairline-outlined',
    })
    expect(out).toContain("import Hero from '../components/primitives/Hero'")
    expect(out).toContain("import FeatureGrid from '../components/primitives/FeatureGrid'")
    expect(out).toContain('full-bleed-image')
    expect(out).toContain('text aligned center')
    expect(out).toContain('2 columns')
    expect(out).toContain('hairline-outlined')
  })

  test('instructs the builder to compose, not re-implement', () => {
    const out = formatPrimitivesForPrompt({
      hero_composition: 'split-50-50', feature_columns: 3, feature_card_style: 'filled-surface',
    })
    expect(out.toLowerCase()).toContain('do not re-implement')
    expect(out).toContain('blueprint')
  })
})
