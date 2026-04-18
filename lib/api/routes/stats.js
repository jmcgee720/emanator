import { NextResponse } from 'next/server'
import { handleCORS } from '@/lib/api/helpers'
import { getSupabaseAdmin } from '@/lib/supabase/db'

/**
 * Public build-time stats endpoint for the landing page credibility marker.
 * Computes P50/P95/count from successful `new_pipeline:*` runs in generation_runs.
 * No auth — these are marketing stats, intentionally public.
 *
 * Cache is per-request (Next.js default), suitable for a landing page.
 */

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null
  const idx = Math.floor(sortedArr.length * p)
  return sortedArr[Math.min(idx, sortedArr.length - 1)]
}

export async function handle(route, method, path, request) {
  if (route === '/stats/build-times' && method === 'GET') {
    try {
      // Last 200 successful new-pipeline builds (30-day window is plenty)
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const supabaseAdmin = getSupabaseAdmin()
      const { data, error } = await supabaseAdmin
        .from('generation_runs')
        .select('tool_mode, duration, created_at')
        .ilike('tool_mode', 'new_pipeline%')
        .eq('success', true)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) {
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }

      const durationsSeconds = (data || [])
        .map((r) => Math.round((r.duration || 0) / 1000))
        .filter((s) => s > 5 && s < 900)  // clamp: exclude anomalies (<5s or >15min)
        .sort((a, b) => a - b)

      // Per-archetype counts
      const byArchetype = {}
      for (const r of data || []) {
        const arch = (r.tool_mode || '').split(':')[1] || 'unknown'
        byArchetype[arch] = (byArchetype[arch] || 0) + 1
      }

      const result = {
        total_builds: durationsSeconds.length,
        p50_seconds: percentile(durationsSeconds, 0.5),
        p95_seconds: percentile(durationsSeconds, 0.95),
        fastest_seconds: durationsSeconds[0] || null,
        archetype_counts: byArchetype,
      }

      return handleCORS(NextResponse.json(result, {
        headers: { 'Cache-Control': 'public, max-age=60' }, // 1 min cache
      }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  return null
}
