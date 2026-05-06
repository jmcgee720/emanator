import { NextResponse } from 'next/server'
import { handleCORS } from '@/lib/api/helpers'
import { getDb } from '@/lib/mongodb'

// Single document in the `aurora_config` collection holds the shared config.
// Using _id: 'singleton' guarantees a single row.
const COLLECTION = 'aurora_config'
const DOC_ID = 'singleton'

export async function handle(route, method, path, request) {
  if (route !== '/aurora/config') return null

  if (method === 'GET') {
    try {
      const db = await getDb()
      const doc = await db.collection(COLLECTION).findOne(
        { _id: DOC_ID },
        { projection: { _id: 0 } }
      )
      return handleCORS(NextResponse.json(doc || {}))
    } catch (err) {
      // Don't break the app if MongoDB is momentarily unreachable; just
      // return {} so the frontend falls back to its hardcoded defaults.
      console.error('[aurora] GET failed:', err.message)
      return handleCORS(NextResponse.json({}))
    }
  }

  if (method === 'POST') {
    try {
      const body = await request.json()
      const update = {
        layers: body.layers || null,
        effects: body.effects || null,
        version: typeof body.version === 'number' ? body.version : null,
        updatedAt: new Date().toISOString(),
      }
      const db = await getDb()
      await db.collection(COLLECTION).updateOne(
        { _id: DOC_ID },
        { $set: update },
        { upsert: true }
      )
      return handleCORS(NextResponse.json({ ok: true }))
    } catch (err) {
      console.error('[aurora] POST failed:', err.message)
      return handleCORS(NextResponse.json({ error: 'Save failed' }, { status: 500 }))
    }
  }

  return null
}
