/**
 * Plan planner + validator tests.
 * Verifies: plan generation deterministically includes archetype-required
 * routes regardless of what the LLM returns, validator catches missing routes,
 * wave ordering is correct.
 */

import {
  generatePlan,
  validatePlan,
  planWaves,
} from '../../lib/ai/brief-planner.js'
import { ARCHETYPES } from '../../lib/ai/archetypes.js'

// Mock OpenAI-compatible provider. Returns whatever we inject per test.
function makeMockProvider(chatResult) {
  return {
    chat: jest.fn().mockResolvedValue(chatResult),
  }
}

const nexsaraBrief = {
  brandName: 'Nexsara',
  projectDesc: 'An AI-powered marketing platform',
  targetAudience: 'SMB marketers',
  toneOfVoice: 'Confident, technical',
  colorDirection: 'Dark mode, violet-blue gradients',
  featuresList: ['SEO generation', 'Ad optimization', 'Email campaigns'],
  pagesList: ['Home', 'Features', 'Pricing'], // user did NOT list Sign Up
}

describe('generatePlan', () => {
  test('archetype-required routes appear even when LLM does not return them', async () => {
    // LLM returns almost nothing useful
    const provider = makeMockProvider(JSON.stringify({
      routes: [{ id: 'landing', description: 'home page' }],
      components: [],
    }))

    const plan = await generatePlan({
      brief: nexsaraBrief,
      archetype: ARCHETYPES.saas_tool,
      provider,
    })

    const routeIds = plan.routes.map((r) => r.id)
    // User did NOT list these. Archetype inference must add them.
    expect(routeIds).toContain('signup')
    expect(routeIds).toContain('login')
    expect(routeIds).toContain('dashboard')
    expect(routeIds).toContain('onboarding')
    expect(routeIds).toContain('forgot_password')
  })

  test('plan.brand is populated from brief', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    expect(plan.brand.name).toBe('Nexsara')
    expect(plan.brand.description).toContain('marketing')
  })

  test('core components (AuthContext, MockAPI, Navbar, Footer) always present', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    const compNames = plan.components.map((c) => c.name)
    expect(compNames).toContain('Navbar')
    expect(compNames).toContain('Footer')
    expect(compNames).toContain('AuthContext')
    expect(compNames).toContain('MockAPIProvider')
  })

  test('landing_only archetype skips auth components', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({
      brief: { brandName: 'Coming Soon', pagesList: [] },
      archetype: ARCHETYPES.landing_only,
      provider,
    })
    const compNames = plan.components.map((c) => c.name)
    expect(compNames).not.toContain('AuthContext')
    expect(compNames).not.toContain('MockAPIProvider')
    // Still has shared UI
    expect(compNames).toContain('Navbar')
    expect(compNames).toContain('Footer')
    // Only landing route
    expect(plan.routes.map((r) => r.id)).toEqual(['landing'])
  })

  test('LLM provider failure does not crash — plan still valid', async () => {
    const provider = { chat: jest.fn().mockRejectedValue(new Error('network')) }
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    expect(plan.routes.length).toBeGreaterThan(0)
    expect(validatePlan(plan).valid).toBe(true)
  })

  test('flows come from archetype and survive LLM noise', async () => {
    const provider = makeMockProvider(JSON.stringify({ routes: [], components: [] }))
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    expect(plan.flows.some((f) => f.id === 'signup_to_dashboard')).toBe(true)
  })

  test('waves are computed deterministically', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    const waveIds = plan.waves.map((w) => w.id)
    // Scaffold always first, app always last
    expect(waveIds[0]).toBe('scaffold')
    expect(waveIds).toContain('public')
    expect(waveIds).toContain('auth')
    expect(waveIds).toContain('app')
    // Each wave has at least one file
    plan.waves.forEach((w) => expect(w.files.length).toBeGreaterThan(0))
  })

  test('auth wave contains Signup and Login files for SaaS', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    const authWave = plan.waves.find((w) => w.id === 'auth')
    expect(authWave.files).toContain('pages/Signup.jsx')
    expect(authWave.files).toContain('pages/Login.jsx')
    expect(authWave.files).toContain('pages/ForgotPassword.jsx')
    expect(authWave.files).toContain('pages/Onboarding.jsx')
  })

  test('landing_only produces only scaffold + public waves', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({
      brief: { brandName: 'Soon', pagesList: [] },
      archetype: ARCHETYPES.landing_only,
      provider,
    })
    const waveIds = plan.waves.map((w) => w.id)
    expect(waveIds).not.toContain('auth')
    expect(waveIds).not.toContain('app')
  })
})

describe('validatePlan', () => {
  test('valid plan passes', async () => {
    const provider = makeMockProvider('{}')
    const plan = await generatePlan({ brief: nexsaraBrief, archetype: ARCHETYPES.saas_tool, provider })
    const result = validatePlan(plan)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test('plan missing required route is rejected', () => {
    const badPlan = {
      archetypeId: 'saas_tool',
      brand: { name: 'X' },
      routes: [{ id: 'landing', file: 'pages/Landing.jsx' }],
      components: [],
      flows: [],
      dataShapes: [],
      waves: [{ id: 'public', label: 'x', files: ['pages/Landing.jsx'] }],
    }
    const result = validatePlan(badPlan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /signup/.test(e))).toBe(true)
  })

  test('plan with no waves is rejected', () => {
    const result = validatePlan({
      archetypeId: 'saas_tool',
      brand: { name: 'X' },
      routes: ARCHETYPES.saas_tool.requiredRoutes.map((id) => ({ id, file: 'pages/x.jsx' })),
      waves: [],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /waves/.test(e))).toBe(true)
  })

  test('plan with unknown archetype is rejected', () => {
    const result = validatePlan({ archetypeId: 'made_up', brand: { name: 'X' }, routes: [], waves: [] })
    expect(result.valid).toBe(false)
  })

  test('null plan rejected', () => {
    expect(validatePlan(null).valid).toBe(false)
  })
})

describe('planWaves', () => {
  test('empty waves filtered out', () => {
    const waves = planWaves({ archetypeId: 'landing_only', routes: [{ id: 'landing', file: 'pages/Landing.jsx' }] })
    // Should only produce scaffold + public (auth/app are empty)
    expect(waves.length).toBeLessThanOrEqual(2)
    expect(waves.every((w) => w.files.length > 0)).toBe(true)
  })
})
