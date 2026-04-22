import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { rollupAnalytics } from '@/lib/analytics/rollup'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

/**
 * GET /api/analytics?days=30
 *
 * Returns the user's generation_runs aggregated into dashboard
 * metrics: total builds / success rate / avg & p95 duration /
 * per-provider + per-model + per-archetype counts / daily timeline.
 *
 * Rolling window defaults to 30 days, capped at 180.
 */
export async function GET(request) {
  const authUser = await getAuthUser(request)
  if (!authUser) {
    return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) {
    return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
  }

  const url = new URL(request.url)
  const rawDays = Number(url.searchParams.get('days') || '30')
  const days = Math.min(Math.max(1, Number.isFinite(rawDays) ? rawDays : 30), 180)
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  let runs = []
  try {
    runs = await db.generationRuns.findByUserSince(dbUser.id, sinceIso, 500)
  } catch (err) {
    console.warn('[api/analytics] fetch failed:', err.message)
  }

  const summary = rollupAnalytics(runs)
  return handleCORS(NextResponse.json({ window: { days, sinceIso }, ...summary }))
}
