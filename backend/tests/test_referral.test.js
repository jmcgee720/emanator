/**
 * Tests for the referral bonus system (recordReferral + addCredits payout).
 *
 * Mocks MongoDB at the credits service's `getDb` boundary.
 */

// In-memory Mongo stub — enough to satisfy creditsDb's actual calls.
class FakeCollection {
  constructor(name) {
    this.name = name
    this.docs = []
  }
  async createIndex() {
    return 'idx'
  }
  async findOne(query, opts) {
    return this._matchOne(query, opts)
  }
  _matchOne(query) {
    for (const d of this.docs) {
      if (this._matches(d, query)) return { ...d }
    }
    return null
  }
  _matches(doc, query) {
    for (const [k, v] of Object.entries(query)) {
      if (k === '_id') continue
      if (v && typeof v === 'object' && v.$ne !== undefined) {
        if (doc[k] === v.$ne) return false
        continue
      }
      if (v && typeof v === 'object' && v.$in !== undefined) {
        if (!v.$in.includes(doc[k])) return false
        continue
      }
      if (doc[k] !== v) return false
    }
    return true
  }
  async insertOne(doc) {
    this.docs.push({ ...doc })
    return { insertedId: 'fake' }
  }
  async updateOne(query, update, opts = {}) {
    const target = this.docs.find((d) => this._matches(d, query))
    if (target) {
      this._apply(target, update)
      return { modifiedCount: 1, upsertedCount: 0 }
    }
    if (opts.upsert) {
      const newDoc = {}
      for (const k of Object.keys(query)) {
        const v = query[k]
        if (v !== null && typeof v === 'object') continue // skip $in, $ne operators
        newDoc[k] = v
      }
      if (update.$setOnInsert) Object.assign(newDoc, update.$setOnInsert)
      if (update.$set) Object.assign(newDoc, update.$set)
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          newDoc[k] = (newDoc[k] || 0) + v
        }
      }
      this.docs.push(newDoc)
      return { modifiedCount: 0, upsertedCount: 1, upsertedId: 'fake' }
    }
    return { modifiedCount: 0, upsertedCount: 0 }
  }
  async findOneAndUpdate(query, update, opts = {}) {
    const target = this.docs.find((d) => this._matches(d, query))
    if (target) {
      this._apply(target, update)
      return { ...target }
    }
    if (opts.upsert) {
      const newDoc = {}
      for (const k of Object.keys(query)) {
        if (!['$ne', '$in', '$exists'].includes(k)) newDoc[k] = query[k]
      }
      if (update.$setOnInsert) Object.assign(newDoc, update.$setOnInsert)
      if (update.$set) Object.assign(newDoc, update.$set)
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          newDoc[k] = (newDoc[k] || 0) + v
        }
      }
      this.docs.push(newDoc)
      return { ...newDoc }
    }
    return null
  }
  _apply(target, update) {
    if (update.$set) Object.assign(target, update.$set)
    if (update.$setOnInsert) {
      // only on insert; skip for existing
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        target[k] = (target[k] || 0) + v
      }
    }
  }
}

const balanceColl = new FakeCollection('credits_balance')
const usageColl = new FakeCollection('credits_usage')

jest.mock('mongodb', () => {
  return {
    __esModule: true,
    MongoClient: class MockMongoClient {
      constructor() {}
      async connect() {}
      db() {
        return {
          collection: (name) => {
            if (name === 'credits_balance') return balanceColl
            if (name === 'credits_usage') return usageColl
            return new FakeCollection(name)
          },
        }
      }
    },
  }
})

// creditsDb.service uses its own internal MongoClient — we also need to cover
// @/lib/mongodb in case anything imports it transitively.
jest.mock('../../lib/mongodb', () => ({
  getDb: async () => ({
    collection: (name) => {
      if (name === 'credits_balance') return balanceColl
      if (name === 'credits_usage') return usageColl
      return new FakeCollection(name)
    },
  }),
}))

const { creditsDb, REFERRAL_BONUS_CREDITS } = require('../../lib/credits/service.js')

beforeEach(() => {
  balanceColl.docs = []
  usageColl.docs = []
})

