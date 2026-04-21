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

// ── PRICING PRIMITIVES ─────────────────────────────────────────────
// Keys match blueprint.pricing_pattern enum exactly.

export const PRICING_PATTERNS = Object.freeze([
  'three-column',
  'horizontal-strip',
  'single-featured',
  'toggle-annual-monthly',
])

function defaultTiersForBrand(brand) {
  return [
    { name: 'Starter',       price: '$0',    period: '/mo',   blurb: 'Everything to try it out.',    features: ['Up to 3 projects', 'Community support', 'Basic analytics'], highlighted: false, cta: 'Start free' },
    { name: 'Pro',           price: '$19',   period: '/mo',   blurb: `For serious ${brand?.audience || 'builders'}.`, features: ['Unlimited projects', 'Priority support', 'Custom domains', 'Advanced analytics'], highlighted: true, cta: 'Start 14-day trial' },
    { name: 'Team',          price: '$49',   period: '/mo',   blurb: 'For growing organizations.',   features: ['Everything in Pro', 'Team workspaces', 'SSO + SAML', 'SLA'], highlighted: false, cta: 'Contact sales' },
  ]
}

/**
 * Render Pricing.jsx. `pattern` maps to blueprint.pricing_pattern — each
 * produces a genuinely different layout (not just a column count).
 *
 * @param {string} pattern - one of PRICING_PATTERNS
 * @param {BrandContext} brand
 * @param {{tiers?: Array}} opts
 * @returns {string}
 */
export function buildPricingPrimitive(pattern, brand, opts = {}) {
  const picked = PRICING_PATTERNS.includes(pattern) ? pattern : 'three-column'
  const tiers = (Array.isArray(opts.tiers) && opts.tiers.length > 0) ? opts.tiers : defaultTiersForBrand(brand)

  const renderTierCard = (t, i, extraClass = '') => `
        <div className="${extraClass} rounded-[var(--radius-lg)] p-6 flex flex-col ${t.highlighted ? 'ring-2 ring-[var(--primary)] bg-[var(--surface)]' : 'bg-[var(--surface)] border border-[var(--border)]'}" data-testid="pricing-tier-${i}">
          ${t.highlighted ? `<span className="self-start text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--primary)] text-[var(--primary-ink)] font-semibold mb-3">Most popular</span>` : ''}
          <h3 className="text-lg font-semibold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>${escText(t.name)}</h3>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-4xl font-bold text-[var(--ink)]">${escText(t.price)}</span>
            <span className="text-sm text-[var(--ink-muted)]">${escText(t.period || '')}</span>
          </div>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">${escText(t.blurb || '')}</p>
          <ul className="mt-6 space-y-2 text-sm flex-1">
            ${(t.features || []).map((f) => `<li className="flex items-start gap-2 text-[var(--ink)]"><span className="text-[var(--primary)] mt-0.5">✓</span>${escText(f)}</li>`).join('\n            ')}
          </ul>
          <button className="mt-6 px-4 py-2 rounded-[var(--radius)] font-semibold transition-colors ${t.highlighted ? 'bg-[var(--primary)] text-[var(--primary-ink)] hover:opacity-90' : 'border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface-2)]'}" data-testid="pricing-tier-${i}-cta">
            ${escText(t.cta || 'Choose plan')}
          </button>
        </div>`

  let body
  switch (picked) {
    case 'horizontal-strip':
      // All tiers in a single horizontal row (no highlighted ring — uniform strip)
      body = `<div className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="pricing-section">
      ${pricingSectionHeader(brand)}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--border)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden" data-testid="pricing-grid">
        ${tiers.slice(0, 3).map((t, i) => `
          <div className="p-6 flex flex-col bg-[var(--surface)]" data-testid="pricing-tier-${i}">
            <h3 className="text-base font-semibold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>${escText(t.name)}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-[var(--ink)]">${escText(t.price)}</span>
              <span className="text-xs text-[var(--ink-muted)]">${escText(t.period || '')}</span>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">${escText(t.blurb || '')}</p>
            <button className="mt-4 px-3 py-1.5 rounded-[var(--radius)] text-xs font-semibold bg-[var(--primary)] text-[var(--primary-ink)] self-start" data-testid="pricing-tier-${i}-cta">${escText(t.cta || 'Choose')}</button>
          </div>`).join('')}
      </div>
    </div>`
      break

    case 'single-featured':
      // One big tier, framed + featured
      body = `<div className="w-full max-w-3xl mx-auto px-6 py-20" data-testid="pricing-section">
      ${pricingSectionHeader(brand)}
      ${renderTierCard({ ...tiers[1] || tiers[0], highlighted: true }, 0, 'mt-12')}
    </div>`
      break

    case 'toggle-annual-monthly':
      // 3-column with a billing-cycle toggle (client-state)
      body = `<div className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="pricing-section">
      ${pricingSectionHeader(brand)}
      <div className="mt-8 flex justify-center" data-testid="pricing-cycle-toggle">
        <div className="inline-flex rounded-full border border-[var(--border)] p-1 bg-[var(--surface)]">
          <button onClick={() => setAnnual(false)} className={'px-4 py-1.5 rounded-full text-sm font-medium transition-colors ' + (!annual ? 'bg-[var(--primary)] text-[var(--primary-ink)]' : 'text-[var(--ink-muted)]')} data-testid="pricing-cycle-monthly">Monthly</button>
          <button onClick={() => setAnnual(true)} className={'px-4 py-1.5 rounded-full text-sm font-medium transition-colors ' + (annual ? 'bg-[var(--primary)] text-[var(--primary-ink)]' : 'text-[var(--ink-muted)]')} data-testid="pricing-cycle-annual">Annual <span className="text-[10px] text-[var(--primary)]">-20%</span></button>
        </div>
      </div>
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="pricing-grid">
        ${tiers.slice(0, 3).map((t, i) => renderTierCard(t, i)).join('')}
      </div>
    </div>`
      break

    case 'three-column':
    default:
      body = `<div className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="pricing-section">
      ${pricingSectionHeader(brand)}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="pricing-grid">
        ${tiers.slice(0, 3).map((t, i) => renderTierCard(t, i)).join('')}
      </div>
    </div>`
  }

  const needsState = picked === 'toggle-annual-monthly'
  const imports = needsState ? "import { useState } from 'react'\n" : ''
  const stateHook = needsState ? '  const [annual, setAnnual] = useState(false)\n' : ''

  return `// AUTO-GENERATED primitive by Emanator (Session 33).
// Pattern: ${picked}.
// DO NOT EDIT — regenerated on every build.
${imports}
export default function Pricing() {
${stateHook}  return (
    <section className="bg-[var(--bg)]">
      ${body}
    </section>
  )
}
`
}

