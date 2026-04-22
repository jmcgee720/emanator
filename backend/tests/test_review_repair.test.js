/**
 * Tests for the extracted review + repair chain (Steps 5+5b).
 * Covers the three control paths: review OK (no repair), review
 * non-OK (repair runs), post-repair safety net, error fault tolerance.
 */

import { runReviewAndRepair } from '../../lib/ai/pipeline/review-repair.js'

async function drain(gen) {
  const events = []
  let result
  while (true) {
    const next = await gen.next()
    if (next.done) { result = next.value; break }
    events.push(next.value)
  }
  return { events, result }
}

function mockDb(files = []) {
  return {
    projectFiles: {
      findByProjectId: jest.fn().mockResolvedValue(files),
    },
  }
}

function mockAi() {
  const saved = []
  return {
    provider: { name: 'test' },
    saveFiles: jest.fn().mockImplementation(async (pid, files) => {
      saved.push(...files)
      return files
    }),
    _saved: saved,
  }
}

function makeDeps(overrides = {}) {
  return {
    reviewBuild: jest.fn().mockResolvedValue({ ok: true, missing: [], broken: [] }),
    repairBuild: jest.fn(),
    runPostRepair: jest.fn().mockReturnValue({ updates: [], modifiedPaths: [] }),
    ...overrides,
  }
}

describe('runReviewAndRepair — no-op path', () => {
  it('returns null + yields nothing when allSavedFiles is empty', async () => {
    const deps = makeDeps()
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { events, result } = await drain(gen)
    expect(events).toEqual([])
    expect(result.reviewResult).toBeNull()
    expect(deps.reviewBuild).not.toHaveBeenCalled()
  })

  it('returns null when allSavedFiles is not an array', async () => {
    const deps = makeDeps()
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: null,
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { result } = await drain(gen)
    expect(result.reviewResult).toBeNull()
  })
})

