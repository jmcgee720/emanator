import { NextResponse } from 'next/server'
import { handleCORS } from '@/lib/api/helpers'

// In-memory config cache (persists across requests within a server lifecycle)
let auroraConfig = null

export async function handle(route, method, path, request) {
  if (route !== '/aurora/config') return null

  if (method === 'GET') {
    return handleCORS(NextResponse.json(auroraConfig || {}))
  }

  if (method === 'POST') {
    try {
      const body = await request.json()
      auroraConfig = { layers: body.layers || null, effects: body.effects || null }
      return handleCORS(NextResponse.json({ ok: true }))
    } catch {
      return handleCORS(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }))
    }
  }

  return null
}
