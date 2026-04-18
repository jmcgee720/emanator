/**
 * Tests for /api/stats/my-builds endpoint handler.
 * Stubs the supabase + auth modules via Jest module mocks so we can exercise
 * the handler logic without real network calls.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key'

// Build a chainable query stub we can reach into per test
const queryStub = {
  _data: null,
  _error: null,
  select() { return this },
  eq() { return this },
  ilike() { return this },
  gte() { return this },
  order() { return this },
  limit() { return Promise.resolve({ data: this._data, error: this._error }) },
}

const getAuthUserMock = jest.fn()
const findByEmailMock = jest.fn()

jest.mock('../../lib/api/helpers.js', () => ({
  handleCORS: (res) => res,
  getAuthUser: (...args) => getAuthUserMock(...args),
}))

jest.mock('../../lib/supabase/db.js', () => ({
  db: {
    users: {
      findByEmail: (...args) => findByEmailMock(...args),
    },
  },
  getSupabaseAdmin: () => ({
    from: () => queryStub,
  }),
}))

const { handle } = require('../../lib/api/routes/stats.js')

beforeEach(() => {
  jest.clearAllMocks()
  queryStub._data = null
  queryStub._error = null
})

describe('GET /stats/my-builds', () => {
  test('returns 401 when unauthenticated', async () => {
    getAuthUserMock.mockResolvedValue(null)
    const res = await handle('/stats/my-builds', 'GET', '/stats/my-builds', {})
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  test('returns empty stats when dbUser missing', async () => {
    getAuthUserMock.mockResolvedValue({ email: 'x@y.com' })
    findByEmailMock.mockResolvedValue(null)
    const res = await handle('/stats/my-builds', 'GET', '/stats/my-builds', {})
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.total_this_week).toBe(0)
    expect(body.fastest_seconds).toBeNull()
    expect(body.favorite_archetype).toBeNull()
  })

  test('aggregates runs, picks fastest + favorite archetype', async () => {
    getAuthUserMock.mockResolvedValue({ email: 'x@y.com' })
    findByEmailMock.mockResolvedValue({ id: 'user-123' })
    queryStub._data = [
      { tool_mode: 'new_pipeline:saas_tool', duration: 90_000, success: true, created_at: '2026-02-20' },
      { tool_mode: 'new_pipeline:saas_tool', duration: 68_000, success: true, created_at: '2026-02-19' },
      { tool_mode: 'new_pipeline:ai_app', duration: 120_000, success: true, created_at: '2026-02-18' },
      { tool_mode: 'new_pipeline:ai_app', duration: 1000, success: false, created_at: '2026-02-17' },
    ]
    const res = await handle('/stats/my-builds', 'GET', '/stats/my-builds', {})
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.total_this_week).toBe(3)
    expect(body.fastest_seconds).toBe(68)
    expect(body.favorite_archetype.id).toBe('saas_tool')
    expect(body.favorite_archetype.count).toBe(2)
    expect(body.favorite_archetype.label).toMatch(/SaaS/i)
  })

  test('surfaces supabase error as 500', async () => {
    getAuthUserMock.mockResolvedValue({ email: 'x@y.com' })
    findByEmailMock.mockResolvedValue({ id: 'user-123' })
    queryStub._error = { message: 'db boom' }
    const res = await handle('/stats/my-builds', 'GET', '/stats/my-builds', {})
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('db boom')
  })

  test('returns null route for non-matching', async () => {
    const res = await handle('/unknown', 'GET', '/unknown', {})
    expect(res).toBeNull()
  })
})
