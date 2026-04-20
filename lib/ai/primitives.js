// ══════════════════════════════════════════════════════════════════════
// ── PRIMITIVES (Session 30, 6/7) ──
// Composable layout components that parameterize the biggest visual
// decisions — hero composition, feature grid columns, card style.
// Before this module, `landing_page` was a single monolithic recipe
// that hardcoded one composition. The layout blueprint Vision call
// (Session 24) extracted `{hero_composition, feature_columns, ...}`
// but the recipe ignored those parameters. Session 30 closes the loop:
// the primitives ARE the blueprint rendered as JSX, so the builder
// just imports them and composes.
//
// Each primitive:
//   - reads CSS vars from <ThemeProvider> (var(--primary), var(--ink), ...)
//   - imports asset exports from `components/assets` when relevant
//   - carries a `data-testid` on every interactive / landmark element
//   - is self-contained (no cross-imports between primitives)
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} BrandContext
 * @property {string} name
 * @property {string} tagline
 * @property {string} description
 * @property {string} audience
 */

const esc = (s) => String(s || '').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/</g, '\\u003c')
const escText = (s) => esc(s).replace(/\{/g, '\\{').replace(/\}/g, '\\}')

function brandTagline(brand) {
  return brand?.tagline || brand?.description || `Welcome to ${brand?.name || 'our platform'}`
}

// ── HERO PRIMITIVES ────────────────────────────────────────────────
// Keys match the enum in parseBlueprint().hero_composition exactly so
// the pipeline can pick a primitive by blueprint value without mapping.

export const HERO_LAYOUTS = Object.freeze([
  'split-50-50',
  'full-bleed-image',
  'centered-text',
  'stacked-image-below',
])

/**
 * Render the Hero primitive file content as a complete JSX module.
 * The landing composition references `<Hero />` and the blueprint-chosen
 * layout is baked in at build time — no runtime branching.
 *
 * @param {string} layout - one of HERO_LAYOUTS
 * @param {BrandContext} brand
 * @param {{hasHeroAsset: boolean, textAlignment?: 'left'|'center'|'right'}} opts
 * @returns {string} complete JSX file content
 */
