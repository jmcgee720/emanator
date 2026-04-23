import { MongoClient } from 'mongodb'

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test_database'

let client = null
let db = null

async function getDb() {
  if (db) return db
  client = new MongoClient(MONGO_URL)
  await client.connect()
  db = client.db(DB_NAME)

  // Ensure indexes
  await db.collection('credits_balance').createIndex({ user_id: 1 }, { unique: true })
  await db.collection('credits_usage').createIndex({ user_id: 1, created_at: -1 })

  return db
}

export const CREDIT_COSTS = {
  chat_message: 0.5,
  plan_generation: 2.0,
  file_apply: 3.0,
  image_generation: 5.0,
  code_review: 1.0,
  canvas_update: 0.25,
  comparison: 0.5, // per-lane cost in the A/B compare endpoint
}

// Model-specific cost multipliers (base = chat_message cost)
export const MODEL_COSTS = {
  // OpenAI
  'gpt-5.2':                          { credits: 1.5,  tier: 'premium',  label: 'Premium' },
  'gpt-5.1':                          { credits: 1.25, tier: 'high',     label: 'High' },
  'gpt-4o':                           { credits: 1.0,  tier: 'high',     label: 'High' },
  'gpt-4o-mini':                      { credits: 0.25, tier: 'standard', label: 'Standard' },
  'o3':                               { credits: 2.0,  tier: 'premium',  label: 'Premium' },
  // Anthropic
  'claude-sonnet-4-5-20250929':       { credits: 1.25, tier: 'high',     label: 'High' },
  'claude-opus-4-5-20251101':         { credits: 2.5,  tier: 'premium',  label: 'Premium' },
  'claude-haiku-4-5-20251001':        { credits: 0.3,  tier: 'standard', label: 'Standard' },
  // Legacy Anthropic aliases
  'claude-sonnet-4-6':                { credits: 1.0,  tier: 'high',     label: 'High' },
  'claude-opus-4-6':                  { credits: 2.5,  tier: 'premium',  label: 'Premium' },
  'claude-haiku-4-5':                 { credits: 0.25, tier: 'standard', label: 'Standard' },
  // Google
  'gemini-2.5-pro':                   { credits: 1.0,  tier: 'high',     label: 'High' },
  'gemini-3-flash-preview':           { credits: 0.5,  tier: 'standard', label: 'Standard' },
  'gemini-2.5-flash':                 { credits: 0.25, tier: 'standard', label: 'Standard' },
}

const DEFAULT_MODEL_COST = { credits: 0.5, tier: 'standard', label: 'Standard' }

export function getModelCost(model) {
  return MODEL_COSTS[model] || DEFAULT_MODEL_COST
}

export function estimateRequestCost(model, visualMode) {
  const baseCost = getModelCost(model).credits
  if (visualMode === 'custom') return baseCost * 3 // Premium tier: 3x for AI image generation
  return baseCost
}

export const CREDIT_PACKAGES = [
  { amount: 100, price: 10, label: '$10', id: 'starter' },
  { amount: 500, price: 45, label: '$45', id: 'pro' },
  { amount: 1000, price: 80, label: '$80', id: 'ultra' },
]

/**
 * Loyalty tiers — the more a user has purchased lifetime (in USD),
 * the bigger the bonus credits applied on top of each new pack purchase.
 * Applied at `addCredits` time so the user sees "+10% loyalty bonus" in the UI.
 */
export const LOYALTY_TIERS = [
  { minLifetimeUsd: 0,   bonusPercent: 0,  label: 'Starter' },
  { minLifetimeUsd: 25,  bonusPercent: 5,  label: 'Regular' },
  { minLifetimeUsd: 100, bonusPercent: 15, label: 'Loyal' },
  { minLifetimeUsd: 500, bonusPercent: 25, label: 'VIP' },
]

// First-purchase bonus — every user gets +50% on their very first pack
// (stacks on top of loyalty bonus, but loyalty at first purchase is always
// Starter = 0%, so this is effectively just the 50% boost on the first buy).
export const FIRST_PURCHASE_BONUS_PERCENT = 50

// Referral bonus — both referrer AND new user earn this many credits when
// the new user completes their first paid purchase.
export const REFERRAL_BONUS_CREDITS = 25

export function resolveLoyaltyTier(lifetimeUsd = 0) {
  const amt = Number(lifetimeUsd) || 0
  let tier = LOYALTY_TIERS[0]
  for (const t of LOYALTY_TIERS) {
    if (amt >= t.minLifetimeUsd) tier = t
  }
  return tier
}

