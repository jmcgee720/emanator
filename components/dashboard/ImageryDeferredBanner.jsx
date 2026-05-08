// ──────────────────────────────────────────────────────────────────────
// ImageryDeferredBanner — Lever 2 CTA
//
// Shown above the preview iframe when the project's first build deferred
// imagery (Phase 4). Lets the user opt-in to image generation as an
// explicit, credit-aware action instead of forcing it during the
// auto-flow that ballooned page sizes.
//
// Visibility contract: render only when
//   project?.settings?.imagery_status === 'deferred'
//
// On click → POST /api/build/imagery/generate, then ping `onDone()` so
// PreviewTab can refresh the file list and re-render.
// ──────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

export function ImageryDeferredBanner({ project, onDone }) {
  const status = project?.settings?.imagery_status
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  if (status !== 'deferred') return null
  if (!project?.id) return null

  const handleGenerate = async () => {
    setRunning(true)
    setError(null)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiBase}/api/build/imagery/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectId: project.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      // Caller refreshes files; banner will hide once project.settings
      // is re-fetched and imagery_status flips to 'generated'.
      if (typeof onDone === 'function') onDone(data)
    } catch (err) {
      setError(err.message || 'Imagery generation failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      className="px-3 py-2 border-b border-emerald-900/40 bg-gradient-to-r from-emerald-950/40 via-cyan-950/30 to-emerald-950/40 flex items-center justify-between gap-3"
      data-testid="imagery-deferred-banner"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles className="w-4 h-4 text-emerald-300 shrink-0" />
        <div className="text-[11px] leading-snug min-w-0">
          <div className="font-medium text-emerald-100/90">
            Preview ready — imagery is on placeholders
          </div>
          <div className="text-emerald-200/60">
            Iterate on copy &amp; structure first. Add brand imagery when you&apos;re happy with the bones.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {error && (
          <span className="inline-flex items-center gap-1 text-[10px] text-red-300" data-testid="imagery-banner-error">
            <AlertTriangle className="w-3 h-3" /> {error}
          </span>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={running}
          data-testid="imagery-generate-btn"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 border border-emerald-500/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {running ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> Generating imagery…
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" /> Generate brand imagery
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// Tiny pill version used inline in the toolbar — keeps the CTA discoverable
// even when the user has scrolled past the main banner.
export function ImageryGeneratedPill({ project }) {
  const status = project?.settings?.imagery_status
  if (status !== 'generated') return null
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300/80 border border-emerald-500/20"
      data-testid="imagery-generated-pill"
      title="Brand imagery has been generated for this project"
    >
      <CheckCircle2 className="w-2.5 h-2.5" /> Imagery
    </span>
  )
}