function pricingSectionHeader(brand) {
  return `<div className="text-center max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>
          Simple, transparent pricing
        </h2>
        <p className="mt-3 text-base text-[var(--ink-muted)]">
          Built for ${escText(brand?.audience || 'teams')} of every size. Cancel anytime.
        </p>
      </div>`
}

// ── TESTIMONIAL PRIMITIVES ─────────────────────────────────────────
// `style` isn't in the blueprint today — defaults to 'card-grid'. A
// future blueprint.testimonials_style field would plug straight in.

export const TESTIMONIAL_STYLES = Object.freeze([
  'card-grid',
  'single-quote-hero',
  'marquee-logos-plus-quote',
])

function defaultTestimonialsForBrand(brand) {
  const brandName = brand?.name || 'this'
  return [
    { quote: `Using ${brandName} cut our launch time in half. The defaults are tasteful and production-ready from day one.`, name: 'Ada Chen', role: 'Founder, Linework' },
    { quote: `Polish you'd expect from a mature product, delivered in a tool. Our team hasn't looked back.`,                      name: 'Marco Rossi', role: 'CTO, Signalform' },
    { quote: `It's rare that a tool feels thoughtful in both the happy path and the edges. ${brandName} does.`,                   name: 'Sana Patel',  role: 'Head of Design, Orbit' },
  ]
}

/**
 * @param {string} style - one of TESTIMONIAL_STYLES
 * @param {BrandContext} brand
 * @param {{testimonials?: Array}} opts
 * @returns {string}
 */
