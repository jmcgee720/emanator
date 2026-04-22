/**
 * Tests for the extracted visual-fidelity loop (Session 32, refactored
 * Feb 2026). Uses dependency injection via `opts.deps` so the loop's
 * control flow (round counting, short-circuits, SSE shape) can be
 * asserted in isolation without hitting Vision or the repair LLM.
 */

import { runVisualFidelityLoop } from '../../lib/ai/pipeline/visual-loop.js'

function mockDb(files = []) {
  return {
    projectFiles: {
      findByProjectId: jest.fn().mockResolvedValue(files),
    },
  }
}

function mockAi() {
  return {
    provider: { name: 'test-provider' },
    saveFiles: jest.fn().mockResolvedValue(undefined),
  }
}

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

function makeDeps(overrides = {}) {
  return {
    verifyBuild: jest.fn(),
    findingsToReviewShape: jest.fn(),
    shouldContinueVisualLoop: jest.fn(),
    repairBuild: jest.fn(),
    ...overrides,
  }
}

describe('runVisualFidelityLoop — no-op paths', () => {
  it('yields nothing + returns empty summary when referenceImages is empty', async () => {
    const deps = makeDeps()
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), deps,
    })
    const { events, result } = await drain(gen)
    expect(events).toEqual([])
    expect(result).toEqual({ rounds: [], totalFilesRepaired: 0, finalMatches: false, initialFindings: 0 })
    expect(deps.verifyBuild).not.toHaveBeenCalled()
  })

  it('yields nothing when referenceImages is missing on plan', async () => {
    const deps = makeDeps()
    const gen = runVisualFidelityLoop({ plan: {}, projectId: 'p1', db: mockDb(), aiService: mockAi(), deps })
    const { events } = await drain(gen)
    expect(events).toEqual([])
  })

  it('breaks when verifyBuild returns null (no verdict available)', async () => {
    const deps = makeDeps({ verifyBuild: jest.fn().mockResolvedValueOnce(null) })
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 3, deps,
    })
    const { events, result } = await drain(gen)
    expect(events).toEqual([])
    expect(result.rounds).toEqual([])
  })
})

describe('runVisualFidelityLoop — single-round MATCH', () => {
  it('emits one screenshot_verify + returns finalMatches=true', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn().mockResolvedValueOnce({ matches: true, confidence: 0.95, findings: [], summary: 'ok' }),
      shouldContinueVisualLoop: jest.fn().mockReturnValueOnce({ stop: true, reason: 'matches' }),
    })

    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 3, deps,
    })
    const { events, result } = await drain(gen)

    const verifyEvents = events.filter((e) => e.event === 'screenshot_verify')
    expect(verifyEvents).toHaveLength(1)
    expect(verifyEvents[0].data.round).toBe(1)
    expect(result.rounds).toHaveLength(1)
    expect(result.finalMatches).toBe(true)
    expect(deps.repairBuild).not.toHaveBeenCalled()
  })

  it('mutates plan.verifyResult with the latest verdict', async () => {
    const plan = { referenceImages: [{ role: 'aesthetic' }] }
    const deps = makeDeps({
      verifyBuild: jest.fn().mockResolvedValueOnce({ matches: true, confidence: 1, findings: [], summary: 'ok' }),
      shouldContinueVisualLoop: jest.fn().mockReturnValueOnce({ stop: true, reason: 'matches' }),
    })
    await drain(runVisualFidelityLoop({ plan, projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 3, deps }))
    expect(plan.verifyResult).toEqual(expect.objectContaining({ matches: true, confidence: 1 }))
  })
})

