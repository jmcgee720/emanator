'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Eye, GitFork, Sparkles, ArrowLeft, ExternalLink } from 'lucide-react'

/**
 * Public project gallery — landing page for discovering what others have built.
 * Each card links to /share/{token} where the visitor can preview and remix.
 *
 * This page is public (no auth) so it can be shared on social media.
 */
export default function GalleryPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/gallery?limit=24')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load gallery')
        if (!cancelled) setItems(data.items || [])
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load gallery')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-black text-white" data-testid="gallery-page">
      <header className="px-6 py-4 flex items-center justify-between border-b border-white/10">
        <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-[12px]" data-testid="gallery-back-home">
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back
        </Link>
        <h1 className="text-[13px] font-semibold">Gallery</h1>
        <Link
          href="/"
          className="text-[11px] px-3 py-1.5 rounded-lg bg-[rgba(0,229,255,0.10)] border border-[rgba(0,229,255,0.25)] text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.15)] transition-colors font-semibold"
          data-testid="gallery-build-cta"
        >
          Build your own
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <section className="mb-10 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[rgba(138,43,226,0.12)] border border-[rgba(138,43,226,0.30)] text-violet-300 text-[10px] font-semibold mb-4">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            <span>Made with Auroraly</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-3">Apps built by the community</h2>
          <p className="text-white/60 text-sm md:text-base max-w-xl mx-auto">
            Every app here was generated from a single brief. Preview any of them, or Remix to start from someone else's work.
          </p>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-white/40 text-[12px]" data-testid="gallery-loading">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="text-center py-20 text-[12px] text-red-400" role="alert" data-testid="gallery-error">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20" data-testid="gallery-empty">
            <p className="text-white/60 text-sm mb-4">No public apps yet. Be the first to publish.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black font-semibold text-[12px] hover:scale-[1.02] transition-transform"
              data-testid="gallery-empty-cta"
            >
              Build the first one <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="gallery-grid">
            {items.map((item) => (
              <GalleryCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-20 py-6 text-center text-[10px] text-white/40">
        <span>Browse, remix, or build your own with Auroraly.</span>
      </footer>
    </div>
  )
}

function GalleryCard({ item }) {
  return (
    <Link
      href={`/share/${item.share_token}`}
      className="group block rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 overflow-hidden transition-all duration-200 hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      data-testid={`gallery-card-${item.id}`}
      aria-label={`Open ${item.name}`}
    >
      {/* Thumbnail: simple gradient tile for now — can be upgraded to a real screenshot later */}
      <div className="aspect-video w-full bg-gradient-to-br from-violet-600/30 via-indigo-600/20 to-cyan-600/30 flex items-center justify-center" aria-hidden="true">
        <span className="text-white/50 text-xs font-mono truncate max-w-[75%]">{item.name}</span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-semibold text-[13px] truncate" data-testid={`gallery-card-name-${item.id}`}>
            {item.name}
          </h3>
          {item.archetype ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[9px] font-semibold uppercase tracking-wider">
              {item.archetype.replace(/_/g, ' ')}
            </span>
          ) : null}
        </div>

        {item.description ? (
          <p className="text-[11px] text-white/50 line-clamp-2 mb-3">{item.description}</p>
        ) : null}

        <div className="flex items-center gap-3 text-[10px] text-white/40">
          {item.views > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3 h-3" aria-hidden="true" /> {item.views}
            </span>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-1 text-[var(--em-cyan)] group-hover:text-white transition-colors font-semibold">
            <GitFork className="w-3 h-3" aria-hidden="true" /> Remix
          </span>
        </div>
      </div>
    </Link>
  )
}
