import { createAutoSnapshot } from '../../lib/ai/pipeline/auto-snapshot.js'

function mockDb({ files = [{ path: 'x.jsx', content: 'x', file_type: 'jsx' }], throwOnFind = false, throwOnCreate = false } = {}) {
  return {
    projectFiles: {
      findByProjectId: jest.fn().mockImplementation(() => {
        if (throwOnFind) throw new Error('db find fail')
        return Promise.resolve(files)
      }),
    },
    snapshots: {
      create: jest.fn().mockImplementation((snap) => {
        if (throwOnCreate) throw new Error('snap create fail')
        return Promise.resolve({ ...snap, id: 'snap-1' })
      }),
    },
  }
}

describe('createAutoSnapshot', () => {
  it('creates a snapshot when files exist', async () => {
    const db = mockDb()
    const result = await createAutoSnapshot({
      db, projectId: 'p1',
      brief: { summary: 'Build a landing page' },
      plan: { brand: { name: 'Acme' }, waves: [{}, {}, {}] },
      archetype: { id: 'landing' },
      runId: 'r1',
    })
    expect(result.created).toBe(true)
    expect(result.name).toMatch(/^Build ·/)
    expect(result.name).toContain('Build a landing page')
    expect(db.snapshots.create).toHaveBeenCalledTimes(1)

    const call = db.snapshots.create.mock.calls[0][0]
    expect(call.project_id).toBe('p1')
    expect(call.files_snapshot).toHaveLength(1)
    expect(call.metadata).toEqual(expect.objectContaining({
      kind: 'auto_build',
      run_id: 'r1',
      archetype: 'landing',
      brand: 'Acme',
      waves: 3,
      file_count: 1,
    }))
  })

  it('falls back to plan.brand.name when brief is empty', async () => {
    const db = mockDb()
    const result = await createAutoSnapshot({
      db, projectId: 'p1',
      brief: {},
      plan: { brand: { name: 'MyBrand' } },
      archetype: { id: 'saas' },
      runId: 'r2',
    })
    expect(result.created).toBe(true)
    expect(result.name).toContain('MyBrand')
  })

  it('uses "build" as final fallback title', async () => {
    const db = mockDb()
    const result = await createAutoSnapshot({
      db, projectId: 'p1',
      brief: {},
      plan: {},
      archetype: {},
      runId: 'r3',
    })
    expect(result.created).toBe(true)
    expect(result.name).toContain('build')
  })

  it('truncates long brief text to 60 chars', async () => {
    const db = mockDb()
    const long = 'x'.repeat(200)
    await createAutoSnapshot({
      db, projectId: 'p1',
      brief: { summary: long },
      plan: { brand: { name: 'b' } },
      archetype: {},
      runId: 'r4',
    })
    const call = db.snapshots.create.mock.calls[0][0]
    const trimmed = call.name.split('·').pop().trim()
    expect(trimmed.length).toBeLessThanOrEqual(60)
  })

  it('returns {created:false} when no files exist', async () => {
    const db = mockDb({ files: [] })
    const result = await createAutoSnapshot({
      db, projectId: 'p1', brief: {}, plan: {}, archetype: {}, runId: 'r',
    })
    expect(result).toEqual({ created: false })
    expect(db.snapshots.create).not.toHaveBeenCalled()
  })

  it('returns {created:false} when db.find fails (not fatal)', async () => {
    const db = mockDb({ throwOnFind: true })
    const result = await createAutoSnapshot({
      db, projectId: 'p1', brief: {}, plan: {}, archetype: {}, runId: 'r',
    })
    expect(result).toEqual({ created: false })
  })

  it('returns {created:false} when snapshot.create fails (not fatal)', async () => {
    const db = mockDb({ throwOnCreate: true })
    const result = await createAutoSnapshot({
      db, projectId: 'p1', brief: { summary: 'x' }, plan: {}, archetype: {}, runId: 'r',
    })
    expect(result).toEqual({ created: false })
  })

  it('falls back to brief.rawBrief when summary is missing', async () => {
    const db = mockDb()
    const result = await createAutoSnapshot({
      db, projectId: 'p1',
      brief: { rawBrief: 'my raw brief here' },
      plan: { brand: { name: 'b' } },
      archetype: {}, runId: 'r',
    })
    expect(result.name).toContain('my raw brief here')
  })
})
