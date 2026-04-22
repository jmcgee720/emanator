import { rollupAnalytics } from '../../lib/analytics/rollup.js'

function run(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    project_id: 'p',
    tool_mode: 'new_pipeline:landing',
    files_generated: 5,
    duration: 12000,
    success: true,
    provider: 'openai',
    model: 'gpt-4o',
    created_at: '2026-02-20T10:00:00Z',
    ...overrides,
  }
}

describe('rollupAnalytics — empty + invalid', () => {
  it('returns zeroed summary for empty array', () => {
    const s = rollupAnalytics([])
    expect(s.totalBuilds).toBe(0)
    expect(s.totalFiles).toBe(0)
    expect(s.successRate).toBe(0)
    expect(s.avgDurationMs).toBe(0)
    expect(s.p95DurationMs).toBe(0)
    expect(s.byProvider).toEqual({})
    expect(s.byModel).toEqual({})
    expect(s.byArchetype).toEqual({})
    expect(s.timeline).toEqual([])
    expect(s.recent).toEqual([])
  })

  it('handles non-array input gracefully', () => {
    expect(rollupAnalytics(null).totalBuilds).toBe(0)
    expect(rollupAnalytics(undefined).totalBuilds).toBe(0)
    expect(rollupAnalytics('nope').totalBuilds).toBe(0)
  })
})

describe('rollupAnalytics — totals + success rate', () => {
  it('counts every run', () => {
    const s = rollupAnalytics([run(), run(), run()])
    expect(s.totalBuilds).toBe(3)
    expect(s.totalFiles).toBe(15)
  })

  it('computes success rate correctly', () => {
    const s = rollupAnalytics([
      run({ success: true }),
      run({ success: true }),
      run({ success: false }),
      run({ success: true }),
    ])
    expect(s.successRate).toBeCloseTo(0.75)
  })

  it('treats undefined success as success (legacy rows)', () => {
    const s = rollupAnalytics([run({ success: undefined }), run({ success: false })])
    expect(s.successRate).toBeCloseTo(0.5)
  })
})

describe('rollupAnalytics — durations', () => {
  it('averages + p95 exclude null/0 durations', () => {
    const s = rollupAnalytics([
      run({ duration: 1000 }),
      run({ duration: 2000 }),
      run({ duration: 3000 }),
      run({ duration: null }),
      run({ duration: 0 }),
    ])
    expect(s.avgDurationMs).toBe(2000)
    expect(s.p95DurationMs).toBe(3000)
  })

  it('handles single-value duration set', () => {
    const s = rollupAnalytics([run({ duration: 5000 })])
    expect(s.avgDurationMs).toBe(5000)
    expect(s.p95DurationMs).toBe(5000)
  })
})

describe('rollupAnalytics — breakdowns', () => {
  it('counts by provider / model / archetype', () => {
    const s = rollupAnalytics([
      run({ provider: 'openai', model: 'gpt-4o', tool_mode: 'new_pipeline:landing' }),
      run({ provider: 'openai', model: 'gpt-4o', tool_mode: 'new_pipeline:landing' }),
      run({ provider: 'anthropic', model: 'claude-sonnet-4-5', tool_mode: 'new_pipeline:saas' }),
      run({ provider: 'gemini', model: 'gemini-2.5-pro', tool_mode: 'tool_loop' }),
    ])
    expect(s.byProvider).toEqual({ openai: 2, anthropic: 1, gemini: 1 })
    expect(s.byModel).toEqual({ 'gpt-4o': 2, 'claude-sonnet-4-5': 1, 'gemini-2.5-pro': 1 })
    expect(s.byArchetype).toEqual({ landing: 2, saas: 1, tool_loop: 1 })
  })

  it('unknown provider/model coerces to "unknown"', () => {
    const s = rollupAnalytics([run({ provider: null, model: null })])
    expect(s.byProvider).toEqual({ unknown: 1 })
    expect(s.byModel).toEqual({ unknown: 1 })
  })

  it('classifies new_pipeline_aborted as aborted', () => {
    const s = rollupAnalytics([run({ tool_mode: 'new_pipeline_aborted' })])
    expect(s.byArchetype).toEqual({ aborted: 1 })
  })
})

describe('rollupAnalytics — timeline', () => {
  it('groups by YYYY-MM-DD ascending', () => {
    const s = rollupAnalytics([
      run({ created_at: '2026-02-20T10:00:00Z' }),
      run({ created_at: '2026-02-20T14:00:00Z' }),
      run({ created_at: '2026-02-19T09:00:00Z', success: false }),
      run({ created_at: '2026-02-21T11:00:00Z' }),
    ])
    expect(s.timeline.map((r) => r.date)).toEqual(['2026-02-19', '2026-02-20', '2026-02-21'])
    expect(s.timeline[0]).toEqual({ date: '2026-02-19', builds: 1, success: 0 })
    expect(s.timeline[1]).toEqual({ date: '2026-02-20', builds: 2, success: 2 })
    expect(s.timeline[2]).toEqual({ date: '2026-02-21', builds: 1, success: 1 })
  })

  it('ignores rows without a valid created_at', () => {
    const s = rollupAnalytics([run({ created_at: '' }), run({ created_at: null })])
    expect(s.timeline).toEqual([])
  })
})

describe('rollupAnalytics — recent', () => {
  it('returns up to 10 rows, preserving input order', () => {
    const rows = Array.from({ length: 15 }, (_, i) => run({ id: `r${i}` }))
    const s = rollupAnalytics(rows)
    expect(s.recent).toHaveLength(10)
    expect(s.recent[0].id).toBe('r0')
    expect(s.recent[9].id).toBe('r9')
  })

  it('returns all when fewer than 10', () => {
    const rows = Array.from({ length: 4 }, (_, i) => run({ id: `r${i}` }))
    const s = rollupAnalytics(rows)
    expect(s.recent).toHaveLength(4)
  })
})
