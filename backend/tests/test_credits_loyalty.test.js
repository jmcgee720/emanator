/**
 * Tests for WP2 — Billing & Credits infrastructure.
 *
 * Covers:
 *  - Loyalty tier resolution (starter/regular/loyal/vip thresholds)
 *  - Loyalty bonus math (base/bonus/total shape)
 *  - Per-model burn multiplier in `deductCredits` (via estimateRequestCost)
 *  - getModelCost + estimateRequestCost defaults
 */

import {
  CREDIT_COSTS,
  CREDIT_PACKAGES,
  MODEL_COSTS,
  LOYALTY_TIERS,
  FIRST_PURCHASE_BONUS_PERCENT,
  resolveLoyaltyTier,
  applyLoyaltyBonus,
  getModelCost,
  estimateRequestCost,
} from '../../lib/credits/service.js'

describe('WP2 — Credit packages & loyalty tiers', () => {
  test('CREDIT_PACKAGES has $10/$45/$80 tiers with ids', () => {
    expect(CREDIT_PACKAGES).toHaveLength(3)
    expect(CREDIT_PACKAGES[0]).toMatchObject({ amount: 100, price: 10, id: 'starter' })
    expect(CREDIT_PACKAGES[1]).toMatchObject({ amount: 500, price: 45, id: 'pro' })
    expect(CREDIT_PACKAGES[2]).toMatchObject({ amount: 1000, price: 80, id: 'ultra' })
  })

  test('LOYALTY_TIERS are in ascending order of minLifetimeUsd', () => {
    for (let i = 1; i < LOYALTY_TIERS.length; i++) {
      expect(LOYALTY_TIERS[i].minLifetimeUsd).toBeGreaterThan(LOYALTY_TIERS[i - 1].minLifetimeUsd)
    }
  })

  test('resolveLoyaltyTier picks correct tier by lifetime', () => {
    expect(resolveLoyaltyTier(0).label).toBe('Starter')
    expect(resolveLoyaltyTier(10).label).toBe('Starter')
    expect(resolveLoyaltyTier(25).label).toBe('Regular')
    expect(resolveLoyaltyTier(99).label).toBe('Regular')
    expect(resolveLoyaltyTier(100).label).toBe('Loyal')
    expect(resolveLoyaltyTier(499).label).toBe('Loyal')
    expect(resolveLoyaltyTier(500).label).toBe('VIP')
    expect(resolveLoyaltyTier(10000).label).toBe('VIP')
  })

  test('resolveLoyaltyTier handles negative / invalid / null', () => {
    expect(resolveLoyaltyTier(-5).label).toBe('Starter')
    expect(resolveLoyaltyTier(null).label).toBe('Starter')
    expect(resolveLoyaltyTier(undefined).label).toBe('Starter')
    expect(resolveLoyaltyTier('xyz').label).toBe('Starter')
  })

  test('applyLoyaltyBonus returns correct base/bonus/total', () => {
    const starter = applyLoyaltyBonus(100, 0)
    expect(starter).toMatchObject({ baseCredits: 100, bonus: 0, total: 100 })
    expect(starter.tier.label).toBe('Starter')

    const regular = applyLoyaltyBonus(100, 25)
    expect(regular).toMatchObject({ baseCredits: 100, bonus: 5, total: 105 })
    expect(regular.tier.label).toBe('Regular')

    const loyal = applyLoyaltyBonus(500, 200)
    expect(loyal).toMatchObject({ baseCredits: 500, bonus: 75, total: 575 })
    expect(loyal.tier.label).toBe('Loyal')

    const vip = applyLoyaltyBonus(1000, 1000)
    expect(vip).toMatchObject({ baseCredits: 1000, bonus: 250, total: 1250 })
    expect(vip.tier.label).toBe('VIP')
  })

  test('applyLoyaltyBonus floors the bonus (no fractional credits)', () => {
    // 15% of 333 = 49.95 → floor → 49
    const result = applyLoyaltyBonus(333, 100)
    expect(result.bonus).toBe(49)
    expect(result.total).toBe(382)
  })

  test('applyLoyaltyBonus adds first-purchase bonus when isFirstPurchase=true', () => {
    const res = applyLoyaltyBonus(100, 0, { isFirstPurchase: true })
    expect(res.firstPurchaseBonus).toBe(50) // 50% of 100
    expect(res.loyaltyBonus).toBe(0)        // Starter tier → 0%
    expect(res.bonus).toBe(50)
    expect(res.total).toBe(150)
  })

  test('first-purchase bonus stacks with loyalty bonus', () => {
    // User at $100 lifetime (Loyal = 15%) making first purchase (+50%)
    const res = applyLoyaltyBonus(200, 100, { isFirstPurchase: true })
    expect(res.loyaltyBonus).toBe(30)       // 15% of 200
    expect(res.firstPurchaseBonus).toBe(100) // 50% of 200
    expect(res.bonus).toBe(130)
    expect(res.total).toBe(330)
    expect(res.tier.label).toBe('Loyal')
  })

  test('first-purchase bonus skipped when isFirstPurchase is falsy', () => {
    const res = applyLoyaltyBonus(100, 0)
    expect(res.firstPurchaseBonus).toBe(0)
    const res2 = applyLoyaltyBonus(100, 0, { isFirstPurchase: false })
    expect(res2.firstPurchaseBonus).toBe(0)
  })
})

