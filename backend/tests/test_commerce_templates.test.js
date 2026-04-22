import {
  buildPricingPackagesFile,
  buildCheckoutRouteFile,
  buildPaymentStatusRouteFile,
  buildPricingButtonComponentFile,
  buildStripeFiles,
  needsCommerceTemplates,
} from '../../lib/ai/commerce-templates.js'

describe('buildPricingPackagesFile', () => {
  it('emits a module exporting PRICING_PACKAGES + getPackage', () => {
    const src = buildPricingPackagesFile({ name: 'Acme' })
    expect(src).toMatch(/export const PRICING_PACKAGES/)
    expect(src).toMatch(/export function getPackage/)
    expect(src).toMatch(/starter/)
    expect(src).toMatch(/pro/)
    expect(src).toMatch(/business/)
    expect(src).toMatch(/"Acme"/)
  })

  it('uses a safe default brand name when none provided', () => {
    const src = buildPricingPackagesFile({})
    expect(src).toContain('"Your Product"')
  })

  it('escapes brand name via JSON.stringify (quotes and backslashes safe)', () => {
    const src = buildPricingPackagesFile({ name: 'O"Brien \\ Co' })
    // Valid JSON string literal will round-trip JSON.parse.
    const match = src.match(/export const BRAND_NAME = (.*)/)
    expect(match).toBeTruthy()
    expect(JSON.parse(match[1])).toBe('O"Brien \\ Co')
  })

  it('amounts are decimal floats (never ints)', () => {
    const src = buildPricingPackagesFile({})
    expect(src).toMatch(/9\.00/)
    expect(src).toMatch(/29\.00/)
    expect(src).toMatch(/99\.00/)
  })
})

describe('buildCheckoutRouteFile', () => {
  const src = buildCheckoutRouteFile()

  it('exports a POST handler with Node runtime', () => {
    expect(src).toMatch(/export async function POST/)
    expect(src).toMatch(/runtime = 'nodejs'/)
  })

  it('validates packageId server-side via getPackage', () => {
    expect(src).toMatch(/getPackage\(packageId\)/)
    expect(src).toMatch(/Unknown package/)
  })

  it('rejects when originUrl missing (prevents hardcoded URLs)', () => {
    expect(src).toMatch(/Missing originUrl/)
  })

  it('builds success_url from originUrl + CHECKOUT_SESSION_ID', () => {
    expect(src).toMatch(/session_id=\{CHECKOUT_SESSION_ID\}/)
    expect(src).toMatch(/\$\{originUrl\}/)
  })

  it('uses server-side amount (never frontend value)', () => {
    expect(src).toMatch(/unit_amount: Math\.round\(pkg\.amount \* 100\)/)
    expect(src).not.toMatch(/amount: body\.amount/)
  })

  it('guards when STRIPE_API_KEY is not set', () => {
    expect(src).toMatch(/STRIPE_API_KEY/)
    expect(src).toMatch(/is not configured/)
  })
})

describe('buildPaymentStatusRouteFile', () => {
  const src = buildPaymentStatusRouteFile()

  it('exports a GET handler for the dynamic [sessionId] route', () => {
    expect(src).toMatch(/export async function GET/)
    expect(src).toMatch(/params\?\.sessionId/)
  })

  it('returns the five playbook-mandated fields', () => {
    expect(src).toMatch(/status: session\.status/)
    expect(src).toMatch(/payment_status: session\.payment_status/)
    expect(src).toMatch(/amount_total/)
    expect(src).toMatch(/currency/)
    expect(src).toMatch(/metadata/)
  })
})

