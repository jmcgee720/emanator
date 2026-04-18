/**
 * Tests for snapshot routes: create, list, restore, delete.
 * Also verifies the pre-restore safety-snapshot behavior.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon'

const getAuthUserMock = jest.fn()
const listSnapshotsMock = jest.fn()
const findSnapshotMock = jest.fn()
const createSnapshotMock = jest.fn()
const deleteSnapshotMock = jest.fn()
const findFilesMock = jest.fn()
const findCanvasMock = jest.fn()
const deleteFilesMock = jest.fn()
const bulkInsertFilesMock = jest.fn()
const updateCanvasMock = jest.fn()

jest.mock('../../lib/api/helpers.js', () => ({
  handleCORS: (res) => res,
  getAuthUser: (...args) => getAuthUserMock(...args),
}))

jest.mock('../../lib/supabase/db.js', () => ({
  db: {
    snapshots: {
      findByProjectId: (...a) => listSnapshotsMock(...a),
      findById: (...a) => findSnapshotMock(...a),
      create: (...a) => createSnapshotMock(...a),
      delete: (...a) => deleteSnapshotMock(...a),
    },
    projectFiles: {
      findByProjectId: (...a) => findFilesMock(...a),
      deleteByProjectId: (...a) => deleteFilesMock(...a),
      bulkInsert: (...a) => bulkInsertFilesMock(...a),
    },
    projectCanvas: {
      findByProjectId: (...a) => findCanvasMock(...a),
      update: (...a) => updateCanvasMock(...a),
    },
  },
}))

const { handle } = require('../../lib/api/routes/snapshots.js')

const fakeRequest = (body) => ({
  json: async () => body || {},
  url: 'https://example.com',
})

beforeEach(() => {
  jest.clearAllMocks()
  getAuthUserMock.mockResolvedValue({ email: 'u@x.com' })
})

describe('GET /projects/:id/snapshots', () => {
  test('returns 401 when unauthenticated', async () => {
    getAuthUserMock.mockResolvedValue(null)
    const res = await handle('/projects/p_1/snapshots', 'GET', ['projects', 'p_1', 'snapshots'], fakeRequest())
    expect(res.status).toBe(401)
  })

  test('returns snapshot list', async () => {
    listSnapshotsMock.mockResolvedValue([
      { id: 's_2', name: 'Build · 2026-02-18 15:00 · CoolApp', created_at: '2026-02-18T15:00:00Z' },
      { id: 's_1', name: 'Build · 2026-02-18 14:00 · CoolApp', created_at: '2026-02-18T14:00:00Z' },
    ])
    const res = await handle('/projects/p_1/snapshots', 'GET', ['projects', 'p_1', 'snapshots'], fakeRequest())
    const body = await res.json()
    expect(body.length).toBe(2)
    expect(body[0].id).toBe('s_2')
  })
})

describe('POST /projects/:id/snapshots', () => {
  test('requires name', async () => {
    const res = await handle('/projects/p_1/snapshots', 'POST', ['projects', 'p_1', 'snapshots'], fakeRequest({}))
    expect(res.status).toBe(400)
  })

  test('creates snapshot with files', async () => {
    findFilesMock.mockResolvedValue([{ path: 'App.jsx', content: 'x', file_type: 'jsx' }])
    findCanvasMock.mockResolvedValue(null)
    createSnapshotMock.mockResolvedValue({ id: 's_new', name: 'Manual save', created_at: '2026-02-18' })
    const res = await handle('/projects/p_1/snapshots', 'POST', ['projects', 'p_1', 'snapshots'], fakeRequest({ name: 'Manual save' }))
    expect(res.status).toBe(201)
    expect(createSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p_1',
      name: 'Manual save',
      files_snapshot: [{ path: 'App.jsx', content: 'x', file_type: 'jsx' }],
    }))
  })
})

describe('POST /snapshots/:id/restore', () => {
  test('404 when snapshot missing', async () => {
    findSnapshotMock.mockResolvedValue(null)
    const res = await handle('/snapshots/s_missing/restore', 'POST', ['snapshots', 's_missing', 'restore'], fakeRequest())
    expect(res.status).toBe(404)
  })

  test('creates pre-restore safety snapshot, then restores', async () => {
    findSnapshotMock.mockResolvedValue({
      id: 's_old',
      project_id: 'p_1',
      files_snapshot: [{ path: 'App.jsx', content: 'old', file_type: 'jsx' }],
      canvas_snapshot: null,
    })
    // Current files exist — should trigger pre-restore snap
    findFilesMock.mockResolvedValue([{ path: 'App.jsx', content: 'current', file_type: 'jsx' }])
    createSnapshotMock.mockResolvedValue({ id: 's_pre', name: 'Pre-restore' })
    bulkInsertFilesMock.mockResolvedValue({ count: 1 })

    const res = await handle('/snapshots/s_old/restore', 'POST', ['snapshots', 's_old', 'restore'], fakeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.restored_files).toBe(1)

    // Assert safety snapshot was created before file delete
    expect(createSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p_1',
      metadata: expect.objectContaining({ kind: 'pre_restore', restored_from: 's_old' }),
    }))
    // Current files deleted
    expect(deleteFilesMock).toHaveBeenCalledWith('p_1')
    // Snapshot's files inserted
    expect(bulkInsertFilesMock).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ path: 'App.jsx', content: 'old', restored_from: 's_old' }),
    ]))
  })

  test('skips pre-restore when no current files', async () => {
    findSnapshotMock.mockResolvedValue({
      id: 's_1', project_id: 'p_1',
      files_snapshot: [{ path: 'x.jsx', content: 'x', file_type: 'jsx' }],
      canvas_snapshot: null,
    })
    findFilesMock.mockResolvedValue([])
    bulkInsertFilesMock.mockResolvedValue({})

    const res = await handle('/snapshots/s_1/restore', 'POST', ['snapshots', 's_1', 'restore'], fakeRequest())
    expect(res.status).toBe(200)
    // createSnapshot should NOT be called when there are no current files
    expect(createSnapshotMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /snapshots/:id', () => {
  test('404 when not found', async () => {
    findSnapshotMock.mockResolvedValue(null)
    const res = await handle('/snapshots/s_gone', 'DELETE', ['snapshots', 's_gone'], fakeRequest())
    expect(res.status).toBe(404)
  })

  test('deletes snapshot', async () => {
    findSnapshotMock.mockResolvedValue({ id: 's_1', project_id: 'p_1' })
    deleteSnapshotMock.mockResolvedValue({ success: true })
    const res = await handle('/snapshots/s_1', 'DELETE', ['snapshots', 's_1'], fakeRequest())
    expect(res.status).toBe(200)
    expect(deleteSnapshotMock).toHaveBeenCalledWith('s_1')
  })

  test('401 when unauthenticated', async () => {
    getAuthUserMock.mockResolvedValue(null)
    const res = await handle('/snapshots/s_1', 'DELETE', ['snapshots', 's_1'], fakeRequest())
    expect(res.status).toBe(401)
  })
})