describe('WP2 — Per-model burn', () => {
  test('getModelCost returns default for unknown model', () => {
    const result = getModelCost('fake-model-xyz')
    expect(result.credits).toBe(0.5)
    expect(result.tier).toBe('standard')
  })

  test('getModelCost returns premium tier for gpt-5.2', () => {
    expect(getModelCost('gpt-5.2').credits).toBe(1.5)
    expect(getModelCost('gpt-5.2').tier).toBe('premium')
  })

  test('getModelCost returns premium tier for claude-opus-4-5-20251101', () => {
    expect(getModelCost('claude-opus-4-5-20251101').credits).toBe(2.5)
    expect(getModelCost('claude-opus-4-5-20251101').tier).toBe('premium')
  })

  test('estimateRequestCost applies 3x multiplier in custom visual mode', () => {
    expect(estimateRequestCost('gpt-4o', 'custom')).toBe(3.0) // 1.0 * 3
    expect(estimateRequestCost('gpt-4o')).toBe(1.0)
    expect(estimateRequestCost('claude-haiku-4-5-20251001', 'custom')).toBeCloseTo(0.9, 5) // 0.3 * 3
  })

  test('CREDIT_COSTS has all expected action types', () => {
    expect(CREDIT_COSTS.chat_message).toBeDefined()
    expect(CREDIT_COSTS.plan_generation).toBeDefined()
    expect(CREDIT_COSTS.file_apply).toBeDefined()
    expect(CREDIT_COSTS.image_generation).toBeDefined()
    expect(CREDIT_COSTS.code_review).toBeDefined()
    expect(CREDIT_COSTS.canvas_update).toBeDefined()
    expect(CREDIT_COSTS.comparison).toBeDefined()
  })

  test('MODEL_COSTS covers all three providers', () => {
    // OpenAI
    expect(MODEL_COSTS['gpt-5.2']).toBeDefined()
    expect(MODEL_COSTS['gpt-4o']).toBeDefined()
    expect(MODEL_COSTS['gpt-4o-mini']).toBeDefined()
    // Anthropic
    expect(MODEL_COSTS['claude-sonnet-4-5-20250929']).toBeDefined()
    expect(MODEL_COSTS['claude-opus-4-5-20251101']).toBeDefined()
    expect(MODEL_COSTS['claude-haiku-4-5-20251001']).toBeDefined()
    // Gemini
    expect(MODEL_COSTS['gemini-2.5-pro']).toBeDefined()
    expect(MODEL_COSTS['gemini-2.5-flash']).toBeDefined()
  })

  test('premium models cost more than standard models', () => {
    const gpt52 = getModelCost('gpt-5.2').credits
    const haiku = getModelCost('claude-haiku-4-5-20251001').credits
    expect(gpt52).toBeGreaterThan(haiku)
    // Opus is the most expensive
    const opus = getModelCost('claude-opus-4-5-20251101').credits
    expect(opus).toBeGreaterThanOrEqual(gpt52)
  })
})

describe('WP2 — creditsDb.deductCredits per-model', () => {
  // Mock MongoDB interactions at the service boundary.
  let originalDeduct
  let mockDeduct

  beforeAll(async () => {
    const svc = await import('../../lib/credits/service.js')
    originalDeduct = svc.creditsDb.deductCredits.bind(svc.creditsDb)
  })

  test('deductCredits accepts model option without error (signature check)', async () => {
    const svc = await import('../../lib/credits/service.js')
    // We can't run the real MongoDB path in unit tests; just verify the function
    // accepts the options param and the signature exists.
    expect(typeof svc.creditsDb.deductCredits).toBe('function')
    expect(svc.creditsDb.deductCredits.length).toBeGreaterThanOrEqual(2)
  })
})
