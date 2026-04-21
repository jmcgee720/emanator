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
  PRICING_PATTERNS,
  TESTIMONIAL_STYLES,
  CTA_STYLES,
  buildHeroPrimitive,
  buildFeatureGridPrimitive,
  buildPricingPrimitive,
  buildTestimonialsPrimitive,
  buildCtaPrimitive,
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
  test('emits all five primitive files with correct paths', () => {
    const files = buildPrimitiveFiles(
      { hero_composition: 'centered-text', feature_columns: 2, feature_card_style: 'no-border' },
      { name: 'X' },
      { hasHeroAsset: false },
    )
    expect(files).toHaveLength(5)
    const paths = files.map((f) => f.path)
    expect(paths).toContain('components/primitives/Hero.jsx')
    expect(paths).toContain('components/primitives/FeatureGrid.jsx')
    expect(paths).toContain('components/primitives/Pricing.jsx')
    expect(paths).toContain('components/primitives/Testimonials.jsx')
    expect(paths).toContain('components/primitives/CTA.jsx')
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

  test('lists the five primitive imports + resolved params', () => {
    const out = formatPrimitivesForPrompt({
      hero_composition: 'full-bleed-image',
      hero_text_alignment: 'center',
      feature_columns: 2,
      feature_card_style: 'hairline-outlined',
      pricing_pattern: 'toggle-annual-monthly',
    })
    expect(out).toContain("import Hero from '../components/primitives/Hero'")
    expect(out).toContain("import FeatureGrid from '../components/primitives/FeatureGrid'")
    expect(out).toContain("import Pricing from '../components/primitives/Pricing'")
    expect(out).toContain("import Testimonials from '../components/primitives/Testimonials'")
    expect(out).toContain("import CTA from '../components/primitives/CTA'")
    expect(out).toContain('full-bleed-image')
    expect(out).toContain('text aligned center')
    expect(out).toContain('2 columns')
    expect(out).toContain('hairline-outlined')
    expect(out).toContain('toggle-annual-monthly pattern')
  })

  test('instructs the builder to compose, not re-implement', () => {
    const out = formatPrimitivesForPrompt({
      hero_composition: 'split-50-50', feature_columns: 3, feature_card_style: 'filled-surface',
    })
    expect(out.toLowerCase()).toContain('do not re-implement')
    expect(out).toContain('blueprint')
  })
})

describe('buildPricingPrimitive (Session 33)', () => {
  const brand = { name: 'Acme', audience: 'teams' }

  test('PRICING_PATTERNS immutable + matches blueprint enum', () => {
    expect(PRICING_PATTERNS).toEqual(expect.arrayContaining([
      'three-column', 'horizontal-strip', 'single-featured', 'toggle-annual-monthly',
    ]))
    expect(Object.isFrozen(PRICING_PATTERNS)).toBe(true)
  })

  test('three-column (default) renders grid + 3 tier cards', () => {
    const out = buildPricingPrimitive('three-column', brand)
    expect(out).toContain("export default function Pricing()")
    expect(out).toContain('md:grid-cols-3')
    expect(out).toContain('data-testid="pricing-tier-0"')
    expect(out).toContain('data-testid="pricing-tier-1"')
    expect(out).toContain('data-testid="pricing-tier-2"')
    expect(out).toContain('data-testid="pricing-tier-0-cta"')
    expect(out).not.toContain("import { useState }") // no toggle state
  })

  test('horizontal-strip renders one-row divide pattern', () => {
    const out = buildPricingPrimitive('horizontal-strip', brand)
    expect(out).toContain('divide-x')
    expect(out).toContain('Pattern: horizontal-strip')
  })

  test('single-featured renders max-w-3xl single card', () => {
    const out = buildPricingPrimitive('single-featured', brand)
    expect(out).toContain('max-w-3xl')
    expect(out).toContain('data-testid="pricing-tier-0"')
    expect(out).not.toContain('data-testid="pricing-tier-1"')
  })

  test('toggle-annual-monthly injects useState + toggle buttons', () => {
    const out = buildPricingPrimitive('toggle-annual-monthly', brand)
    expect(out).toContain("import { useState } from 'react'")
    expect(out).toContain('useState(false)')
    expect(out).toContain('data-testid="pricing-cycle-toggle"')
    expect(out).toContain('data-testid="pricing-cycle-monthly"')
    expect(out).toContain('data-testid="pricing-cycle-annual"')
  })

  test('falls back to three-column for unknown pattern', () => {
    const out = buildPricingPrimitive('not-real-pattern', brand)
    expect(out).toContain('Pattern: three-column')
    expect(out).toContain('md:grid-cols-3')
  })

  test('always uses CSS vars (no hardcoded colors)', () => {
    const out = buildPricingPrimitive('three-column', brand)
    expect(out).toContain('bg-[var(--primary)]')
    expect(out).toContain('border-[var(--border)]')
    expect(out).not.toMatch(/bg-violet-|bg-indigo-|bg-white\b/)
  })

  test('respects opts.tiers for custom pricing data', () => {
    const out = buildPricingPrimitive('three-column', brand, {
      tiers: [
        { name: 'Hobby', price: '$0', period: '', blurb: 'custom', features: ['a'], highlighted: false, cta: 'Go' },
        { name: 'Pro',   price: '$99', period: '/yr', blurb: 'x', features: ['b'], highlighted: true, cta: 'Try' },
        { name: 'Max',   price: '$999', period: '/yr', blurb: 'y', features: ['c'], highlighted: false, cta: 'Call' },
      ],
    })
    expect(out).toContain('$99')
    expect(out).toContain('Hobby')
    expect(out).toContain('Most popular') // highlighted tier
  })
})