describe('recordReferral', () => {
  it('rejects missing IDs', async () => {
    const r1 = await creditsDb.recordReferral(null, 'ref-user')
    const r2 = await creditsDb.recordReferral('new-user', null)
    expect(r1.recorded).toBe(false)
    expect(r2.recorded).toBe(false)
  })

  it('rejects self-referral', async () => {
    const r = await creditsDb.recordReferral('user-1', 'user-1')
    expect(r.recorded).toBe(false)
    expect(r.reason).toBe('self_referral')
  })

  it('rejects invalid referrer (no balance doc)', async () => {
    const r = await creditsDb.recordReferral('new-user', 'ghost-user')
    expect(r.recorded).toBe(false)
    expect(r.reason).toBe('invalid_referrer')
  })

  it('records when referrer exists and new user has no prior referral', async () => {
    balanceColl.docs.push({ user_id: 'referrer-1', balance: 50, lifetime_purchased_usd: 0 })
    const r = await creditsDb.recordReferral('new-user', 'referrer-1')
    expect(r.recorded).toBe(true)
    const newUserDoc = balanceColl.docs.find((d) => d.user_id === 'new-user')
    expect(newUserDoc?.referred_by).toBe('referrer-1')
  })

  it('is idempotent — does not overwrite an existing referred_by', async () => {
    balanceColl.docs.push({ user_id: 'referrer-1', balance: 50 })
    balanceColl.docs.push({ user_id: 'referrer-2', balance: 50 })
    balanceColl.docs.push({
      user_id: 'new-user',
      balance: 50,
      referred_by: 'referrer-1',
    })
    const r = await creditsDb.recordReferral('new-user', 'referrer-2')
    expect(r.recorded).toBe(false)
    expect(r.reason).toBe('already_referred')
    const newUserDoc = balanceColl.docs.find((d) => d.user_id === 'new-user')
    expect(newUserDoc.referred_by).toBe('referrer-1') // unchanged
  })
})

describe('addCredits → referral payout', () => {
  it('does NOT pay out on a non-first purchase', async () => {
    balanceColl.docs.push({ user_id: 'referrer-1', balance: 100 })
    balanceColl.docs.push({
      user_id: 'new-user',
      balance: 50,
      lifetime_purchased_usd: 10,
      first_purchase_completed: true,
      referred_by: 'referrer-1',
    })
    const res = await creditsDb.addCredits('new-user', 100, { pricePaidUsd: 10 })
    expect(res.referralBonus).toBe(0)
    // Referrer unchanged.
    const refDoc = balanceColl.docs.find((d) => d.user_id === 'referrer-1')
    expect(refDoc.balance).toBe(100)
  })

  it('pays out both referrer + new user on first purchase', async () => {
    balanceColl.docs.push({ user_id: 'referrer-1', balance: 100 })
    balanceColl.docs.push({
      user_id: 'new-user',
      balance: 50,
      lifetime_purchased_usd: 0,
      first_purchase_completed: false,
      referred_by: 'referrer-1',
    })
    const res = await creditsDb.addCredits('new-user', 100, { pricePaidUsd: 10 })
    expect(res.referralBonus).toBe(REFERRAL_BONUS_CREDITS)
    expect(res.referrerId).toBe('referrer-1')

    // Referrer got +25
    const refDoc = balanceColl.docs.find((d) => d.user_id === 'referrer-1')
    expect(refDoc.balance).toBe(100 + REFERRAL_BONUS_CREDITS)

    // New user: 50 base + 100 pack + 50 first-purchase bonus + 25 referral = 225
    const newDoc = balanceColl.docs.find((d) => d.user_id === 'new-user')
    expect(newDoc.balance).toBe(50 + 100 + 50 + REFERRAL_BONUS_CREDITS)
    expect(newDoc.referral_payout_completed).toBe(true)
  })

  it('does not double-pay when addCredits fires twice (idempotent)', async () => {
    balanceColl.docs.push({ user_id: 'referrer-1', balance: 100 })
    balanceColl.docs.push({
      user_id: 'new-user',
      balance: 50,
      lifetime_purchased_usd: 0,
      first_purchase_completed: false,
      referred_by: 'referrer-1',
    })
    const r1 = await creditsDb.addCredits('new-user', 100, { pricePaidUsd: 10 })
    expect(r1.referralBonus).toBe(REFERRAL_BONUS_CREDITS)

    // A second call — at this point first_purchase_completed is already true,
    // so isFirstPurchase will be false, so no referral payout fires.
    const r2 = await creditsDb.addCredits('new-user', 100, { pricePaidUsd: 10 })
    expect(r2.referralBonus).toBe(0)

    // Referrer balance did NOT get a second +25
    const refDoc = balanceColl.docs.find((d) => d.user_id === 'referrer-1')
    expect(refDoc.balance).toBe(100 + REFERRAL_BONUS_CREDITS)
  })

  it('does not pay out for non-referred users', async () => {
    balanceColl.docs.push({
      user_id: 'solo-user',
      balance: 50,
      lifetime_purchased_usd: 0,
      first_purchase_completed: false,
      // no referred_by
    })
    const res = await creditsDb.addCredits('solo-user', 100, { pricePaidUsd: 10 })
    expect(res.referralBonus).toBe(0)
    expect(res.referrerId).toBe(null)
  })
})
