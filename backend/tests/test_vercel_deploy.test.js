/**
 * Tests for the Vercel deploy route handler (POST /projects/:id/deploy/vercel).
 * Mocks db + global fetch; exercises the full happy-path + error handling.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon'

const mockProject = { id: 'p_1', name: 'CoolApp', settings: {} }
const mockFiles = [
  { path: 'App.jsx', content: 'export default function App() { return null }' },
  { path: 'components/Navbar.jsx', content: 'export default function Navbar() { return null }' },
]

const getAuthUserMock = jest.fn()
const checkAllowlistMock = jest.fn()
const findProjectMock = jest.fn()
const findFilesMock = jest.fn()
const updateProjectMock = jest.fn()
const createDeploymentMock = jest.fn()

jest.mock('../../lib/api/helpers.js', () => ({
  handleCORS: (res) => res,
  getAuthUser: (...args) => getAuthUserMock(...args),
  checkAllowlist: (...args) => checkAllowlistMock(...args),
}))

jest.mock('../../lib/supabase/db.js', () => ({
  db: {
    projects: {
      findById: (...args) => findProjectMock(...args),
      update: (...args) => updateProjectMock(...args),
    },
    projectFiles: {
      findByProjectId: (...args) => findFilesMock(...args),
    },
    deployments: {
      create: (...args) => createDeploymentMock(...args),
      findByProjectId: async () => [],
    },
  },
}))

const { handle } = require('../../lib/api/routes/deployments.js')

const fakeRequest = (body) => ({
  json: async () => body,
  url: 'https://example.com',
  headers: new Map(),
})

describe('POST /projects/:id/deploy/vercel', () => {
  let originalFetch
  beforeEach(() => {
    jest.clearAllMocks()
    originalFetch = global.fetch
    getAuthUserMock.mockResolvedValue({ email: 'u@x.com' })
    checkAllowlistMock.mockResolvedValue({ id: 'user_1', email: 'u@x.com' })
    findProjectMock.mockResolvedValue(mockProject)
    findFilesMock.mockResolvedValue(mockFiles)
    createDeploymentMock.mockResolvedValue({ id: 'dep_db_1' })
    updateProjectMock.mockResolvedValue({ ...mockProject })
  })
  afterEach(() => { global.fetch = originalFetch })

  test('returns 401 when unauthenticated', async () => {
    getAuthUserMock.mockResolvedValue(null)
    const res = await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 't' }))
    expect(res.status).toBe(401)
  })

  test('returns 400 when token is missing', async () => {
    const res = await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({}))
    expect(res.status).toBe(400)
  })

  test('returns 404 when project has no files', async () => {
    findFilesMock.mockResolvedValue([])
    const res = await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 't' }))
    expect(res.status).toBe(404)
  })

  test('happy path: calls Vercel API with Vercel-ready file map + framework=vite', async () => {
    let capturedBody = null
    global.fetch = jest.fn(async (url, opts) => {
      capturedBody = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'dep_vercel_1', url: 'coolapp-xyz.vercel.app', readyState: 'QUEUED' }),
      }
    })
    const res = await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 'my-token', projectName: 'CoolApp' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.url).toBe('https://coolapp-xyz.vercel.app')
    expect(body.deployment_id).toBe('dep_vercel_1')
    expect(body.status).toBe('QUEUED')

    // Verify Vercel API call shape
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v13/deployments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
          'Content-Type': 'application/json',
        }),
      })
    )

    expect(capturedBody).toBeTruthy()
    expect(capturedBody.projectSettings.framework).toBe('vite')
    expect(capturedBody.projectSettings.buildCommand).toBe('npm run build')
    expect(capturedBody.projectSettings.outputDirectory).toBe('dist')
    expect(capturedBody.name).toBe('coolapp')

    // File map must include scaffolded project files + original source
    const filePaths = capturedBody.files.map((f) => f.file)
    expect(filePaths).toContain('package.json')
    expect(filePaths).toContain('vite.config.js')
    expect(filePaths).toContain('index.html')
    expect(filePaths).toContain('src/main.jsx')
    expect(filePaths).toContain('src/App.jsx')
    expect(filePaths).toContain('src/components/Navbar.jsx')

    // All files should be base64-encoded
    capturedBody.files.forEach((f) => {
      expect(f.encoding).toBe('base64')
      expect(() => Buffer.from(f.data, 'base64')).not.toThrow()
    })
  })

  test('surfaces Vercel API error', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Forbidden', code: 'forbidden' } }),
    }))
    const res = await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 't' }))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(body.code).toBe('forbidden')
  })

  test('saveToken=true persists token into project.settings.vercel', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'dep_1', url: 'x.vercel.app', readyState: 'QUEUED' }),
    }))
    await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 'secret-123', saveToken: true }))
    expect(updateProjectMock).toHaveBeenCalledWith('p_1', expect.objectContaining({
      settings: expect.objectContaining({
        vercel: expect.objectContaining({ token: 'secret-123', savedAt: expect.any(String) }),
      }),
    }))
  })

  test('saveToken=false (default) does NOT persist token', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'dep_1', url: 'x.vercel.app', readyState: 'QUEUED' }),
    }))
    await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 'secret-123' }))
    expect(updateProjectMock).not.toHaveBeenCalled()
  })

  test('sanitizes project name for Vercel (lowercase, alphanumeric+hyphen)', async () => {
    let capturedBody = null
    global.fetch = jest.fn(async (url, opts) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, status: 200, json: async () => ({ id: 'd', url: 'x.vercel.app', readyState: 'QUEUED' }) }
    })
    await handle('/projects/p_1/deploy/vercel', 'POST', '/projects/p_1/deploy/vercel', fakeRequest({ token: 't', projectName: 'Cool App!! 2026' }))
    expect(capturedBody.name).toBe('cool-app-2026')
  })
})
