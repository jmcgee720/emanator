/**
 * Shared MongoDB client / connection.
 *
 * The credits service has its own local copy of this logic for historical
 * reasons; this module is the canonical one new route handlers (e.g., Stripe)
 * should import.
 */

import { MongoClient } from 'mongodb'

const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME || 'test_database'

let client = null
let db = null

export async function getDb() {
  if (db) return db
  if (!MONGO_URL) throw new Error('MONGO_URL is required')
  client = new MongoClient(MONGO_URL)
  await client.connect()
  db = client.db(DB_NAME)
  return db
}

export async function closeDb() {
  if (client) {
    await client.close()
    client = null
    db = null
  }
}