/**
 * Apply loyalty bonus + optional first-purchase bonus.
 * @param {number} baseCredits - credits from the pack definition
 * @param {number} lifetimeUsd - user's current lifetime USD spend (pre-purchase)
 * @param {object} opts - { isFirstPurchase?: boolean }
 */
export function applyLoyaltyBonus(baseCredits, lifetimeUsd = 0, opts = {}) {
  const tier = resolveLoyaltyTier(lifetimeUsd)
  const loyaltyBonus = Math.floor((baseCredits * tier.bonusPercent) / 100)
  const firstBonus = opts.isFirstPurchase
    ? Math.floor((baseCredits * FIRST_PURCHASE_BONUS_PERCENT) / 100)
    : 0
  const bonus = loyaltyBonus + firstBonus
  return {
    baseCredits,
    bonus,
    loyaltyBonus,
    firstPurchaseBonus: firstBonus,
    total: baseCredits + bonus,
    tier,
  }
}

const DEFAULT_BALANCE = 50.0

export const creditsDb = {
  async getBalance(userId) {
    const db = await getDb()
    let doc = await db.collection('credits_balance').findOne(
      { user_id: userId },
      { projection: { _id: 0 } }
    )

    if (!doc) {
      doc = {
        user_id: userId,
        balance: DEFAULT_BALANCE,
        lifetime_purchased_usd: 0,
        first_purchase_completed: false,
        updated_at: new Date().toISOString(),
      }
      await db.collection('credits_balance').insertOne({ ...doc })
    }

    const lifetime = Number(doc.lifetime_purchased_usd || 0)
    const tier = resolveLoyaltyTier(lifetime)
    return {
      balance: doc.balance,
      updated_at: doc.updated_at,
      lifetime_purchased_usd: lifetime,
      first_purchase_completed: !!doc.first_purchase_completed,
      referred_by: doc.referred_by || null,
      referral_payout_completed: !!doc.referral_payout_completed,
      loyalty_tier: tier,
    }
  },

  /**
   * Grant credits from a Stripe purchase.
   * - `amount` = base credits from the server-defined package
   * - `pricePaidUsd` = USD paid (used to increment lifetime + unlock higher tiers)
   * Applies loyalty bonus on top of the base credits when `pricePaidUsd` is provided.
   * Returns {balance, baseCredits, bonusCredits, totalGranted, tier}.
   */
  async addCredits(userId, amount, opts = {}) {
    const db = await getDb()
    const now = new Date().toISOString()
    const base = parseFloat(amount)
    const pricePaidUsd = Number(opts.pricePaidUsd || 0)

    // Snapshot current state BEFORE incrementing so the bonus reflects the
    // tier + first-purchase status the user was in at purchase time.
    const current = await this.getBalance(userId)
    const isFirstPurchase = pricePaidUsd > 0 && !current.first_purchase_completed
    const { bonus, loyaltyBonus, firstPurchaseBonus, total, tier } = applyLoyaltyBonus(
      base,
      current.lifetime_purchased_usd,
      { isFirstPurchase },
    )

    const update = {
      $inc: { balance: total, lifetime_purchased_usd: pricePaidUsd },
      $set: { updated_at: now },
      $setOnInsert: { user_id: userId },
    }
    if (isFirstPurchase) {
      update.$set.first_purchase_completed = true
      update.$set.first_purchase_at = now
    }

    const result = await db.collection('credits_balance').findOneAndUpdate(
      { user_id: userId },
      update,
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
    )

    // Referral payout: if this is the first purchase AND the user was
    // referred, grant REFERRAL_BONUS_CREDITS to BOTH parties, idempotent.
    let referralBonus = 0
    let referrerId = null
    if (isFirstPurchase && current.referred_by && !current.referral_payout_completed) {
      referrerId = current.referred_by
      // Flip the flag FIRST so a concurrent call can't double-pay.
      const flipped = await db.collection('credits_balance').findOneAndUpdate(
        { user_id: userId, referral_payout_completed: { $ne: true } },
        { $set: { referral_payout_completed: true, referral_payout_at: now } },
        { returnDocument: 'after', projection: { _id: 0 } },
      )
      if (flipped) {
        // Credit both sides.
        await Promise.all([
          db.collection('credits_balance').updateOne(
            { user_id: userId },
            { $inc: { balance: REFERRAL_BONUS_CREDITS }, $set: { updated_at: now } },
          ),
          db.collection('credits_balance').updateOne(
            { user_id: referrerId },
            { $inc: { balance: REFERRAL_BONUS_CREDITS }, $set: { updated_at: now } },
            { upsert: true },
          ),
        ])
        referralBonus = REFERRAL_BONUS_CREDITS
        result.balance = (result.balance || 0) + REFERRAL_BONUS_CREDITS
        console.log(`[Credits] Referral payout: ${referrerId} → ${userId}, +${REFERRAL_BONUS_CREDITS} each`)
      }
    }

    return {
      balance: result.balance,
      baseCredits: base,
      bonusCredits: bonus,
      loyaltyBonus,
      firstPurchaseBonus,
      referralBonus,
      referrerId,
      totalGranted: total + referralBonus,
      loyalty_tier: tier,
      isFirstPurchase,
      updated_at: result.updated_at,
    }
  },

  /**
   * Record that `newUserId` was referred by `referrerUserId`.
   * Idempotent — only writes if `referred_by` is currently unset, and
   * rejects self-referral.
   * Returns {recorded: bool, reason?: string}.
   */
  async recordReferral(newUserId, referrerUserId) {
    if (!newUserId || !referrerUserId) {
      return { recorded: false, reason: 'missing_ids' }
    }
    if (newUserId === referrerUserId) {
      return { recorded: false, reason: 'self_referral' }
    }
    const db = await getDb()
    // Ensure the referrer has a balance doc so they exist.
    const referrer = await db.collection('credits_balance').findOne(
      { user_id: referrerUserId },
      { projection: { _id: 0, user_id: 1 } },
    )
    if (!referrer) {
      return { recorded: false, reason: 'invalid_referrer' }
    }
    // Check if the new user already has a referral recorded.
    const existing = await db.collection('credits_balance').findOne(
      { user_id: newUserId },
      { projection: { _id: 0, referred_by: 1 } },
    )
    if (existing && existing.referred_by) {
      return { recorded: false, reason: 'already_referred' }
    }
    // Upsert the referral (creates balance doc for new user if absent).
    await db.collection('credits_balance').updateOne(
      { user_id: newUserId },
      {
        $set: { referred_by: referrerUserId, referred_at: new Date().toISOString() },
        $setOnInsert: {
          user_id: newUserId,
          balance: DEFAULT_BALANCE,
          lifetime_purchased_usd: 0,
          first_purchase_completed: false,
        },
      },
      { upsert: true },
    )
    return { recorded: true }
  },

  async deductCredits(userId, actionType, opts = {}) {
    let cost = CREDIT_COSTS[actionType]
    if (cost === undefined) {
      return { error: `Unknown action type: ${actionType}` }
    }

    // Per-model burn: if the caller passes `{model}` and the action is an
    // LLM call, use the model's tier-adjusted cost instead of the flat one.
    // This makes GPT-5.2 burn 3× the credits of Gemini Flash, as configured
    // in MODEL_COSTS.
    const MODEL_SENSITIVE = new Set(['chat_message', 'plan_generation', 'code_review'])
    if (opts.model && MODEL_SENSITIVE.has(actionType)) {
      cost = estimateRequestCost(opts.model, opts.visualMode)
    }

    const db = await getDb()
    const current = await this.getBalance(userId)

    if (current.balance < cost) {
      return { error: 'Insufficient credits', balance: current.balance, required: cost }
    }

    const now = new Date().toISOString()

    const result = await db.collection('credits_balance').findOneAndUpdate(
      { user_id: userId, balance: { $gte: cost } },
      {
        $inc: { balance: -cost },
        $set: { updated_at: now },
      },
      { returnDocument: 'after', projection: { _id: 0 } }
    )

    if (!result) {
      return { error: 'Insufficient credits', balance: current.balance, required: cost }
    }

    // Log usage
    await db.collection('credits_usage').insertOne({
      user_id: userId,
      action_type: actionType,
      cost,
      model: opts.model || null,
      created_at: now,
    })

    return { balance: result.balance, cost, action_type: actionType, model: opts.model || null }
  },

  async getUsageHistory(userId, limit = 50) {
    const db = await getDb()
    const docs = await db.collection('credits_usage')
      .find({ user_id: userId }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()

    return docs
  },
}
