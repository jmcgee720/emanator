/**
 * Tests for Stripe opt-in wiring: recipes, planner, bundler.
 */

import { RECIPES, recipesForWave } from '../../lib/ai/recipes.js'
import { planWaves } from '../../lib/ai/brief-planner.js'
import { buildVercelReadyFileMap } from '../../lib/export/vercel-bundler.js'

describe('Stripe recipes', () => {
  test('stripe_client + stripe_pricing_3tier exist in registry', () => {
    expect(RECIPES.stripe_client).toBeDefined()
    expect(RECIPES.stripe_client.file).toBe('components/stripeClient.jsx')
    expect(RECIPES.stripe_pricing_3tier).toBeDefined()
    expect(RECIPES.stripe_pricing_3tier.file).toBe('pages/Pricing.jsx')
  })

  test('stripe_client is preview-safe', () => {
    const code = RECIPES.stripe_client.code
    expect(code).toMatch(/window\.__STRIPE_SDK__/)
    expect(code).toMatch(/export const getStripe/)
    expect(code).toMatch(/export const hasStripe/)
  })

  test('stripe_pricing_3tier falls back to signup when unconfigured', () => {
    const code = RECIPES.stripe_pricing_3tier.code
    expect(code).toMatch(/if \(!hasStripe\)/)
    expect(code).toMatch(/onNavigate\('signup'/)
    expect(code).toMatch(/\/api\/stripe\/checkout/)
  })
})

describe('recipesForWave with useStripe', () => {
  test('default public wave uses pricing_3tier', () => {
    expect(recipesForWave('public', 'saas_tool')).toContain('pricing_3tier')
    expect(recipesForWave('public', 'saas_tool')).not.toContain('stripe_pricing_3tier')
  })

  test('useStripe=true swaps pricing + adds stripe_client to scaffold', () => {
    const scaffold = recipesForWave('scaffold', 'saas_tool', { useStripe: true })
    const pub = recipesForWave('public', 'saas_tool', { useStripe: true })
    expect(scaffold).toContain('stripe_client')
    expect(pub).toContain('stripe_pricing_3tier')
    expect(pub).not.toContain('pricing_3tier')
  })

  test('Supabase and Stripe can coexist', () => {
    const scaffold = recipesForWave('scaffold', 'saas_tool', { useSupabase: true, useStripe: true })
    expect(scaffold).toContain('supabase_client')
    expect(scaffold).toContain('stripe_client')
    expect(scaffold).toContain('supabase_auth_context')
    expect(scaffold).toContain('supabase_mock_api')
  })
})

describe('planWaves — useStripe adds stripeClient.jsx', () => {
  const basePlan = {
    archetypeId: 'saas_tool',
    brand: { name: 'X' },
    routes: [
      { id: 'landing', file: 'pages/Landing.jsx' },
      { id: 'pricing', file: 'pages/Pricing.jsx' },
      { id: 'signup', file: 'pages/Signup.jsx' },
    ],
    components: [],
    dataShapes: [],
    flows: [],
  }

  test('default plan omits stripeClient.jsx', () => {
    const waves = planWaves({ ...basePlan, useStripe: false })
    const scaffold = waves.find((w) => w.id === 'scaffold')
    expect(scaffold.files).not.toContain('components/stripeClient.jsx')
  })

  test('useStripe plan includes stripeClient.jsx', () => {
    const waves = planWaves({ ...basePlan, useStripe: true })
    const scaffold = waves.find((w) => w.id === 'scaffold')
    expect(scaffold.files).toContain('components/stripeClient.jsx')
  })
})

describe('vercel-bundler with Stripe', () => {
  test('includes @stripe/stripe-js when settings.stripe.publishableKey is set', () => {
    const project = { id: 'p1', name: 'X', settings: { stripe: { publishableKey: 'pk_test_123' } } }
    const map = buildVercelReadyFileMap(project, [])
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.dependencies['@stripe/stripe-js']).toBeDefined()
    expect(map['.env.local.example']).toContain('VITE_STRIPE_PUBLISHABLE_KEY=pk_test_123')
    expect(map['README.md']).toContain('Stripe')
  })

  test('omits Stripe deps when no config', () => {
    const project = { id: 'p1', name: 'X', settings: {} }
    const map = buildVercelReadyFileMap(project, [])
    const pkg = JSON.parse(map['package.json'])
    expect(pkg.dependencies['@stripe/stripe-js']).toBeUndefined()
  })

  test('rewrites stripeClient.jsx to real Vite loader on export', () => {
    const project = { id: 'p1', name: 'X', settings: { stripe: { publishableKey: 'pk_test_123' } } }
    const files = [
      { path: 'components/stripeClient.jsx', content: '// preview-safe stub\nexport const hasStripe = false' },
    ]
    const map = buildVercelReadyFileMap(project, files)
    expect(map['src/components/stripeClient.jsx']).toMatch(/import \{ loadStripe \} from '@stripe\/stripe-js'/)
    expect(map['src/components/stripeClient.jsx']).toMatch(/import\.meta\.env\.VITE_STRIPE_PUBLISHABLE_KEY/)
  })

  test('both Supabase and Stripe env vars co-exist in .env.local.example', () => {
    const project = { id: 'p1', name: 'X', settings: {
      supabase: { url: 'https://x.supabase.co', anonKey: 'anon' },
      stripe: { publishableKey: 'pk_test_ok' },
    } }
    const map = buildVercelReadyFileMap(project, [])
    expect(map['.env.local.example']).toContain('VITE_SUPABASE_URL')
    expect(map['.env.local.example']).toContain('VITE_STRIPE_PUBLISHABLE_KEY')
  })
})
