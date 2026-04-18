'use client'

import { useEffect, useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { Zap, Sparkles, TrendingUp } from 'lucide-react'

/**
 * "Your builds this week" widget.
 * Shows a quick personal-stats chip row above the Projects grid:
 *   - total builds completed in the last 7 days
 *   - fastest build time
 *   - favorite archetype (most frequent)
 *
 * Fetches /api/stats/my-builds. Fails silently if the user is unauthed
 * or has no builds yet — the widget simply doesn't render.
 */
export default function MyBuildsWidget() {
  const [stats, setStats] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch('/api/stats/my-builds')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStats(data)
      } catch {
        // widget hides itself on any error
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Hide entirely if unauthed, empty, or still loading
  if (!loaded || !stats || !stats.total_this_week) return null

  const { total_this_week, fastest_seconds, favorite_archetype } = stats

  return (
    <section
      className="mb-4"
      aria-label="Your builds this week"
      data-testid="my-builds-widget"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(0,229,255,0.08)] border border-[rgba(0,229,255,0.20)] text-[11px]"
          data-testid="my-builds-total"
        >
          <TrendingUp className="w-3 h-3 text-[var(--em-cyan)]" aria-hidden="true" />
          <span className="text-[var(--em-cyan)] font-semibold">{total_this_week}</span>
          <span className="text-[var(--em-text-secondary)]">
            {total_this_week === 1 ? 'build' : 'builds'} this week
          </span>
        </div>

        {typeof fastest_seconds === 'number' ? (
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-[11px]"
            data-testid="my-builds-fastest"
          >
            <Zap className="w-3 h-3 text-amber-300" aria-hidden="true" />
            <span className="em-text-primary font-semibold">{fastest_seconds}s</span>
            <span className="text-[var(--em-text-secondary)]">fastest</span>
          </div>
        ) : null}

        {favorite_archetype?.label ? (
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] text-[11px]"
            data-testid="my-builds-favorite"
          >
            <Sparkles className="w-3 h-3 text-violet-300" aria-hidden="true" />
            <span className="text-[var(--em-text-secondary)]">favorite:</span>
            <span className="em-text-primary font-semibold truncate max-w-[180px]">
              {favorite_archetype.label}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
