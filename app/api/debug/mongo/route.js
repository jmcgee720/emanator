// TEMPORARY debug endpoint — returns raw MongoDB connection status.
// DELETE this file after debugging.
import { NextResponse } from 'next/server'
import { MongoClient } from 'mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.MONGO_URL
  const dbName = process.env.DB_NAME

  const report = {
    mongo_url_set: Boolean(url),
    mongo_url_length: url ? url.length : 0,
    mongo_url_starts_with: url ? url.slice(0, 20) + '...' : null,
    mongo_url_ends_with: url ? '...' + url.slice(-30) : null,
    db_name: dbName,
    node_version: process.version,
    connection: null,
    error: null,
  }

  if (!url) {
    report.error = 'MONGO_URL not set'
    return NextResponse.json(report, { status: 500 })
  }

  let client
  try {
    client = new MongoClient(url, { serverSelectionTimeoutMS: 8000 })
    await client.connect()
    const db = client.db(dbName || 'test_database')
    const collections = await db.listCollections().toArray()
    report.connection = {
      ok: true,
      collections_count: collections.length,
      sample_collections: collections.slice(0, 3).map((c) => c.name),
    }
    return NextResponse.json(report)
  } catch (err) {
    report.connection = { ok: false }
    report.error = {
      name: err.name || null,
      message: err.message || String(err),
      code: err.code || null,
      codeName: err.codeName || null,
    }
    return NextResponse.json(report, { status: 500 })
  } finally {
    if (client) await client.close().catch(() => {})
  }
}