describe('runVisualFidelityLoop — repair + re-verify', () => {
  it('runs repair wave when gate says continue, then re-verifies', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn()
        .mockResolvedValueOnce({ matches: false, confidence: 0.6, findings: [{ file: 'x.jsx', category: 'palette', issue: 'off' }], summary: '' })
        .mockResolvedValueOnce({ matches: true, confidence: 0.9, findings: [], summary: 'fixed' }),
      shouldContinueVisualLoop: jest.fn()
        .mockReturnValueOnce({ stop: false })
        .mockReturnValueOnce({ stop: true, reason: 'matches' }),
      findingsToReviewShape: jest.fn().mockReturnValueOnce({ missing: [], broken: ['x.jsx: vision-palette — fix: use brand color'] }),
      repairBuild: jest.fn().mockImplementationOnce(() => (async function* () {
        return { filesRepaired: [{ path: 'x.jsx' }] }
      })()),
    })

    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb([{ path: 'x.jsx', content: 'body' }]), aiService: mockAi(), maxRounds: 3, deps,
    })
    const { events, result } = await drain(gen)

    expect(deps.verifyBuild).toHaveBeenCalledTimes(2)
    expect(deps.repairBuild).toHaveBeenCalledTimes(1)
    expect(result.rounds).toHaveLength(2)
    expect(result.rounds[0].filesRepaired).toBe(1)
    expect(result.totalFilesRepaired).toBe(1)
    expect(result.finalMatches).toBe(true)
    expect(events.some((e) => e.event === 'visual_repair_complete')).toBe(true)
    expect(events.some((e) => e.event === 'visual_loop_summary')).toBe(true)
  })

  it('exits when repair changes zero files (no point re-verifying)', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn().mockResolvedValueOnce({ matches: false, confidence: 0.4, findings: [{ file: 'a.jsx', category: 'other', issue: 'x' }], summary: '' }),
      shouldContinueVisualLoop: jest.fn().mockReturnValueOnce({ stop: false }),
      findingsToReviewShape: jest.fn().mockReturnValueOnce({ missing: [], broken: ['a.jsx: x'] }),
      repairBuild: jest.fn().mockImplementationOnce(() => (async function* () {
        return { filesRepaired: [] }
      })()),
    })
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 3, deps,
    })
    const { result } = await drain(gen)
    expect(deps.verifyBuild).toHaveBeenCalledTimes(1)
    expect(result.totalFilesRepaired).toBe(0)
  })

  it('skips repair when findingsToReviewShape returns zero broken', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn().mockResolvedValueOnce({ matches: false, confidence: 0.5, findings: [{ file: '', category: 'other', issue: 'x' }], summary: '' }),
      shouldContinueVisualLoop: jest.fn().mockReturnValueOnce({ stop: false }),
      findingsToReviewShape: jest.fn().mockReturnValueOnce({ missing: [], broken: [] }),
    })
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 3, deps,
    })
    await drain(gen)
    expect(deps.repairBuild).not.toHaveBeenCalled()
  })
})

describe('runVisualFidelityLoop — guard rails', () => {
  it('caps at maxRounds when Vision never signals match', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn().mockResolvedValue({ matches: false, confidence: 0.5, findings: [{ file: 'x', category: 'other', issue: 'x' }], summary: '' }),
      shouldContinueVisualLoop: jest.fn().mockReturnValue({ stop: false }),
      findingsToReviewShape: jest.fn().mockReturnValue({ missing: [], broken: ['x: x'] }),
      repairBuild: jest.fn().mockImplementation(() => (async function* () {
        return { filesRepaired: [{ path: 'x' }] }
      })()),
    })
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 2, deps,
    })
    const { result } = await drain(gen)
    expect(deps.verifyBuild.mock.calls.length).toBeLessThanOrEqual(2)
    expect(result.rounds.length).toBeLessThanOrEqual(2)
  })

  it('swallows thrown errors and returns the in-progress summary', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn().mockRejectedValueOnce(new Error('API timeout')),
    })
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 3, deps,
    })
    const { events, result } = await drain(gen)
    expect(events).toEqual([])
    expect(result.rounds).toEqual([])
  })

  it('records initialFindings from the first round', async () => {
    const deps = makeDeps({
      verifyBuild: jest.fn().mockResolvedValueOnce({
        matches: false, confidence: 0.7,
        findings: [
          { file: 'a', category: 'other', issue: 'a' },
          { file: 'b', category: 'other', issue: 'b' },
          { file: 'c', category: 'other', issue: 'c' },
        ],
        summary: '',
      }),
      shouldContinueVisualLoop: jest.fn().mockReturnValueOnce({ stop: true, reason: 'max-rounds' }),
    })
    const gen = runVisualFidelityLoop({
      plan: { referenceImages: [{ role: 'aesthetic' }] },
      projectId: 'p1', db: mockDb(), aiService: mockAi(), maxRounds: 1, deps,
    })
    const { result } = await drain(gen)
    expect(result.initialFindings).toBe(3)
  })
})