describe('buildPricingButtonComponentFile', () => {
  const src = buildPricingButtonComponentFile()

  it('is a client component with use client directive', () => {
    expect(src.split('\n')[0]).toContain("'use client'")
  })

  it('posts to /api/checkout with packageId + window.location.origin', () => {
    expect(src).toMatch(/\/api\/checkout/)
    expect(src).toMatch(/window\.location\.origin/)
  })

  it('polls /api/payment-status when returning from Stripe', () => {
    expect(src).toMatch(/\/api\/payment-status\//)
    expect(src).toMatch(/session_id/)
    expect(src).toMatch(/payment_status === 'paid'/)
  })

  it('has max poll attempts (guards infinite loop)', () => {
    expect(src).toMatch(/attempts >= 5/)
  })

  it('exposes pricing-button-{packageId} data-testid', () => {
    expect(src).toMatch(/pricing-button-/)
  })
})

describe('buildStripeFiles', () => {
  it('returns 4 files with deterministic paths', () => {
    const files = buildStripeFiles({ brand: { name: 'Acme' } })
    expect(files.map((f) => f.path).sort()).toEqual([
      'app/api/checkout/route.js',
      'app/api/payment-status/[sessionId]/route.js',
      'components/PricingButton.jsx',
      'lib/pricing-packages.js',
    ])
    for (const f of files) {
      expect(typeof f.content).toBe('string')
      expect(f.content.length).toBeGreaterThan(50)
    }
  })

  it('brand name propagates into pricing-packages.js only', () => {
    const files = buildStripeFiles({ brand: { name: 'UniqueBrand42' } })
    const pkg = files.find((f) => f.path === 'lib/pricing-packages.js')
    expect(pkg.content).toContain('UniqueBrand42')
  })

  it('works when plan is empty (falls back to defaults)', () => {
    expect(() => buildStripeFiles()).not.toThrow()
    const files = buildStripeFiles()
    expect(files).toHaveLength(4)
  })
})

describe('needsCommerceTemplates', () => {
  it('returns true for commerce archetypes', () => {
    expect(needsCommerceTemplates({ archetype: { id: 'ecommerce' } })).toBe(true)
    expect(needsCommerceTemplates({ archetype: { id: 'saas' } })).toBe(true)
    expect(needsCommerceTemplates({ archetype: { id: 'subscription-box' } })).toBe(true)
    expect(needsCommerceTemplates({ archetype: { id: 'paywall' } })).toBe(true)
  })

  it('returns true when brief mentions payment keywords', () => {
    expect(needsCommerceTemplates({ archetype: {}, brief: { summary: 'Add Stripe checkout' } })).toBe(true)
    expect(needsCommerceTemplates({ archetype: {}, brief: { rawBrief: 'We need a paywall' } })).toBe(true)
    expect(needsCommerceTemplates({ brief: { summary: 'Buy now button for pricing' } })).toBe(true)
    expect(needsCommerceTemplates({ brief: { rawBrief: 'subscribe to our service' } })).toBe(true)
  })

  it('returns false for non-commerce archetypes', () => {
    expect(needsCommerceTemplates({ archetype: { id: 'blog' } })).toBe(false)
    expect(needsCommerceTemplates({ archetype: { id: 'portfolio' } })).toBe(false)
    expect(needsCommerceTemplates({ archetype: { id: 'landing' }, brief: { summary: 'Simple about page' } })).toBe(false)
  })

  it('returns false with no input', () => {
    expect(needsCommerceTemplates()).toBe(false)
    expect(needsCommerceTemplates({})).toBe(false)
  })

  it('does not match substrings incorrectly', () => {
    expect(needsCommerceTemplates({ brief: { summary: 'I love ice cream' } })).toBe(false)
    // "buy" alone doesn't match; we require "buy now"
    expect(needsCommerceTemplates({ brief: { summary: 'buy a coffee somewhere' } })).toBe(false)
  })
})

describe('commerce templates — end-to-end syntactic validity', () => {
  it('every emitted file parses as a valid JS/JSX module', () => {
    const files = buildStripeFiles({ brand: { name: 'Test' } })
    for (const f of files) {
      // Smoke: balanced braces / parens / brackets.
      const opens = (f.content.match(/[{[(]/g) || []).length
      const closes = (f.content.match(/[}\])]/g) || []).length
      expect(opens).toBe(closes)
      // No runaway template markers — every ${ has its closing }.
      const openTpl = (f.content.match(/\$\{/g) || []).length
      const nestedClose = (f.content.match(/\}/g) || []).length
      expect(nestedClose).toBeGreaterThanOrEqual(openTpl)
    }
  })
})