export function buildHeroPrimitive(layout, brand, opts = {}) {
  const picked = HERO_LAYOUTS.includes(layout) ? layout : 'split-50-50'
  const align = opts.textAlignment === 'center' ? 'center' : opts.textAlignment === 'right' ? 'right' : 'left'
  const brandName = esc(brand?.name || 'Brand')
  const tagline = esc(brandTagline(brand))
  const heroAsset = opts.hasHeroAsset ? `HERO_URL || PHOTO_0` : 'null'
  const importLine = opts.hasHeroAsset
    ? `import { HERO_URL, PHOTO_0 } from '../assets'\n`
    : ''

  const header = `// AUTO-GENERATED primitive by Emanator (Session 30).
// Layout: ${picked} · Text alignment: ${align}${opts.hasHeroAsset ? ' · Uses hero asset' : ''}.
// DO NOT EDIT — regenerated on every build.
${importLine}
`

  const textBlock = `<div className="max-w-xl" style={{ textAlign: '${align}' }} data-testid="hero-text-block">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>
          ${tagline}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-[var(--ink-muted)] max-w-lg ${align === 'center' ? 'mx-auto' : ''}">
          ${esc(brand?.description || '')}
        </p>
        <div className="mt-8 flex gap-3 ${align === 'center' ? 'justify-center' : ''}" data-testid="hero-cta-row">
          <button className="px-6 py-3 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--primary-ink)] font-semibold hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50" data-testid="hero-primary-cta">
            Get started
          </button>
          <button className="px-6 py-3 rounded-[var(--radius)] border border-[var(--border)] text-[var(--ink)] font-medium hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50" data-testid="hero-secondary-cta">
            Learn more
          </button>
        </div>
      </div>`

  let body
  switch (picked) {
    case 'full-bleed-image':
      body = `<section className="relative min-h-[70vh] flex items-center" data-testid="hero-section">
      ${opts.hasHeroAsset ? `<img src={${heroAsset}} alt="${brandName}" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-[var(--bg)]/55" aria-hidden="true" />` : ''}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-24">
      ${textBlock}
      </div>
    </section>`
      break

    case 'centered-text':
      body = `<section className="w-full max-w-6xl mx-auto px-6 py-24 sm:py-32 flex flex-col items-center" data-testid="hero-section">
      <div className="max-w-3xl text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>
          ${tagline}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-[var(--ink-muted)] mx-auto">
          ${esc(brand?.description || '')}
        </p>
        <div className="mt-8 flex gap-3 justify-center" data-testid="hero-cta-row">
          <button className="px-6 py-3 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--primary-ink)] font-semibold" data-testid="hero-primary-cta">Get started</button>
          <button className="px-6 py-3 rounded-[var(--radius)] border border-[var(--border)] text-[var(--ink)] font-medium" data-testid="hero-secondary-cta">Learn more</button>
        </div>
      </div>
      ${opts.hasHeroAsset ? `<img src={${heroAsset}} alt="${brandName}" className="mt-12 w-full max-w-4xl rounded-[var(--radius-lg)]" />` : ''}
    </section>`
      break

    case 'stacked-image-below':
      body = `<section className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="hero-section">
      ${textBlock}
      ${opts.hasHeroAsset ? `<img src={${heroAsset}} alt="${brandName}" className="mt-12 w-full rounded-[var(--radius-lg)]" />` : ''}
    </section>`
      break

    case 'split-50-50':
    default:
      body = `<section className="w-full max-w-6xl mx-auto px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center" data-testid="hero-section">
      ${textBlock}
      <div className="aspect-[4/3] w-full rounded-[var(--radius-lg)] overflow-hidden bg-[var(--surface)] border border-[var(--border)]" data-testid="hero-visual">
        ${opts.hasHeroAsset ? `<img src={${heroAsset}} alt="${brandName}" className="w-full h-full object-cover" />` : ''}
      </div>
    </section>`
  }

  return `${header}export default function Hero() {
  return (
    ${body}
  )
}
`
}

// ── FEATURE GRID PRIMITIVES ────────────────────────────────────────

export const FEATURE_CARD_STYLES = Object.freeze([
  'hairline-outlined',
  'filled-surface',
  'no-border',
  'shadowed-card',
])

/**
 * Render the FeatureGrid primitive. Columns and card style both map
 * directly to blueprint fields (feature_columns + feature_card_style).
 *
 * @param {number} columns - 2, 3, or 4
 * @param {string} cardStyle - one of FEATURE_CARD_STYLES
 * @param {BrandContext} brand
 * @param {{features?: Array<{title: string, body: string}>}} opts
 * @returns {string}
 */
export function buildFeatureGridPrimitive(columns, cardStyle, brand, opts = {}) {
  const cols = [2, 3, 4].includes(columns) ? columns : 3
  const style = FEATURE_CARD_STYLES.includes(cardStyle) ? cardStyle : 'filled-surface'
  const features = (opts.features && opts.features.length >= cols)
    ? opts.features.slice(0, cols * 2)
    : defaultFeaturesForBrand(brand, cols)

  const gridClass = {
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  }[cols]

  const cardClass = {
    'hairline-outlined': 'border border-[var(--border)] bg-transparent',
    'filled-surface': 'bg-[var(--surface)] border border-[var(--border)]',
    'no-border': 'bg-[var(--surface)]',
    'shadowed-card': 'bg-[var(--surface)] border border-[var(--border)] shadow-lg',
  }[style]

  const cards = features.map((f, i) => `
        <div className="p-6 rounded-[var(--radius-lg)] ${cardClass}" data-testid="feature-card-${i}">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] font-bold" aria-hidden="true">${i + 1}</div>
          <h3 className="mt-4 text-lg font-semibold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>${escText(f.title)}</h3>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">${escText(f.body)}</p>
        </div>`).join('')

  return `// AUTO-GENERATED primitive by Emanator (Session 30).
// Grid: ${cols} columns · Card style: ${style}.
// DO NOT EDIT — regenerated on every build.

export default function FeatureGrid() {
  return (
    <section className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="feature-grid-section">
      <h2 className="text-3xl sm:text-4xl font-bold text-[var(--ink)] text-center" style={{ fontFamily: 'var(--font-display)' }}>
        Why ${escText(brand?.name || 'us')}
      </h2>
      <div className="mt-12 grid ${gridClass} gap-6" data-testid="feature-grid">${cards}
      </div>
    </section>
  )
}
`
}

function defaultFeaturesForBrand(brand, count) {
  const audience = brand?.audience || 'you'
  const base = [
    { title: 'Ship faster', body: `Cut weeks off your next launch with ready-made flows for ${audience}.` },
    { title: 'Work the way you think', body: 'Every interaction is one click away — no nested menus, no dead-ends.' },
    { title: 'Built for scale', body: `Handles the workload whether you have 10 or 10,000 ${audience}.` },
    { title: 'Polished to the pixel', body: 'Typography, palette, and spacing tuned to match your brand.' },
    { title: 'Secure by default', body: 'Industry-standard auth + encrypted storage out of the box.' },
    { title: 'Integrates with your stack', body: 'REST and webhooks for the tools you already use.' },
  ]
  return base.slice(0, count * 2)
}

// ── ORCHESTRATOR ───────────────────────────────────────────────────

/**
 * Pick primitive parameters from a layout blueprint. Returns the
 * resolved primitive specs the pipeline writes to
 * `components/primitives/Hero.jsx` + `components/primitives/FeatureGrid.jsx`.
 *
 * @param {Object|null} blueprint - parseBlueprint() output
 * @param {{hasHeroAsset: boolean}} flags
 * @returns {{hero: {layout: string, textAlignment: string}, featureGrid: {columns: number, cardStyle: string}}}
 */
export function resolvePrimitivesFromBlueprint(blueprint, flags = {}) {
  return {
    hero: {
      layout: HERO_LAYOUTS.includes(blueprint?.hero_composition) ? blueprint.hero_composition : 'split-50-50',
      textAlignment: ['left', 'center', 'right'].includes(blueprint?.hero_text_alignment) ? blueprint.hero_text_alignment : 'left',
      hasHeroAsset: !!flags.hasHeroAsset,
    },
    featureGrid: {
      columns: [2, 3, 4].includes(blueprint?.feature_columns) ? blueprint.feature_columns : 3,
      cardStyle: FEATURE_CARD_STYLES.includes(blueprint?.feature_card_style) ? blueprint.feature_card_style : 'filled-surface',
    },
  }
}

/**
 * Build all primitive files that should be emitted to the project when
 * a blueprint + brand are available. Non-destructive — the builder
 * still writes its own `app/page.jsx` (which imports these primitives).
 *
 * @param {Object} blueprint
 * @param {BrandContext} brand
 * @param {{hasHeroAsset: boolean}} flags
 * @returns {Array<{path: string, content: string}>}
 */
export function buildPrimitiveFiles(blueprint, brand, flags = {}) {
  const spec = resolvePrimitivesFromBlueprint(blueprint, flags)
  return [
    {
      path: 'components/primitives/Hero.jsx',
      content: buildHeroPrimitive(spec.hero.layout, brand, {
        hasHeroAsset: spec.hero.hasHeroAsset,
        textAlignment: spec.hero.textAlignment,
      }),
    },
    {
      path: 'components/primitives/FeatureGrid.jsx',
      content: buildFeatureGridPrimitive(spec.featureGrid.columns, spec.featureGrid.cardStyle, brand),
    },
  ]
}

/**
 * Compact builder-prompt block describing the emitted primitives. The
 * builder must import these from `components/primitives/` and COMPOSE
 * them rather than re-implement the hero / feature grid from scratch.
 *
 * @param {Object} blueprint
 * @returns {string}
 */
export function formatPrimitivesForPrompt(blueprint) {
  if (!blueprint) return ''
  const spec = resolvePrimitivesFromBlueprint(blueprint, {})
  return `PRIMITIVES — Emanator has pre-composed these layout primitives from the user's blueprint. Import and USE them directly. Do NOT re-implement.

  import Hero from '../components/primitives/Hero'
  import FeatureGrid from '../components/primitives/FeatureGrid'

  - <Hero /> — layout=${spec.hero.layout}, text aligned ${spec.hero.textAlignment}${spec.hero.hasHeroAsset ? ' (renders uploaded hero asset)' : ''}
  - <FeatureGrid /> — ${spec.featureGrid.columns} columns, ${spec.featureGrid.cardStyle} card style

Render them inside the landing page in the blueprint's section order. You may add Pricing, Testimonials, FAQ, CTA sections between them. Do not wrap them in extra styling — they already consume theme tokens.`
}