export function buildTestimonialsPrimitive(style, brand, opts = {}) {
  const picked = TESTIMONIAL_STYLES.includes(style) ? style : 'card-grid'
  const list = (Array.isArray(opts.testimonials) && opts.testimonials.length > 0) ? opts.testimonials : defaultTestimonialsForBrand(brand)

  let body
  switch (picked) {
    case 'single-quote-hero':
      body = `<div className="w-full max-w-3xl mx-auto px-6 py-24 text-center" data-testid="testimonials-section">
      <blockquote className="text-2xl sm:text-3xl leading-relaxed text-[var(--ink)] italic" style={{ fontFamily: 'var(--font-display)' }} data-testid="testimonial-card-0">
        "${escText(list[0].quote)}"
      </blockquote>
      <div className="mt-8 flex items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-[var(--primary)] font-semibold">${escText((list[0].name || '?').charAt(0))}</div>
        <div className="text-left">
          <div className="text-sm font-semibold text-[var(--ink)]">${escText(list[0].name)}</div>
          <div className="text-xs text-[var(--ink-muted)]">${escText(list[0].role || '')}</div>
        </div>
      </div>
    </div>`
      break

    case 'marquee-logos-plus-quote':
      body = `<div className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="testimonials-section">
      <div className="text-center">
        <blockquote className="text-xl sm:text-2xl leading-relaxed text-[var(--ink)] max-w-2xl mx-auto italic" style={{ fontFamily: 'var(--font-display)' }} data-testid="testimonial-card-0">
          "${escText(list[0].quote)}"
        </blockquote>
        <div className="mt-4 text-sm text-[var(--ink-muted)]">— ${escText(list[0].name)}, ${escText(list[0].role || '')}</div>
      </div>
      <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-6 items-center opacity-60" data-testid="testimonials-logos">
        ${['Linework','Signalform','Orbit','Arclight'].map((n, i) => `<div className="text-center text-sm font-semibold text-[var(--ink-muted)]" data-testid="testimonial-logo-${i}">${n}</div>`).join('\n        ')}
      </div>
    </div>`
      break

    case 'card-grid':
    default:
      body = `<div className="w-full max-w-6xl mx-auto px-6 py-20" data-testid="testimonials-section">
      <h2 className="text-3xl sm:text-4xl font-bold text-[var(--ink)] text-center" style={{ fontFamily: 'var(--font-display)' }}>
        Loved by teams like yours
      </h2>
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="testimonials-grid">
        ${list.slice(0, 3).map((t, i) => `
          <figure className="p-6 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] flex flex-col" data-testid="testimonial-card-${i}">
            <blockquote className="text-[var(--ink)] leading-relaxed flex-1">"${escText(t.quote)}"</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-[var(--primary)] text-sm font-semibold">${escText((t.name || '?').charAt(0))}</div>
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">${escText(t.name)}</div>
                <div className="text-xs text-[var(--ink-muted)]">${escText(t.role || '')}</div>
              </div>
            </figcaption>
          </figure>`).join('')}
      </div>
    </div>`
  }

  return `// AUTO-GENERATED primitive by Emanator (Session 33).
// Style: ${picked}.
// DO NOT EDIT — regenerated on every build.

export default function Testimonials() {
  return (
    <section className="bg-[var(--bg)]">
      ${body}
    </section>
  )
}
`
}

// ── CTA PRIMITIVES ─────────────────────────────────────────────────
// Final-CTA section before footer. Blueprint emits `final-cta` in
// sections_order[] but no dedicated style field today — defaults to
// 'centered-rounded'. A future `cta_style` blueprint field plugs in.

export const CTA_STYLES = Object.freeze([
  'centered-rounded',
  'full-width-accent',
  'split-image',
])

/**
 * @param {string} style - one of CTA_STYLES
 * @param {BrandContext} brand
 * @param {{hasHeroAsset?: boolean, headline?: string, subhead?: string}} opts
 * @returns {string}
 */
