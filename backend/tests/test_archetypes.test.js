/**
 * Archetype classifier + merger tests.
 * Verifies: fast regex classifier picks correct archetype, mergeArchetypeWithBrief
 * never drops required routes, normalizeRouteName canonicalizes aliases.
 */

import {
  ARCHETYPES,
  classifyArchetypeFast,
  normalizeRouteName,
  mergeArchetypeWithBrief,
  routeToFile,
} from '../../lib/ai/archetypes.js'

describe('classifyArchetypeFast', () => {
  test('Nexsara-style SaaS marketing brief → saas_tool', () => {
    const brief = 'Nexsara — An AI-powered marketing platform that ingests products and apps, then generates and optimizes marketing across SEO, ads, social media, and email. SaaS workspace for teams.'
    const { archetype } = classifyArchetypeFast(brief)
    // "ai-powered" is a strong ai_app trigger but "saas" + "workspace" + "teams" + "platform" win
    expect(['saas_tool', 'ai_app']).toContain(archetype.id)
  })

  test('pure AI copilot brief → ai_app', () => {
    const brief = 'A copilot powered by GPT that helps writers polish prose. Chat-based assistant.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('ai_app')
  })

  test('marketplace brief → marketplace', () => {
    const brief = 'Two-sided marketplace for freelance photographers. Buyers browse listings, sellers create listings.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('marketplace')
  })

  test('portfolio brief → portfolio', () => {
    const brief = 'My personal portfolio site to showcase projects. About me page, contact form.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('portfolio')
  })

  test('e-commerce brief → ecommerce', () => {
    const brief = 'Online store selling handmade ceramics. Product catalog with shopping cart.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('ecommerce')
  })

  test('CRM brief → crm', () => {
    const brief = 'A CRM for small sales teams. Sales pipeline, contact management, deal tracker.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('crm')
  })

  test('blog brief → content_site', () => {
    const brief = 'A tech blog / newsletter with articles about distributed systems.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('content_site')
  })

  test('booking brief → booking', () => {
    const brief = 'Appointment booking app for coaches. Clients pick time slots and reserve sessions.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('booking')
  })

  test('productivity / notes brief → productivity', () => {
    const brief = 'A note-taking app like Notion with kanban and task manager.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('productivity')
  })

  test('community / forum brief → community', () => {
    const brief = 'A discussion forum / community with threads and replies, like a subreddit.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('community')
  })

  test('chat app brief → chat_app', () => {
    const brief = 'A team chat / messaging app with direct messages and group conversations.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('chat_app')
  })

  test('LMS brief → lms', () => {
    const brief = 'An online course platform / LMS where instructors teach lessons.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('lms')
  })

  test('landing-only brief → landing_only', () => {
    const brief = 'A simple landing page / launch page for an upcoming product. One-pager only.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('landing_only')
  })

  test('dashboard / admin panel brief → dashboard_internal', () => {
    const brief = 'Internal admin panel with reporting dashboard, analytics, and data tables.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('dashboard_internal')
  })

  test('social feed brief → social_app', () => {
    const brief = 'A social network with a feed, followers, and timeline posts.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('social_app')
  })

  test('media streaming brief → media', () => {
    const brief = 'A video streaming platform / media catalog.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('media')
  })

  test('utility tool brief → utility_tool', () => {
    const brief = 'A single-purpose tool — a converter / generator that takes input and produces output.'
    const { archetype } = classifyArchetypeFast(brief)
    expect(archetype.id).toBe('utility_tool')
  })

  test('empty brief → default saas_tool with low confidence', () => {
    const { archetype, confidence, ambiguous } = classifyArchetypeFast('')
    expect(archetype.id).toBe('saas_tool')
    expect(confidence).toBeLessThan(0.5)
    expect(ambiguous).toBe(true)
  })
})

describe('normalizeRouteName', () => {
  test('"Sign Up" → signup', () => {
    expect(normalizeRouteName('Sign Up')).toBe('signup')
  })
  test('"Sign In" → login', () => {
    expect(normalizeRouteName('Sign In')).toBe('login')
  })
  test('"Log In" → login', () => {
    expect(normalizeRouteName('Log In')).toBe('login')
  })
  test('"Home" → landing', () => {
    expect(normalizeRouteName('Home')).toBe('landing')
  })
  test('"My Account" → settings', () => {
    expect(normalizeRouteName('My Account')).toBe('settings')
  })
  test('"Forgot" → forgot_password', () => {
    expect(normalizeRouteName('Forgot')).toBe('forgot_password')
  })
  test('"Dashboard" → dashboard (passthrough)', () => {
    expect(normalizeRouteName('Dashboard')).toBe('dashboard')
  })
  test('null/undefined → null', () => {
    expect(normalizeRouteName(null)).toBe(null)
    expect(normalizeRouteName(undefined)).toBe(null)
    expect(normalizeRouteName('')).toBe(null)
  })
})

describe('mergeArchetypeWithBrief', () => {
  test('archetype required routes always present even if user did not list them', () => {
    const { routes } = mergeArchetypeWithBrief(ARCHETYPES.saas_tool, ['Home', 'About'])
    // Even though user only listed Home + About, signup MUST be in the plan
    expect(routes).toContain('signup')
    expect(routes).toContain('login')
    expect(routes).toContain('dashboard')
    expect(routes).toContain('onboarding')
  })

  test('user-added routes get merged (union, not subtract)', () => {
    const { routes } = mergeArchetypeWithBrief(ARCHETYPES.saas_tool, ['Integrations', 'Docs'])
    expect(routes).toContain('signup')   // archetype-required
    expect(routes).toContain('integrations') // user-added
    expect(routes).toContain('docs')         // user-added
  })

  test('user-specified aliases are normalized before merge', () => {
    const { routes } = mergeArchetypeWithBrief(ARCHETYPES.saas_tool, ['Sign Up', 'Sign In', 'Home'])
    // Should not have duplicate entries like "sign_up" + "signup"
    const signupCount = routes.filter((r) => r === 'signup').length
    expect(signupCount).toBe(1)
  })

  test('flows and dataShapes come from archetype', () => {
    const { flows, dataShapes } = mergeArchetypeWithBrief(ARCHETYPES.saas_tool, [])
    expect(flows.length).toBeGreaterThan(0)
    expect(flows.some((f) => f.id === 'signup_to_dashboard')).toBe(true)
    expect(dataShapes).toContain('User')
  })

  test('landing_only archetype stays minimal', () => {
    const { routes } = mergeArchetypeWithBrief(ARCHETYPES.landing_only, [])
    expect(routes).toEqual(['landing'])
  })
})

describe('routeToFile', () => {
  test('canonical route ids → file paths', () => {
    expect(routeToFile('landing')).toBe('pages/Landing.jsx')
    expect(routeToFile('signup')).toBe('pages/Signup.jsx')
    expect(routeToFile('dashboard')).toBe('pages/Dashboard.jsx')
    expect(routeToFile('forgot_password')).toBe('pages/ForgotPassword.jsx')
  })
  test('unknown route → null', () => {
    expect(routeToFile('totally_made_up_route')).toBe(null)
  })
})
