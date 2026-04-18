/**
 * Tests for the /gallery, /publish, /unpublish routes.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon'

const getAuthUserMock = jest.fn()
const checkAllowlistMock = jest.fn()
const findProjectMock = jest.fn()
const findPublicMock = jest.fn()
const updateProjectMock = jest.fn()
const findFilesMock = jest.fn()
const findSharesMock = jest.fn()
const createShareMock = jest.fn()

jest.mock('../../lib/api/helpers.js', () => ({
  handleCORS: (res) => res,
  getAuthUser: (...a) => getAuthUserMock(...a),
  checkAllowlist: (...a) => checkAllowlistMock(...a),
}))

jest.mock('../../lib/supabase/db.js', () => ({
  db: {
    projects: {
      findById: (...a) => findProjectMock(...a),
      findPublic: (...a) => findPublicMock(...a),
      update: (...a) => updateProjectMock(...a),
    },
    projectFiles: { findByProjectId: (...a) => findFilesMock(...a) },
    sharedPreviews: {
      findByProjectId: (...a) => findSharesMock(...a),
      create: (...a) => createShareMock(...a),
    },
  },
}))

const { handle } = require('../../lib/api/routes/gallery.js')

const fakeRequest = (body = null, urlSuffix = '') => ({
  json: async () => body || {},
  url: 'https://example.com/api/gallery' + urlSuffix,
})

beforeEach(() => {
  jest.clearAllMocks()
  getAuthUserMock.mockResolvedValue({ email: 'u@x.com' })
  checkAllowlistMock.mockResolvedValue({ id: 'user_1', email: 'u@x.com' })
})

describe('GET /gallery', () => {
  test('returns empty when no public projects', async () => {
    findPublicMock.mockResolvedValue([])
    const res = await handle('/gallery', 'GET', ['gallery'], fakeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.count).toBe(0)
  })

  test('filters out projects without a share token', async () => {
    findPublicMock.mockResolvedValue([
      { id: 'p1', name: 'With Share', description: '', user_id: 'u1', settings: {}, updated_at: '2026-02-18' },
      { id: 'p2', name: 'No Share', description: '', user_id: 'u1', settings: {}, updated_at: '2026-02-18' },
    ])
    findSharesMock.mockImplementation(async (id) => id === 'p1'
      ? [{ share_token: 'tok1', views: 5, expires_at: null }]
      : []
    )
    const res = await handle('/gallery', 'GET', ['gallery'], fakeRequest())
    const body = await res.json()
    expect(body.items.length).toBe(1)
    expect(body.items[0].id).toBe('p1')
    expect(body.items[0].share_token).toBe('tok1')
    expect(body.items[0].views).toBe(5)
  })

  test('filters expired share tokens', async () => {
    findPublicMock.mockResolvedValue([
      { id: 'p1', name: 'Expired', settings: {}, updated_at: '2026-02-18' },
    ])
    findSharesMock.mockResolvedValue([
      { share_token: 'old', views: 99, expires_at: new Date(Date.now() - 1000).toISOString() },
    ])
    const res = await handle('/gallery', 'GET', ['gallery'], fakeRequest())
    const body = await res.json()
    expect(body.items.length).toBe(0)
  })

  test('respects limit query param (capped at 60)', async () => {
    findPublicMock.mockResolvedValue([])
    await handle('/gallery', 'GET', ['gallery'], fakeRequest(null, '?limit=100'))
    expect(findPublicMock).toHaveBeenCalledWith({ limit: 60, offset: 0 })
  })

  test('respects offset param', async () => {
    findPublicMock.mockResolvedValue([])
    await handle('/gallery', 'GET', ['gallery'], fakeRequest(null, '?limit=10&offset=20'))
    expect(findPublicMock).toHaveBeenCalledWith({ limit: 10, offset: 20 })
  })
})

describe('POST /projects/:id/publish', () => {
  test('401 when unauthenticated', async () => {
    getAuthUserMock.mockResolvedValue(null)
    const res = await handle('/projects/p1/publish', 'POST', ['projects', 'p1', 'publish'], fakeRequest())
    expect(res.status).toBe(401)
  })

  test('404 when project missing', async () => {
    findProjectMock.mockResolvedValue(null)
    const res = await handle('/projects/p1/publish', 'POST', ['projects', 'p1', 'publish'], fakeRequest())
    expect(res.status).toBe(404)
  })

  test('403 when project not owned by auth user', async () => {
    findProjectMock.mockResolvedValue({ id: 'p1', user_id: 'someone-else', settings: {} })
    const res = await handle('/projects/p1/publish', 'POST', ['projects', 'p1', 'publish'], fakeRequest())
    expect(res.status).toBe(403)
  })

  test('400 when project has no files', async () => {
    findProjectMock.mockResolvedValue({ id: 'p1', user_id: 'user_1', settings: {}, name: 'X' })
    findFilesMock.mockResolvedValue([])
    const res = await handle('/projects/p1/publish', 'POST', ['projects', 'p1', 'publish'], fakeRequest())
    expect(res.status).toBe(400)
  })

  test('happy path: mints new share token + sets is_public', async () => {
    findProjectMock.mockResolvedValue({ id: 'p1', user_id: 'user_1', name: 'X', settings: {} })
    findFilesMock.mockResolvedValue([{ path: 'App.jsx', content: 'x', file_type: 'jsx' }])
    findSharesMock.mockResolvedValue([])
    createShareMock.mockResolvedValue({ share_token: 'generated' })
    updateProjectMock.mockImplementation(async (id, updates) => ({ id, ...updates }))

    const res = await handle('/projects/p1/publish', 'POST', ['projects', 'p1', 'publish'], fakeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.share_token).toBeTruthy()
    expect(createShareMock).toHaveBeenCalled()
    expect(updateProjectMock).toHaveBeenCalledWith('p1', expect.objectContaining({
      settings: expect.objectContaining({ is_public: true, published_at: expect.any(String) }),
    }))
  })

  test('reuses existing never-expiring share token', async () => {
    findProjectMock.mockResolvedValue({ id: 'p1', user_id: 'user_1', name: 'X', settings: {} })
    findFilesMock.mockResolvedValue([{ path: 'App.jsx', content: 'x', file_type: 'jsx' }])
    findSharesMock.mockResolvedValue([{ share_token: 'existing_token', expires_at: null }])
    updateProjectMock.mockImplementation(async (id, updates) => ({ id, ...updates }))

    const res = await handle('/projects/p1/publish', 'POST', ['projects', 'p1', 'publish'], fakeRequest())
    const body = await res.json()
    expect(body.share_token).toBe('existing_token')
    expect(createShareMock).not.toHaveBeenCalled()
  })
})

describe('POST /projects/:id/unpublish', () => {
  test('removes is_public from settings', async () => {
    findProjectMock.mockResolvedValue({
      id: 'p1', user_id: 'user_1', settings: { is_public: true, published_at: '2026-02-18', other: 'keep' },
    })
    updateProjectMock.mockImplementation(async (id, updates) => ({ id, ...updates }))

    const res = await handle('/projects/p1/unpublish', 'POST', ['projects', 'p1', 'unpublish'], fakeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)

    const [, updates] = updateProjectMock.mock.calls[0]
    expect(updates.settings.is_public).toBeUndefined()
    expect(updates.settings.published_at).toBeUndefined()
    expect(updates.settings.other).toBe('keep')
  })

  test('403 when project not owned', async () => {
    findProjectMock.mockResolvedValue({ id: 'p1', user_id: 'someone-else', settings: { is_public: true } })
    const res = await handle('/projects/p1/unpublish', 'POST', ['projects', 'p1', 'unpublish'], fakeRequest())
    expect(res.status).toBe(403)
  })
})