export function buildCtaPrimitive(style, brand, opts = {}) {
  const picked = CTA_STYLES.includes(style) ? style : 'centered-rounded'
  const headline = esc(opts.headline || `Ready to see ${brand?.name || 'what you can build'}?`)
  const subhead = esc(opts.subhead || 'Join in seconds. No credit card required.')

  const importLine = (picked === 'split-image' && opts.hasHeroAsset)
    ? `import { HERO_URL, PHOTO_0 } from '../assets'\n`
    : ''

  let body
  switch (picked) {
    case 'full-width-accent':
      body = `<div className="w-full bg-[var(--primary)] text-[var(--primary-ink)] py-20" data-testid="cta-section">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-3xl sm:text-5xl font-bold" style={{ fontFamily: 'var(--font-display)' }} data-testid="cta-headline">${headline}</h2>
        <p className="mt-4 text-base sm:text-lg opacity-90" data-testid="cta-subhead">${subhead}</p>
        <div className="mt-8 flex gap-3 justify-center" data-testid="cta-buttons">
          <button className="px-6 py-3 rounded-[var(--radius)] bg-[var(--primary-ink)] text-[var(--primary)] font-semibold hover:opacity-90" data-testid="cta-primary">Get started</button>
          <button className="px-6 py-3 rounded-[var(--radius)] border border-[var(--primary-ink)]/30 text-[var(--primary-ink)] font-medium hover:bg-[var(--primary-ink)]/10" data-testid="cta-secondary">Book a demo</button>
        </div>
      </div>
    </div>`
      break

    case 'split-image':
      body = `<div className="w-full max-w-6xl mx-auto px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center" data-testid="cta-section">
      <div>
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }} data-testid="cta-headline">${headline}</h2>
        <p className="mt-4 text-base text-[var(--ink-muted)]" data-testid="cta-subhead">${subhead}</p>
        <div className="mt-8 flex gap-3" data-testid="cta-buttons">
          <button className="px-6 py-3 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--primary-ink)] font-semibold" data-testid="cta-primary">Start free</button>
          <button className="px-6 py-3 rounded-[var(--radius)] border border-[var(--border)] text-[var(--ink)] font-medium" data-testid="cta-secondary">See pricing</button>
        </div>
      </div>
      <div className="aspect-[4/3] w-full rounded-[var(--radius-lg)] overflow-hidden bg-[var(--surface)] border border-[var(--border)]" data-testid="cta-visual">
        ${opts.hasHeroAsset ? `<img src={HERO_URL || PHOTO_0} alt="" className="w-full h-full object-cover" />` : ''}
      </div>
    </div>`
      break

    case 'centered-rounded':
    default:
      body = `<div className="w-full max-w-5xl mx-auto px-6 py-20" data-testid="cta-section">
      <div className="rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] p-10 sm:p-16 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }} data-testid="cta-headline">${headline}</h2>
        <p className="mt-4 text-base text-[var(--ink-muted)] max-w-xl mx-auto" data-testid="cta-subhead">${subhead}</p>
        <div className="mt-8 flex gap-3 justify-center" data-testid="cta-buttons">
          <button className="px-6 py-3 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--primary-ink)] font-semibold" data-testid="cta-primary">Get started</button>
          <button className="px-6 py-3 rounded-[var(--radius)] border border-[var(--border)] text-[var(--ink)] font-medium" data-testid="cta-secondary">Talk to sales</button>
        </div>
      </div>
    </div>`
  }

  return `// AUTO-GENERATED primitive by Emanator (Session 33).
// Style: ${picked}.
// DO NOT EDIT — regenerated on every build.
${importLine}
export default function CTA() {
  return (
    <section className="bg-[var(--bg)]">
      ${body}
    </section>
  )
}
`
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
    pricing: {
      pattern: PRICING_PATTERNS.includes(blueprint?.pricing_pattern) ? blueprint.pricing_pattern : 'three-column',
    },
    testimonials: {
      style: TESTIMONIAL_STYLES.includes(blueprint?.testimonials_style) ? blueprint.testimonials_style : 'card-grid',
    },
    cta: {
      style: CTA_STYLES.includes(blueprint?.cta_style) ? blueprint.cta_style : 'centered-rounded',
      hasHeroAsset: !!flags.hasHeroAsset,
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
    {
      path: 'components/primitives/Pricing.jsx',
      content: buildPricingPrimitive(spec.pricing.pattern, brand),
    },
    {
      path: 'components/primitives/Testimonials.jsx',
      content: buildTestimonialsPrimitive(spec.testimonials.style, brand),
    },
    {
      path: 'components/primitives/CTA.jsx',
      content: buildCtaPrimitive(spec.cta.style, brand, { hasHeroAsset: spec.cta.hasHeroAsset }),
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
  import Pricing from '../components/primitives/Pricing'
  import Testimonials from '../components/primitives/Testimonials'
  import CTA from '../components/primitives/CTA'

  - <Hero />         — layout=${spec.hero.layout}, text aligned ${spec.hero.textAlignment}${spec.hero.hasHeroAsset ? ' (renders uploaded hero asset)' : ''}
  - <FeatureGrid />  — ${spec.featureGrid.columns} columns, ${spec.featureGrid.cardStyle} card style
  - <Pricing />      — ${spec.pricing.pattern} pattern
  - <Testimonials /> — ${spec.testimonials.style} style
  - <CTA />          — ${spec.cta.style} style${spec.cta.hasHeroAsset ? ' (uses hero asset)' : ''}

Render them inside the landing page in the blueprint's section order. Compose them — do not wrap in extra styling (they already consume theme tokens). You may add FAQ, LogoCloud, or other sections between them.`
}
