'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Loader2, ArrowLeft, Zap, CheckCircle2, AlertTriangle, TrendingUp, Clock, Layers, Activity } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

/**
 * Analytics dashboard — per-user rollup of every build run in the
 * rolling window. Reads from /api/analytics, requires auth.
 */
export default function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(30)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    authFetch(`/api/analytics?days=${days}`)
      .then(async (r) => {
        if (r.status === 401) throw new Error('Please sign in to view your analytics.')
        if (!r.ok) throw new Error(`Request failed: ${r.status}`)
        return r.json()
      })
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load analytics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0D14] text-white flex items-center justify-center" data-testid="analytics-loading">
        <div className="flex flex-col items-center gap-3 text-white/60">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          <span className="text-sm">Loading analytics…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0D14] text-white flex items-center justify-center px-6" data-testid="analytics-error">
        <div className="max-w-md text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-rose-400" />
          <p className="text-sm text-rose-300">{error}</p>
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
            <ArrowLeft className="w-3 h-3" /> Back home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0D14] text-white" data-testid="analytics-page">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <AnalyticsHeader days={days} setDays={setDays} />
        <KeyMetricsRow data={data} />
        <BuildTimeline timeline={data?.timeline} />
        <div className="grid gap-4 md:grid-cols-3 mt-8">
          <BreakdownCard title="By provider" icon={Zap} items={data?.byProvider} testid="analytics-by-provider" />
          <BreakdownCard title="By model" icon={Activity} items={data?.byModel} testid="analytics-by-model" />
          <BreakdownCard title="By archetype" icon={Layers} items={data?.byArchetype} testid="analytics-by-archetype" />
        </div>
        <RecentBuilds recent={data?.recent} />
      </div>
    </div>
  )
}

function AnalyticsHeader({ days, setDays }) {
  const options = [7, 30, 90, 180]
  return (
    <div className="flex items-start justify-between mb-8" data-testid="analytics-header">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-white/45 hover:text-white/70 mb-3">
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Build analytics</h1>
        <p className="text-sm text-white/55 mt-1">Your pipeline activity across the last {days} days.</p>
      </div>
      <div className="inline-flex rounded border border-white/10 overflow-hidden" data-testid="analytics-window-toggle">
        {options.map((n) => (
          <button
            key={n}
            onClick={() => setDays(n)}
            className={`px-3 py-1.5 text-xs font-medium ${days === n ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/55 hover:bg-white/5'}`}
            data-testid={`analytics-window-${n}`}
          >
            {n}d
          </button>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, sub, icon: Icon, testid, tone = 'default' }) {
  const tones = {
    default: 'text-white',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid={testid}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/45">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tones[tone] || tones.default}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
}

function KeyMetricsRow({ data }) {
  const sr = Number(data?.successRate || 0)
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="analytics-metrics">
      <Metric
        label="Total builds" value={data?.totalBuilds ?? 0}
        sub={`${data?.totalFiles ?? 0} files generated`}
        icon={TrendingUp} testid="metric-total-builds"
      />
      <Metric
        label="Success rate" value={`${Math.round(sr * 100)}%`}
        sub={sr >= 0.9 ? 'healthy' : sr >= 0.7 ? 'watchable' : 'investigate'}
        icon={CheckCircle2}
        tone={sr >= 0.9 ? 'good' : sr >= 0.7 ? 'default' : 'warn'}
        testid="metric-success-rate"
      />
      <Metric
        label="Avg duration"
        value={formatMs(data?.avgDurationMs)}
        sub="per build"
        icon={Clock} testid="metric-avg-duration"
      />
      <Metric
        label="p95 duration"
        value={formatMs(data?.p95DurationMs)}
        sub="slowest 5%"
        icon={Clock} testid="metric-p95-duration"
      />
      <Metric
        label="Distinct providers"
        value={Object.keys(data?.byProvider || {}).length}
        sub={`${Object.keys(data?.byModel || {}).length} models`}
        icon={Zap} testid="metric-providers"
      />
    </div>
  )
}

function BuildTimeline({ timeline }) {
  const rows = Array.isArray(timeline) ? timeline : []
  const max = useMemo(() => rows.reduce((m, r) => Math.max(m, r.builds || 0), 0) || 1, [rows])
  if (rows.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/40 text-sm" data-testid="analytics-timeline-empty">
        No builds in this window yet.
      </div>
    )
  }
  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5" data-testid="analytics-timeline">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/45">
          <TrendingUp className="w-3 h-3" /> Builds per day
        </div>
        <div className="text-[10px] text-white/40">{rows.length} day{rows.length === 1 ? '' : 's'} with activity</div>
      </div>
      <div className="flex items-end gap-1 h-32" role="img" aria-label="Builds per day bar chart">
        {rows.map((r) => {
          const h = Math.max(4, (r.builds / max) * 100)
          const successHeight = r.builds > 0 ? (r.success / r.builds) * h : 0
          return (
            <div
              key={r.date}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${r.date} · ${r.builds} build${r.builds === 1 ? '' : 's'} · ${r.success}/${r.builds} success`}
              data-testid={`timeline-day-${r.date}`}
            >
              <div className="w-full bg-white/5 rounded-t" style={{ height: `${h}%` }}>
                <div className="w-full bg-emerald-400/70 rounded-t" style={{ height: `${r.builds > 0 ? (successHeight / h) * 100 : 0}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-white/40 font-mono">
        <span>{rows[0]?.date}</span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400/70 rounded-sm" /> success</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-white/10 rounded-sm" /> total</span>
        </span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function BreakdownCard({ title, icon: Icon, items, testid }) {
  const entries = Object.entries(items || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid={testid}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/45 mb-3">
        <Icon className="w-3 h-3" /> {title}
      </div>
      {entries.length === 0 ? (
        <div className="text-xs text-white/35 italic">no data</div>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(([key, n]) => (
            <li key={key} className="grid grid-cols-[1fr_auto] items-center gap-2" data-testid={`${testid}-row-${key}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white/75 truncate">{key}</span>
                <span className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                  <span className="block h-full bg-cyan-400/60" style={{ width: `${(n / total) * 100}%` }} />
                </span>
              </div>
              <span className="font-mono text-[11px] text-white/60 tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentBuilds({ recent }) {
  const rows = Array.isArray(recent) ? recent : []
  if (rows.length === 0) return null
  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02]" data-testid="analytics-recent">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 text-[10px] uppercase tracking-wider text-white/45">
        <Activity className="w-3 h-3" /> Recent builds
      </div>
      <div className="divide-y divide-white/5">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 py-2.5 text-[11px]" data-testid={`recent-row-${r.id}`}>
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${r.success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
              {r.success ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white/80">
                <span className="font-mono text-white/55 truncate max-w-[280px]">{r.tool_mode || 'unknown'}</span>
                <span className="text-white/30">·</span>
                <span className="text-white/55">{r.files_generated || 0} files</span>
              </div>
              <div className="text-white/35 text-[10px]">{r.provider || 'unknown'} / {r.model || 'unknown'}</div>
            </div>
            <span className="font-mono text-[10px] text-white/45">{formatMs(r.duration)}</span>
            <span className="font-mono text-[10px] text-white/35 whitespace-nowrap">{formatRelative(r.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatMs(ms) {
  if (!Number.isFinite(Number(ms)) || ms <= 0) return '—'
  const n = Number(ms)
  if (n < 1000) return `${n}ms`
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`
  return `${(n / 60_000).toFixed(1)}m`
}

function formatRelative(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const delta = Date.now() - t
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`
  return `${Math.round(delta / 86_400_000)}d ago`
}
