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
      .project({ _id: 1, user_id: 1, url: 1, created_at: 1, updated_at: 1, 'extracted_data.title': 1, 'extracted_data.meta_description': 1, 'extracted_data.word_count': 1, opportunities: 1 })
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
}
