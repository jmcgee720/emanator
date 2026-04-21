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
  { amount: 100, price: 10, label: '$10' },
  { amount: 500, price: 45, label: '$45' },
  { amount: 1000, price: 80, label: '$80' },
]

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
        updated_at: new Date().toISOString(),
      }
      await db.collection('credits_balance').insertOne({ ...doc })
    }

    return { balance: doc.balance, updated_at: doc.updated_at }
  },

  async addCredits(userId, amount) {
    const db = await getDb()
    const now = new Date().toISOString()

    const result = await db.collection('credits_balance').findOneAndUpdate(
      { user_id: userId },
      {
        $inc: { balance: parseFloat(amount) },
        $set: { updated_at: now },
        $setOnInsert: { user_id: userId },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } }
    )

    return { balance: result.balance, updated_at: result.updated_at }
  },

  async deductCredits(userId, actionType) {
    const cost = CREDIT_COSTS[actionType]
    if (cost === undefined) {
      return { error: `Unknown action type: ${actionType}` }
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
      created_at: now,
    })

    return { balance: result.balance, cost, action_type: actionType }
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