describe('buildTestimonialsPrimitive (Session 33)', () => {
  const brand = { name: 'Acme' }

  test('TESTIMONIAL_STYLES immutable', () => {
    expect(Object.isFrozen(TESTIMONIAL_STYLES)).toBe(true)
    expect(TESTIMONIAL_STYLES).toContain('card-grid')
    expect(TESTIMONIAL_STYLES).toContain('single-quote-hero')
  })

  test('card-grid renders 3 testimonial cards', () => {
    const out = buildTestimonialsPrimitive('card-grid', brand)
    expect(out).toContain("export default function Testimonials()")
    expect(out).toContain('data-testid="testimonials-grid"')
    expect(out).toContain('data-testid="testimonial-card-0"')
    expect(out).toContain('data-testid="testimonial-card-1"')
    expect(out).toContain('data-testid="testimonial-card-2"')
  })

  test('single-quote-hero renders one big quote only', () => {
    const out = buildTestimonialsPrimitive('single-quote-hero', brand)
    expect(out).toContain('Style: single-quote-hero')
    expect(out).toContain('data-testid="testimonial-card-0"')
    expect(out).not.toContain('data-testid="testimonial-card-1"')
  })

  test('marquee-logos-plus-quote includes logo placeholders', () => {
    const out = buildTestimonialsPrimitive('marquee-logos-plus-quote', brand)
    expect(out).toContain('data-testid="testimonials-logos"')
    expect(out).toContain('data-testid="testimonial-logo-0"')
  })

  test('falls back to card-grid for unknown style', () => {
    const out = buildTestimonialsPrimitive('does-not-exist', brand)
    expect(out).toContain('Style: card-grid')
  })

  test('always uses theme tokens', () => {
    const out = buildTestimonialsPrimitive('card-grid', brand)
    expect(out).toContain('text-[var(--ink)]')
    expect(out).not.toMatch(/bg-violet-|text-white\b|bg-gray-\d/)
  })
})

