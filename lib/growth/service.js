import { MongoClient, ObjectId } from 'mongodb'

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test_database'

let client = null
let db = null

async function getDb() {
  if (db) return db
  client = new MongoClient(MONGO_URL)
  await client.connect()
  db = client.db(DB_NAME)

  await db.collection('growth_pages').createIndex({ user_id: 1, created_at: -1 })
  await db.collection('growth_pages').createIndex({ user_id: 1, url: 1 })
  await db.collection('growth_feedback').createIndex({ user_id: 1, page_id: 1, content_type: 1, persona_id: 1 }, { unique: true })

  return db
}

export const growthDb = {
  async savePage(userId, pageData) {
    const db = await getDb()
    const doc = {
      user_id: userId,
      url: pageData.url,
      extracted_data: pageData.extracted_data,
      opportunities: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const result = await db.collection('growth_pages').insertOne(doc)
    return { id: result.insertedId.toString(), ...doc }
  },

  async getPages(userId) {
    const db = await getDb()
    const docs = await db.collection('growth_pages')
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .project({ _id: 1, user_id: 1, url: 1, created_at: 1, updated_at: 1, 'extracted_data.title': 1, 'extracted_data.meta_description': 1, 'extracted_data.word_count': 1, opportunities: 1, fixes: 1, drafts: 1, drafts_generated_at: 1, crawl_mode: 1, parent_seed_url: 1 })
      .toArray()

    return docs.map(d => ({ id: d._id.toString(), ...d, _id: undefined }))
  },

  async getPage(pageId, userId) {
    const db = await getDb()
    let oid
    try { oid = new ObjectId(pageId) } catch { return null }

    const doc = await db.collection('growth_pages').findOne(
      { _id: oid, user_id: userId }
    )
    if (!doc) return null
    return { id: doc._id.toString(), ...doc, _id: undefined }
  },

  async saveOpportunities(pageId, userId, opportunities) {
    const db = await getDb()
    let oid
    try { oid = new ObjectId(pageId) } catch { return null }

    const result = await db.collection('growth_pages').findOneAndUpdate(
      { _id: oid, user_id: userId },
      { $set: { opportunities, updated_at: new Date().toISOString() } },
      { returnDocument: 'after' }
    )
    if (!result) return null
    return { id: result._id.toString(), ...result, _id: undefined }
  },

  async deletePage(pageId, userId) {
    const db = await getDb()
    let oid
    try { oid = new ObjectId(pageId) } catch { return false }

    const result = await db.collection('growth_pages').deleteOne({ _id: oid, user_id: userId })
    return result.deletedCount > 0
  },

  async getAllPagesFull(userId) {
    const db = await getDb()
    const docs = await db.collection('growth_pages')
      .find({ user_id: userId }, { projection: { _id: 0, user_id: 0 } })
      .sort({ created_at: -1 })
      .toArray()
    return docs
  },
}

export const personaDb = {
  async createPersona(userId, data) {
    const db = await getDb()
    const doc = {
      user_id: userId,
      project_id: data.project_id || null,
      name: data.name,
      description: data.description || '',
      interests: data.interests || [],
      platforms: data.platforms || [],
      content_types: data.content_types || [],
      performance_score: data.performance_score || 0,
      created_at: new Date().toISOString(),
    }
    const result = await db.collection('persona_profiles').insertOne(doc)
    return { id: result.insertedId.toString(), ...doc, _id: undefined }
  },

  async getPersonas(userId) {
    const db = await getDb()
    const docs = await db.collection('persona_profiles')
      .find({ user_id: userId })
      .sort({ performance_score: -1, created_at: -1 })
      .project({ _id: 1, user_id: 1, project_id: 1, name: 1, description: 1, interests: 1, platforms: 1, content_types: 1, performance_score: 1, feedback_count: 1, created_at: 1 })
      .toArray()
    return docs.map(d => ({ id: d._id.toString(), ...d, _id: undefined }))
  },

  async deletePersona(personaId, userId) {
    const db = await getDb()
    let oid
    try { oid = new ObjectId(personaId) } catch { return false }
    const result = await db.collection('persona_profiles').deleteOne({ _id: oid, user_id: userId })
    return result.deletedCount > 0
  },

  async updatePersonaScore(personaId, userId, delta) {
    const db = await getDb()
    let oid
    try { oid = new ObjectId(personaId) } catch { return false }
    const result = await db.collection('persona_profiles').updateOne(
      { _id: oid, user_id: userId },
      { $inc: { performance_score: delta, feedback_count: 1 } }
    )
    return result.modifiedCount > 0
  },
}

export const feedbackDb = {
  async submitFeedback(userId, data) {
    const db = await getDb()
    // Upsert: one rating per user/page/content_type/persona combo
    const filter = {
      user_id: userId,
      page_id: data.page_id,
      content_type: data.content_type,
      persona_id: data.persona_id || null,
    }
    const existing = await db.collection('growth_feedback').findOne(filter)
    const oldRating = existing?.rating || 0

    const doc = {
      ...filter,
      rating: data.rating,
      created_at: new Date().toISOString(),
    }
    await db.collection('growth_feedback').updateOne(filter, { $set: doc }, { upsert: true })

    return { rating: data.rating, old_rating: oldRating }
  },

  async getFeedback(userId, pageId) {
    const db = await getDb()
    const docs = await db.collection('growth_feedback')
      .find({ user_id: userId, page_id: pageId })
      .project({ _id: 0, content_type: 1, rating: 1, persona_id: 1 })
      .toArray()
    return docs
  },
}
