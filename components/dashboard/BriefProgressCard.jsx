'use client'

/**
 * BriefProgressCard — live-updating progress display for the new brief pipeline.
 * Shows archetype detection, plan summary, per-wave status, and review/repair outcome.
 *
 * Rendered in LeftPanel.jsx when message.metadata.briefProgress is present.
 */
import { Sparkles, Loader2, CheckCircle2, AlertCircle, Wrench, Timer, Share2, Shuffle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ARCHETYPES } from '@/lib/ai/archetypes'
import BuildObservatoryPanel from './BuildObservatoryPanel'

const WAVE_STATUS_ICON = {
  pending: <span className="w-3.5 h-3.5 rounded-full border border-white/20 bg-white/5" />,
  running: <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />,
  complete: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  error: <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
}

export default function BriefProgressCard({ progress }) {
  if (!progress) return null
  const { archetype, artDirection, plan, waves, review, repair, status, startedAt, manifest, screenshotVerify, visualLoopSummary } = progress

  const waveList = waves || []
  const totalFilesBuilt = waveList.reduce((n, w) => n + (w.filesBuilt?.length || 0), 0)
  const plannedFileCount = plan?.waves?.reduce((n, w) => n + (w.files?.length || 0), 0) || 0

  // Rough estimate: scaffold ~12s, each other wave ~15–25s, review+repair ~10s
  const remainingWaves = waveList.filter((w) => w.status !== 'complete' && w.status !== 'error').length
  const estimatedSecondsRemaining = remainingWaves * 18 + (status === 'reviewing' || status === 'repairing' ? 10 : 0)

  // Live "time to working app" counter
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  useEffect(() => {
    if (!startedAt || status === 'complete') return
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [startedAt, status])

  // Once complete, freeze the elapsed time
  const displayElapsed = status === 'complete' && startedAt
    ? Math.floor(((progress.completedAt || Date.now()) - startedAt) / 1000)
    : elapsedSeconds

  return (
    <div
      className="mt-2 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 backdrop-blur-sm p-4"
      data-testid="brief-progress-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-medium text-white/90">
          {status === 'classifying' && 'Identifying archetype…'}
          {status === 'planning' && 'Planning app structure…'}
          {status === 'building' && `Building ${plan?.brand?.name || 'app'}`}
          {status === 'reviewing' && 'Reviewing for missing flows…'}
          {status === 'repairing' && 'Auto-repairing gaps…'}
          {status === 'complete' && `Built ${plan?.brand?.name || 'app'} — ${totalFilesBuilt} files`}
        </span>
        {status !== 'complete' && status !== 'error' && estimatedSecondsRemaining > 0 ? (
          <span className="ml-auto text-[10px] text-white/40">~{estimatedSecondsRemaining}s remaining</span>
        ) : null}
        {status === 'complete' && displayElapsed > 0 ? (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400" data-testid="brief-elapsed-time">
            <Timer className="w-3 h-3" />
            {displayElapsed}s to working app
          </span>
        ) : null}
        {status !== 'complete' && status !== 'error' && startedAt && displayElapsed > 0 ? (
          <span className="flex items-center gap-1 text-[10px] text-white/40 ml-2" data-testid="brief-live-elapsed">
            <Timer className="w-3 h-3" />
            {displayElapsed}s
          </span>
        ) : null}
      </div>

      {/* Archetype badge */}
      {archetype ? (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200" data-testid="archetype-badge">
            {archetype.label || archetype.id}
          </span>
          <span className="text-white/40">•</span>
          <span className="text-white/50">{plan?.routes?.length || 0} routes</span>
          <span className="text-white/40">•</span>
          <span className="text-white/50">{plannedFileCount || '…'} files</span>
        </div>
      ) : null}

      {/* Art direction chip (expandable) */}
      {artDirection?.summary ? (
        <details className="mb-3 group" data-testid="art-direction-summary">
          <summary className="cursor-pointer list-none flex items-center gap-2 text-xs text-[var(--em-cyan)] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40 rounded">
            <span aria-hidden="true">🖼</span>
            <span>Art direction from {artDirection.imageCount || 1} reference{artDirection.imageCount === 1 ? '' : 's'}</span>
            <span className="text-white/40 group-open:rotate-90 transition-transform" aria-hidden="true">›</span>
          </summary>
          <pre className="mt-2 p-3 rounded-lg bg-[rgba(0,229,255,0.04)] border border-[rgba(0,229,255,0.15)] text-[11px] text-white/70 whitespace-pre-wrap font-sans leading-relaxed">{artDirection.summary}</pre>
        </details>
      ) : null}

      {/* Wave list */}
      {waveList.length > 0 ? (
        <div className="space-y-1.5" data-testid="wave-list">
          {waveList.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-xs" data-testid={`wave-row-${w.id}`}>
              {WAVE_STATUS_ICON[w.status] || WAVE_STATUS_ICON.pending}
              <span className={w.status === 'complete' ? 'text-white/80' : w.status === 'running' ? 'text-white' : 'text-white/50'}>
                {w.label || w.id}
              </span>
              {w.status === 'complete' && w.filesBuilt?.length > 0 ? (
                <span className="ml-auto text-[10px] text-white/40">{w.filesBuilt.length} file{w.filesBuilt.length === 1 ? '' : 's'}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Review/repair status */}
      {review ? (
        <div className="mt-3 pt-3 border-t border-white/5">
          {review.ok ? (
            <div className="flex items-center gap-2 text-xs text-emerald-400" data-testid="review-ok">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Review passed — all flows wired</span>
            </div>
          ) : repair?.filesRepaired?.length > 0 ? (
            <div className="flex items-start gap-2 text-xs text-emerald-400" data-testid="review-repaired">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <div>Fixed {repair.filesRepaired.length} issue(s) during review</div>
                <div className="text-white/40 mt-0.5 text-[10px]">Auto-repair addressed the gaps surfaced by self-review.</div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-amber-300" data-testid="review-gaps">
              <Wrench className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <div>{review.missing.length + review.broken.length} issue(s) need attention</div>
                <div className="text-amber-200/70 mt-1 text-[10px]">
                  Self-review flagged these but auto-repair didn't fully resolve them. Open Preview to check, or send a message describing what's off and I'll fix it.
                </div>
                {(review.missing?.length > 0 || review.broken?.length > 0) ? (
                  <ul className="mt-1.5 text-[10px] text-amber-200/60 list-disc pl-4 space-y-0.5" data-testid="review-gap-list">
                    {[...(review.missing || []), ...(review.broken || [])].slice(0, 4).map((g, i) => (
                      <li key={i} className="truncate">{typeof g === 'string' ? g : (g.detail || g.file || JSON.stringify(g).slice(0, 80))}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Share build time (only when complete) */}
      {status === 'complete' && displayElapsed > 0 && plan?.brand?.name ? (
        <ShareBuildTime
          brand={plan.brand.name}
          archetype={archetype?.label || 'app'}
          seconds={displayElapsed}
          fileCount={totalFilesBuilt}
        />
      ) : null}

      {/* Remix archetype (only when complete) */}
      {status === 'complete' && plan?.brand?.name ? (
        <RemixArchetype
          brand={plan.brand.name}
          currentArchetypeId={plan.archetypeId || archetype?.id}
        />
      ) : null}
    </div>
  )
}

function RemixArchetype({ brand, currentArchetypeId }) {
  const [open, setOpen] = useState(false)

  const pickRemix = (archetypeId) => {
    // Compose a Creative Brief message matching the pipeline's detection string.
    // This pre-fills the chat composer — user clicks Send to actually remix.
    const brief = [
      `Build this project now with COMPLETE, production-ready output.`,
      ``,
      `Brand name (MUST use this exact name throughout the UI): ${brand}`,
      `Archetype override: ${archetypeId}`,
      ``,
      `Remix: rebuild this project using the ${ARCHETYPES[archetypeId]?.label || archetypeId} archetype. Keep the brand name and tone; replace the file set with what this archetype needs.`,
    ].join('\n')

    const composerInput = document.querySelector('[data-testid="chat-input"]')
    if (composerInput) {
      composerInput.focus()
      // Some composers are textarea (value), others contenteditable. Handle both.
      if ('value' in composerInput) {
        composerInput.value = brief
      } else {
        composerInput.textContent = brief
      }
      composerInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setOpen(false)
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/5" data-testid="remix-archetype">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="remix-archetype-button"
        className="flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white/90 transition-colors"
      >
        <Shuffle className="w-3 h-3" />
        Remix as different archetype
      </button>
      {open ? (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5 p-2 rounded-xl bg-black/40 border border-white/10" data-testid="remix-archetype-picker">
          {Object.values(ARCHETYPES)
            .filter((a) => a.id !== currentArchetypeId)
            .slice(0, 12)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pickRemix(a.id)}
                data-testid={'remix-pick-' + a.id}
                className="text-left px-2 py-1.5 rounded-lg text-[10px] text-white/70 hover:bg-white/5 hover:text-white transition-colors"
              >
                {a.label}
              </button>
            ))}
        </div>
      ) : null}
      {open ? (
        <p className="mt-2 text-[10px] text-white/40">Picking one will pre-fill the chat with a remix brief — click Send to rebuild.</p>
      ) : null}
    </div>
  )
}

function ShareBuildTime({ brand, archetype, seconds, fileCount }) {
  const [copied, setCopied] = useState(false)

  const tweet = `I just built ${brand} — a working ${archetype.toLowerCase()} with ${fileCount} files in ${seconds} seconds. 🚀`
  const hashtag = '#Auroraly'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${tweet} ${hashtag}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet + ' ' + hashtag)}`

  return (
    <div className="mt-3 pt-3 border-t border-white/5" data-testid="share-build-time">
      <div className="flex items-center gap-2">
        <button
          onClick={copy}
          data-testid="share-copy-button"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white/80 hover:bg-white/10 transition-colors"
          title={tweet}
        >
          <Share2 className="w-3 h-3" />
          {copied ? 'Copied' : 'Share build time'}
        </button>
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="share-tweet-link"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-400/20 text-[11px] text-violet-200 hover:from-violet-500/30 hover:to-indigo-500/30 transition-colors"
        >
          Tweet it
        </a>
      </div>

      {manifest && (
        <div className="mt-3" data-testid="brief-progress-observatory">
          <BuildObservatoryPanel manifest={manifest} screenshotVerify={screenshotVerify} visualLoopSummary={visualLoopSummary} />
        </div>
      )}
    </div>
  )
}
