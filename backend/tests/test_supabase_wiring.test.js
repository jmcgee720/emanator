/**
 * Tests for the Supabase opt-in wiring in recipes + planner.
 */

import { RECIPES, recipesForWave } from '../../lib/ai/recipes.js'
import { planWaves } from '../../lib/ai/brief-planner.js'

describe('Supabase opt-in recipes', () => {
  test('default scaffold uses mock recipes', () => {
    const ids = recipesForWave('scaffold', 'saas_tool')
    expect(ids).toContain('auth_context')
    expect(ids).toContain('mock_api')
    expect(ids).not.toContain('supabase_client')
    expect(ids).not.toContain('supabase_auth_context')
    expect(ids).not.toContain('supabase_mock_api')
  })

  test('useSupabase=true swaps to supabase recipes in scaffold', () => {
    const ids = recipesForWave('scaffold', 'saas_tool', { useSupabase: true })
    expect(ids).toContain('supabase_client')
    expect(ids).toContain('supabase_auth_context')
    expect(ids).toContain('supabase_mock_api')
    expect(ids).not.toContain('auth_context')
    expect(ids).not.toContain('mock_api')
    // Still includes the other scaffold parts
    expect(ids).toContain('app_router')
    expect(ids).toContain('navbar_glass')
    expect(ids).toContain('footer_4col')
  })

  test('useSupabase does not affect non-scaffold waves', () => {
    const pub = recipesForWave('public', 'saas_tool', { useSupabase: true })
    const auth = recipesForWave('auth', 'saas_tool', { useSupabase: true })
    const app = recipesForWave('app', 'saas_tool', { useSupabase: true })
    expect(pub).toContain('landing_page')
    expect(auth).toContain('signup_form')
    expect(app).toContain('dashboard_empty_state')
    // Supabase recipes only show up in scaffold
    expect([...pub, ...auth, ...app]).not.toContain('supabase_client')
  })

  test('landing_only archetype skips supabase_client regardless of useSupabase', () => {
    const ids = recipesForWave('scaffold', 'landing_only', { useSupabase: true })
    expect(ids).not.toContain('supabase_client')
    expect(ids).not.toContain('supabase_auth_context')
    expect(ids).not.toContain('supabase_mock_api')
  })

  test('all three supabase recipes exist in RECIPES registry', () => {
    expect(RECIPES.supabase_client).toBeDefined()
    expect(RECIPES.supabase_client.file).toBe('components/supabaseClient.jsx')
    expect(RECIPES.supabase_auth_context).toBeDefined()
    expect(RECIPES.supabase_auth_context.file).toBe('components/AuthContext.jsx')
    expect(RECIPES.supabase_mock_api).toBeDefined()
    expect(RECIPES.supabase_mock_api.file).toBe('components/MockAPIProvider.jsx')
  })

  test('supabase_client recipe code is preview-safe (no hard errors)', () => {
    const code = RECIPES.supabase_client.code
    // Guards against missing SDK in preview iframe
    expect(code).toMatch(/window\.__SUPABASE_SDK__/)
    expect(code).toMatch(/export const supabase/)
    expect(code).toMatch(/export const hasSupabase/)
  })

  test('supabase_auth_context falls back to localStorage when hasSupabase=false', () => {
    const code = RECIPES.supabase_auth_context.code
    expect(code).toMatch(/import \{ supabase, hasSupabase \} from '\.\/supabaseClient'/)
    expect(code).toMatch(/if \(hasSupabase\)/)
    expect(code).toMatch(/localStorage/)  // fallback path
  })

  test('supabase_mock_api falls back to localStorage when hasSupabase=false', () => {
    const code = RECIPES.supabase_mock_api.code
    expect(code).toMatch(/import \{ supabase, hasSupabase \} from '\.\/supabaseClient'/)
    expect(code).toMatch(/supabase\.from/)
    expect(code).toMatch(/localStorage/)
  })
})

describe('planWaves — useSupabase adds supabaseClient to scaffold', () => {
  const basePlan = {
    archetypeId: 'saas_tool',
    brand: { name: 'X' },
    routes: [
      { id: 'landing', file: 'pages/Landing.jsx' },
      { id: 'signup', file: 'pages/Signup.jsx' },
      { id: 'login', file: 'pages/Login.jsx' },
      { id: 'dashboard', file: 'pages/Dashboard.jsx' },
    ],
    components: [],
    dataShapes: [],
    flows: [],
  }

  test('default plan scaffold omits supabaseClient.jsx', () => {
    const waves = planWaves({ ...basePlan, useSupabase: false })
    const scaffold = waves.find((w) => w.id === 'scaffold')
    expect(scaffold.files).not.toContain('components/supabaseClient.jsx')
  })

  test('useSupabase plan scaffold includes supabaseClient.jsx', () => {
    const waves = planWaves({ ...basePlan, useSupabase: true })
    const scaffold = waves.find((w) => w.id === 'scaffold')
    expect(scaffold.files).toContain('components/supabaseClient.jsx')
    expect(scaffold.files).toContain('components/AuthContext.jsx')
    expect(scaffold.files).toContain('components/MockAPIProvider.jsx')
  })
})
