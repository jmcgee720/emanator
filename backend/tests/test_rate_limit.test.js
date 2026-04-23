/**
 * Tests for the rate-limit helper.
 *
 * Mocks MongoDB at the `getDb` boundary so we can simulate attempt history
 * without any real database.
 */

const now = () => Date.now()

// In-memory substitute for a MongoDB collection.
class FakeCollection {
  constructor() {
    this.docs = []
    this.indexes = []
  }
  async createIndex() {
    this.indexes.push({})
    return 'idx'
  }
  async countDocuments(query) {
    return this.docs.filter(
      (d) =>
        d.key === query.key &&
        (!query.created_at?.$gte || d.created_at >= query.created_at.$gte),
    ).length
  }
  find(query) {
    const self = this
    const matches = this.docs.filter(
      (d) =>
        d.key === query.key &&
        (!query.created_at?.$gte || d.created_at >= query.created_at.$gte),
    )
    const chain = {
      _matches: matches,
      sort(order) {
        const dir = Object.values(order)[0] === -1 ? -1 : 1
        this._matches = [...this._matches].sort(
          (a, b) => dir * (a.created_at.getTime() - b.created_at.getTime()),
        )
        return this
      },
      limit(n) {
        this._matches = this._matches.slice(0, n)
        return this
      },
      toArray() {
        return Promise.resolve(this._matches)
      },
    }
    return chain
  }
  async insertOne(doc) {
    this.docs.push(doc)
    return { insertedId: this.docs.length }
  }
}

const fakeColl = new FakeCollection()
const fakeDb = {
  collection: () => fakeColl,
}

jest.mock('../../lib/mongodb', () => ({
  getDb: async () => fakeDb,
}))

import { checkRateLimit, formatRetryAfter, getClientIp } from '../../lib/rate-limit.js'

beforeEach(() => {
  fakeColl.docs = []
})

describe('checkRateLimit', () => {
  it('allows the first N calls within the window', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit('test:ip:1', 5, 60_000)
      expect(r.allowed).toBe(true)
    }
  })

  it('blocks the N+1 call with a retryAfterMs', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('test:ip:1', 5, 60_000)
    const r = await checkRateLimit('test:ip:1', 5, 60_000)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterMs).toBeGreaterThanOrEqual(0)
  })

  it('tracks different keys independently', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('test:ip:1', 5, 60_000)
    const r = await checkRateLimit('test:ip:2', 5, 60_000)
    expect(r.allowed).toBe(true)
  })

  it('does not record when {record: false}', async () => {
    await checkRateLimit('test:ip:1', 5, 60_000, { record: false })
    expect(fakeColl.docs.length).toBe(0)
  })

  it('expires attempts outside the window', async () => {
    // Manually insert 5 stale attempts
    const longAgo = new Date(now() - 120_000)
    for (let i = 0; i < 5; i++) fakeColl.docs.push({ key: 'test:ip:1', created_at: longAgo })
    // With a 60s window, they should NOT count → new call should be allowed.
    const r = await checkRateLimit('test:ip:1', 5, 60_000)
    expect(r.allowed).toBe(true)
  })
})

describe('formatRetryAfter', () => {
  it('formats seconds', () => {
    expect(formatRetryAfter(10_000)).toBe('10 seconds')
    expect(formatRetryAfter(1_000)).toBe('1 second')
  })
  it('formats minutes', () => {
    expect(formatRetryAfter(120_000)).toBe('2 minutes')
    expect(formatRetryAfter(60_000)).toBe('1 minute')
  })
  it('formats hours', () => {
    expect(formatRetryAfter(7_200_000)).toBe('2 hours')
  })
})

describe('getClientIp', () => {
  it('uses x-forwarded-for when present', () => {
    const req = { headers: { get: (h) => (h === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null) } }
    expect(getClientIp(req)).toBe('1.2.3.4')
  })
  it('falls back to x-real-ip', () => {
    const req = { headers: { get: (h) => (h === 'x-real-ip' ? '9.9.9.9' : null) } }
    expect(getClientIp(req)).toBe('9.9.9.9')
  })
  it('returns "unknown" with no headers', () => {
    const req = { headers: { get: () => null } }
    expect(getClientIp(req)).toBe('unknown')
  })
})
