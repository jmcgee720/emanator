/**
 * Tests for POST /shared/:token/remix — the social-loop endpoint that clones
 * a shared preview into a new project owned by the authed user.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon'

const getAuthUserMock = jest.fn()
const checkAllowlistMock = jest.fn()
const findByTokenMock = jest.fn()
const createProjectMock = jest.fn()
const bulkInsertFilesMock = jest.fn()
const createChatMock = jest.fn()

jest.mock('../../lib/api/helpers.js', () => ({
  handleCORS: (res) => res,
  getAuthUser: (...a) => getAuthUserMock(...a),
  checkAllowlist: (...a) => checkAllowlistMock(...a),
}))

jest.mock('../../lib/supabase/db.js', () => ({
  db: {
    sharedPreviews: {
      findByToken: (...a) => findByTokenMock(...a),
      create: jest.fn(),
      findByProjectId: jest.fn(),
      incrementViews: jest.fn().mockResolvedValue(),
    },
    projects: { create: (...a) => createProjectMock(...a) },
    projectFiles: { bulkInsert: (...a) => bulkInsertFilesMock(...a) },
    chats: { create: (...a) => createChatMock(...a) },
  },
}))

const { handle } = require('../../lib/api/routes/share.js')

const fakeRequest = (body) => ({ json: async () => body || {}, url: 'https://example.com' })

beforeEach(() => {
  jest.clearAllMocks()
  getAuthUserMock.mockResolvedValue({ email: 'u@x.com' })
  checkAllowlistMock.mockResolvedValue({ id: 'user_1', email: 'u@x.com' })
})

describe('POST /shared/:token/remix', () => {
  test('401 when unauthenticated', async () => {
    getAuthUserMock.mockResolvedValue(null)
    const res = await handle('/shared/abc123/remix', 'POST', ['shared', 'abc123', 'remix'], fakeRequest())
    expect(res.status).toBe(401)
  })

  test('403 when not in allowlist', async () => {
    checkAllowlistMock.mockResolvedValue(null)
    const res = await handle('/shared/abc123/remix', 'POST', ['shared', 'abc123', 'remix'], fakeRequest())
    expect(res.status).toBe(403)
  })

  test('404 when token is unknown', async () => {
    findByTokenMock.mockResolvedValue(null)
    const res = await handle('/shared/missing/remix', 'POST', ['shared', 'missing', 'remix'], fakeRequest())
    expect(res.status).toBe(404)
  })

  test('410 when preview has expired', async () => {
    findByTokenMock.mockResolvedValue({
      id: 's1', title: 'Old app', files_snapshot: [], expires_at: new Date(Date.now() - 86400000).toISOString(),
    })
    const res = await handle('/shared/abc/remix', 'POST', ['shared', 'abc', 'remix'], fakeRequest())
    expect(res.status).toBe(410)
  })

  test('happy path: clones files into a new project + seeds a chat', async () => {
    findByTokenMock.mockResolvedValue({
      id: 's1',
      title: 'TrendyApp',
      files_snapshot: [
        { path: 'App.jsx', content: 'export default function App(){}', file_type: 'jsx' },
        { path: 'components/Navbar.jsx', content: 'export default function Navbar(){}', file_type: 'jsx' },
      ],
      expires_at: null,
    })
    createProjectMock.mockResolvedValue({ id: 'new_p_1', name: 'Remix of TrendyApp', user_id: 'user_1' })
    bulkInsertFilesMock.mockResolvedValue({ count: 2 })
    createChatMock.mockResolvedValue({ id: 'chat_1', project_id: 'new_p_1' })

    const res = await handle('/shared/abc/remix', 'POST', ['shared', 'abc', 'remix'], fakeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.project.id).toBe('new_p_1')
    expect(body.project.name).toBe('Remix of TrendyApp')
    expect(body.chat.id).toBe('chat_1')
    expect(body.file_count).toBe(2)

    // Clone files attributed to new project, not the original
    expect(bulkInsertFilesMock).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ project_id: 'new_p_1', path: 'App.jsx' }),
      expect.objectContaining({ project_id: 'new_p_1', path: 'components/Navbar.jsx' }),
    ]))
    // Original settings include remixed_from metadata
    expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user_1',
      settings: expect.objectContaining({ remixed_from: { token: 'abc', title: 'TrendyApp' } }),
    }))
  })

  test('chat creation failure does not fail the remix', async () => {
    findByTokenMock.mockResolvedValue({
      id: 's1', title: 'X', files_snapshot: [{ path: 'x.jsx', content: '' }], expires_at: null,
    })
    createProjectMock.mockResolvedValue({ id: 'new_p', name: 'Remix of X' })
    bulkInsertFilesMock.mockResolvedValue({})
    createChatMock.mockRejectedValue(new Error('db unavailable'))

    const res = await handle('/shared/abc/remix', 'POST', ['shared', 'abc', 'remix'], fakeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.chat).toBeNull()
  })
})