describe('runReviewAndRepair — review OK path', () => {
  it('emits reviewing status + review_result, does NOT invoke repair', async () => {
    const deps = makeDeps({
      reviewBuild: jest.fn().mockResolvedValue({ ok: true, missing: [], broken: [] }),
    })
    const gen = runReviewAndRepair({
      plan: { imageAssets: [] },
      allSavedFiles: [{ path: 'app/page.jsx' }],
      projectId: 'p1',
      db: mockDb([{ path: 'app/page.jsx', content: 'page' }]),
      aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { events, result } = await drain(gen)
    expect(events.some((e) => e.event === 'status' && e.data.stage === 'reviewing')).toBe(true)
    expect(events.some((e) => e.event === 'review_result')).toBe(true)
    expect(events.some((e) => e.event === 'status' && e.data.stage === 'repairing')).toBe(false)
    expect(deps.repairBuild).not.toHaveBeenCalled()
    expect(result.reviewResult.ok).toBe(true)
  })
})

describe('runReviewAndRepair — review non-OK path', () => {
  it('runs repair generator when review flags missing/broken', async () => {
    const reviewResult = { ok: false, missing: ['/signup'], broken: ['x.jsx: typo'] }
    const deps = makeDeps({
      reviewBuild: jest.fn().mockResolvedValue(reviewResult),
      repairBuild: jest.fn().mockImplementation(() => (async function* () {
        yield { event: 'repair_progress', data: { step: 1 } }
        return { filesRepaired: [{ path: 'x.jsx' }] }
      })()),
    })
    const gen = runReviewAndRepair({
      plan: { imageAssets: [] },
      allSavedFiles: [{ path: 'x.jsx' }],
      projectId: 'p1',
      db: mockDb([{ path: 'x.jsx', content: 'body' }]),
      aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { events, result } = await drain(gen)
    expect(events.some((e) => e.event === 'status' && e.data.stage === 'repairing')).toBe(true)
    expect(events.some((e) => e.event === 'repair_progress')).toBe(true)
    expect(deps.repairBuild).toHaveBeenCalledTimes(1)
    expect(result.reviewResult).toEqual(reviewResult)
  })

  it('status.detail reports total issue count', async () => {
    const deps = makeDeps({
      reviewBuild: jest.fn().mockResolvedValue({ ok: false, missing: ['a', 'b'], broken: ['c'] }),
      repairBuild: jest.fn().mockImplementation(() => (async function* () {
        return { filesRepaired: [] }
      })()),
    })
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [{ path: 'x' }],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { events } = await drain(gen)
    const repairStatus = events.find((e) => e.event === 'status' && e.data.stage === 'repairing')
    expect(repairStatus.data.detail).toContain('3 issue')
  })
})

describe('runReviewAndRepair — post-repair safety net', () => {
  it('saves files + emits files_saved when post-repair modifies', async () => {
    const ai = mockAi()
    const deps = makeDeps({
      runPostRepair: jest.fn().mockReturnValue({
        updates: [{ path: 'components/Navbar.jsx', content: 'fixed' }],
        modifiedPaths: ['components/Navbar.jsx'],
      }),
    })
    const gen = runReviewAndRepair({
      plan: { imageAssets: [{ role: 'logo' }] },
      allSavedFiles: [{ path: 'components/Navbar.jsx' }],
      projectId: 'p1',
      db: mockDb([{ path: 'components/Navbar.jsx', content: 'before' }]),
      aiService: ai,
      tick: jest.fn(), deps,
    })
    const { events } = await drain(gen)
    const filesSaved = events.find((e) => e.event === 'files_saved')
    expect(filesSaved).toBeDefined()
    expect(filesSaved.data.files).toEqual([{ path: 'components/Navbar.jsx', action: 'post_repair', id: 'components/Navbar.jsx' }])
    expect(ai._saved).toEqual([{ path: 'components/Navbar.jsx', content: 'fixed' }])
  })

  it('skips files_saved when post-repair has no updates', async () => {
    const deps = makeDeps()
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [{ path: 'x' }],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { events } = await drain(gen)
    expect(events.some((e) => e.event === 'files_saved')).toBe(false)
  })

  it('records post_repair timing even when post-repair has no updates', async () => {
    const tick = jest.fn()
    const deps = makeDeps()
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [{ path: 'x' }],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick, deps,
    })
    await drain(gen)
    expect(tick).toHaveBeenCalledWith('post_repair', expect.any(Number))
  })

  it('passes imageAssets from plan through to runPostRepair', async () => {
    const assets = [{ role: 'logo', name: 'l.png' }]
    const deps = makeDeps()
    const gen = runReviewAndRepair({
      plan: { imageAssets: assets },
      allSavedFiles: [{ path: 'x' }],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    await drain(gen)
    expect(deps.runPostRepair).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ imageAssets: assets }),
    )
  })
})

describe('runReviewAndRepair — fault tolerance', () => {
  it('swallows review errors without aborting post-repair', async () => {
    const deps = makeDeps({
      reviewBuild: jest.fn().mockRejectedValue(new Error('review API down')),
      runPostRepair: jest.fn().mockReturnValue({
        updates: [{ path: 'x', content: 'y' }],
        modifiedPaths: ['x'],
      }),
    })
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [{ path: 'x' }],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    const { events, result } = await drain(gen)
    expect(result.reviewResult).toBeNull()
    expect(events.some((e) => e.event === 'files_saved')).toBe(true)
  })

  it('falls back to empty-content file list when DB query fails', async () => {
    const db = {
      projectFiles: {
        findByProjectId: jest.fn().mockRejectedValue(new Error('db fail')),
      },
    }
    const deps = makeDeps()
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [{ path: 'a.jsx' }, { path: 'b.jsx' }],
      projectId: 'p1', db, aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    await drain(gen)
    expect(deps.reviewBuild).toHaveBeenCalled()
    const call = deps.reviewBuild.mock.calls[0][0]
    expect(call.filesBuilt).toEqual([
      { path: 'a.jsx', content: '' },
      { path: 'b.jsx', content: '' },
    ])
  })

  it('post-repair throw does not surface to caller', async () => {
    const deps = makeDeps({
      runPostRepair: jest.fn().mockImplementation(() => { throw new Error('post-repair fail') }),
    })
    const gen = runReviewAndRepair({
      plan: {}, allSavedFiles: [{ path: 'x' }],
      projectId: 'p1', db: mockDb(), aiService: mockAi(),
      tick: jest.fn(), deps,
    })
    await expect(drain(gen)).resolves.not.toThrow()
  })
})