describe('buildCtaPrimitive (Session 33)', () => {
  const brand = { name: 'Acme' }

  test('CTA_STYLES immutable', () => {
    expect(Object.isFrozen(CTA_STYLES)).toBe(true)
    expect(CTA_STYLES).toContain('centered-rounded')
    expect(CTA_STYLES).toContain('full-width-accent')
    expect(CTA_STYLES).toContain('split-image')
  })

  test('centered-rounded renders the default framed CTA', () => {
    const out = buildCtaPrimitive('centered-rounded', brand)
    expect(out).toContain("export default function CTA()")
    expect(out).toContain('data-testid="cta-section"')
    expect(out).toContain('data-testid="cta-headline"')
    expect(out).toContain('data-testid="cta-primary"')
    expect(out).toContain('data-testid="cta-secondary"')
    expect(out).toContain('rounded-[var(--radius-lg)]')
  })

  test('full-width-accent uses bg-primary + primary-ink', () => {
    const out = buildCtaPrimitive('full-width-accent', brand)
    expect(out).toContain('bg-[var(--primary)]')
    expect(out).toContain('text-[var(--primary-ink)]')
  })

  test('split-image imports hero asset only when hasHeroAsset=true', () => {
    const without = buildCtaPrimitive('split-image', brand, { hasHeroAsset: false })
    const withIt = buildCtaPrimitive('split-image', brand, { hasHeroAsset: true })
    expect(without).not.toContain("import { HERO_URL")
    expect(withIt).toContain("import { HERO_URL, PHOTO_0 } from '../assets'")
    expect(withIt).toContain('HERO_URL || PHOTO_0')
  })

  test('honours custom headline + subhead', () => {
    const out = buildCtaPrimitive('centered-rounded', brand, {
      headline: 'Start building today',
      subhead: 'No setup required.',
    })
    expect(out).toContain('Start building today')
    expect(out).toContain('No setup required.')
  })

  test('falls back to centered-rounded for unknown style', () => {
    const out = buildCtaPrimitive('made-up', brand)
    expect(out).toContain('Style: centered-rounded')
  })
})

describe('resolvePrimitivesFromBlueprint (Session 33 extensions)', () => {
  test('picks pricing + testimonials + cta from blueprint', () => {
    const out = resolvePrimitivesFromBlueprint({
      hero_composition: 'split-50-50',
      feature_columns: 3,
      feature_card_style: 'filled-surface',
      pricing_pattern: 'single-featured',
      testimonials_style: 'single-quote-hero',
      cta_style: 'full-width-accent',
    }, {})
    expect(out.pricing.pattern).toBe('single-featured')
    expect(out.testimonials.style).toBe('single-quote-hero')
    expect(out.cta.style).toBe('full-width-accent')
  })

  test('safe defaults for new fields when missing', () => {
    const out = resolvePrimitivesFromBlueprint({}, {})
    expect(out.pricing.pattern).toBe('three-column')
    expect(out.testimonials.style).toBe('card-grid')
    expect(out.cta.style).toBe('centered-rounded')
  })

  test('rejects invalid enums for new fields', () => {
    const out = resolvePrimitivesFromBlueprint({
      pricing_pattern: 'bogus',
      testimonials_style: 'bogus',
      cta_style: 'bogus',
    }, {})
    expect(out.pricing.pattern).toBe('three-column')
    expect(out.testimonials.style).toBe('card-grid')
    expect(out.cta.style).toBe('centered-rounded')
  })
})

describe('buildPrimitiveFiles (Session 33 — 5 files)', () => {
  test('emits five canonical primitive files', () => {
    const files = buildPrimitiveFiles(
      { hero_composition: 'centered-text', feature_columns: 2, feature_card_style: 'no-border', pricing_pattern: 'horizontal-strip' },
      { name: 'X' },
      { hasHeroAsset: false },
    )
    expect(files).toHaveLength(5)
    const paths = files.map((f) => f.path)
    expect(paths).toContain('components/primitives/Hero.jsx')
    expect(paths).toContain('components/primitives/FeatureGrid.jsx')
    expect(paths).toContain('components/primitives/Pricing.jsx')
    expect(paths).toContain('components/primitives/Testimonials.jsx')
    expect(paths).toContain('components/primitives/CTA.jsx')
  })

  test('Pricing file reflects chosen pattern', () => {
    const files = buildPrimitiveFiles(
      { pricing_pattern: 'toggle-annual-monthly' },
      { name: 'X' },
      {},
    )
    const pricing = files.find((f) => f.path.endsWith('Pricing.jsx'))
    expect(pricing.content).toContain('toggle-annual-monthly')
    expect(pricing.content).toContain('useState')
  })
})
