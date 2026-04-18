'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { X, Globe, Check, AlertTriangle, Loader2, ExternalLink, Sparkles } from 'lucide-react'

/**
 * Small modal for publishing (or unpublishing) a project to the public gallery.
 * Publishing also ensures the project has a never-expiring share token.
 */
export default function PublishModal({ project, onClose, onChanged }) {
  const isPublic = !!project?.settings?.is_public
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [justPublished, setJustPublished] = useState(null) // { share_token }

  async function handlePublish() {
    setErr(''); setLoading(true)
    try {
      const res = await authFetch(`/api/projects/${project.id}/publish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      setJustPublished({ share_token: data.share_token })
      onChanged?.(data.project)
    } catch (e) {
      setErr(e.message || 'Publish failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleUnpublish() {
    setErr(''); setLoading(true)
    try {
      const res = await authFetch(`/api/projects/${project.id}/unpublish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unpublish failed')
      onChanged?.(data.project)
      onClose?.()
    } catch (e) {
      setErr(e.message || 'Unpublish failed')
    } finally {
      setLoading(false)
    }
  }

  const currentlyPublic = isPublic || !!justPublished

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
      data-testid="publish-modal"
    >
      <div className="w-full max-w-md mx-4 em-glass rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--em-cyan)]" aria-hidden="true" />
            <h2 id="publish-modal-title" className="text-sm font-semibold em-text-primary">
              {currentlyPublic ? 'Public on the gallery' : 'Publish to gallery'}
            </h2>
            {currentlyPublic ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium" data-testid="publish-modal-status-public">
                <Check className="w-3 h-3" aria-hidden="true" /> Live
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Close"
            data-testid="publish-modal-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {justPublished ? (
            <>
              <div className="flex items-center gap-2 text-[12px] text-emerald-400">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                You're live on the gallery.
              </div>
              <a
                href={`/share/${justPublished.share_token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(0,229,255,0.08)] border border-[rgba(0,229,255,0.25)] text-[var(--em-cyan)] text-[12px] hover:bg-[rgba(0,229,255,0.12)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40"
                data-testid="publish-modal-view-share"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                View public page
              </a>
              <a
                href="/gallery"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] em-text-secondary text-[12px] hover:bg-[rgba(255,255,255,0.07)] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                data-testid="publish-modal-open-gallery"
              >
                <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                Browse the gallery
              </a>
            </>
          ) : isPublic ? (
            <p className="text-[12px] em-text-secondary leading-relaxed">
              This app is visible on the public gallery. Anyone can preview it, and remix it into their own account.
            </p>
          ) : (
            <>
              <p className="text-[12px] em-text-secondary leading-relaxed">
                Add your app to the Emanator public gallery. Anyone can preview it and <strong>remix</strong> it into their own Emanator account.
              </p>
              <ul className="text-[11px] em-text-muted space-y-1.5 pl-4 list-disc">
                <li>A permanent share URL is created (if you don't already have one).</li>
                <li>Unpublish anytime — visitors lose gallery access; the share URL stays valid.</li>
                <li>Remix creates a fresh copy for the visitor; your original is untouched.</li>
              </ul>
            </>
          )}

          {err ? (
            <p role="alert" aria-live="polite" className="flex items-center gap-2 text-[11px] text-red-400" data-testid="publish-modal-error">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {err}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.30)]">
          {isPublic && !justPublished ? (
            <>
              <button
                onClick={handleUnpublish}
                disabled={loading}
                className="text-[11px] em-text-secondary hover:text-red-400 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 rounded mr-auto"
                data-testid="publish-modal-unpublish"
              >
                Unpublish
              </button>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-[11px] em-text-secondary hover:bg-[rgba(255,255,255,0.08)] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                data-testid="publish-modal-done"
              >
                Done
              </button>
            </>
          ) : justPublished ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--em-cyan)] text-black hover:bg-[var(--em-cyan)]/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              data-testid="publish-modal-done-after"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-[11px] em-text-secondary hover:bg-[rgba(255,255,255,0.08)] hover:text-white transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                data-testid="publish-modal-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--em-cyan)] text-black hover:bg-[var(--em-cyan)]/90 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                data-testid="publish-modal-publish"
              >
                {loading ? <><Loader2 className="w-3 h-3 animate-spin" /> Publishing…</> : <>Publish</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
