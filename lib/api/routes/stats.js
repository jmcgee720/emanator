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

      // Per-archetype stats: count + success rate + avg duration
      const allWithStatus = (await supabaseAdmin
        .from('generation_runs')
        .select('tool_mode, duration, success')
        .ilike('tool_mode', 'new_pipeline%')
        .gte('created_at', since)
        .limit(500)).data || []

      const archetypeStats = {}
      for (const r of allWithStatus) {
        const arch = (r.tool_mode || '').split(':')[1] || 'unknown'
        if (!archetypeStats[arch]) {
          archetypeStats[arch] = { total: 0, succeeded: 0, duration_sum_ms: 0, succeeded_duration_ms: 0 }
        }
        archetypeStats[arch].total++
        if (r.success) {
          archetypeStats[arch].succeeded++
          archetypeStats[arch].succeeded_duration_ms += (r.duration || 0)
        }
      }
      const byArchetype = {}
      for (const [id, s] of Object.entries(archetypeStats)) {
        byArchetype[id] = {
          total: s.total,
          success_rate: s.total > 0 ? Math.round((s.succeeded / s.total) * 100) : 0,
          avg_seconds: s.succeeded > 0 ? Math.round(s.succeeded_duration_ms / s.succeeded / 1000) : null,
        }
      }

      const result = {
        total_builds: durationsSeconds.length,
        p50_seconds: percentile(durationsSeconds, 0.5),
        p95_seconds: percentile(durationsSeconds, 0.95),
        fastest_seconds: durationsSeconds[0] || null,
        archetype_counts: Object.fromEntries(Object.entries(byArchetype).map(([k, v]) => [k, v.total])),
        archetype_stats: byArchetype,
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
