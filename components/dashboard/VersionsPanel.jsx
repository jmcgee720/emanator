'use client'

import { useEffect, useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { X, History, Clock, RotateCcw, Trash2, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Versions panel — shows all snapshots for a project (auto-created after every
 * brief build + a pre-restore safety snapshot before each rollback). User can
 * restore a version or delete old ones.
 *
 * Props:
 *   project   — project record
 *   onClose   — close the modal
 *   onRestored — called after a successful restore (so caller can refresh files)
 */
export default function VersionsPanel({ project, onClose, onRestored }) {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(null) // snapshot id being restored
  const [deleting, setDeleting] = useState(null)   // snapshot id being deleted
  const [err, setErr] = useState('')
  const [confirmingRestore, setConfirmingRestore] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  async function load() {
    setLoading(true); setErr('')
    try {
      const res = await authFetch(`/api/projects/${project.id}/snapshots`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Load failed')
      // Filter out share-link snapshots and keep only real version history
      const versions = (Array.isArray(data) ? data : [])
        .filter((s) => !(s.name || '').startsWith('__share__'))
      setSnapshots(versions)
    } catch (e) {
      setErr(e.message || 'Failed to load versions')
    } finally {
      setLoading(false)
    }
  }

  async function restore(snap) {
    setRestoring(snap.id); setErr('')
    try {
      const res = await authFetch(`/api/snapshots/${snap.id}/restore`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Restore failed')
      onRestored?.({ snapshot: snap, restoredFiles: data.restored_files || 0 })
      await load()
      setConfirmingRestore(null)
    } catch (e) {
      setErr(e.message || 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  async function remove(snap) {
    setDeleting(snap.id); setErr('')
    try {
      const res = await authFetch(`/api/snapshots/${snap.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      setSnapshots((prev) => prev.filter((s) => s.id !== snap.id))
    } catch (e) {
      setErr(e.message || 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const kindLabel = (snap) => {
    const kind = snap?.metadata?.kind
    if (kind === 'auto_build') return { label: 'Auto · Build', color: 'text-[var(--em-cyan)]', bg: 'bg-[rgba(0,229,255,0.08)] border-[rgba(0,229,255,0.20)]' }
    if (kind === 'pre_restore') return { label: 'Auto · Pre-restore', color: 'text-amber-300', bg: 'bg-amber-500/5 border-amber-500/20' }
    return { label: 'Manual', color: 'text-white/80', bg: 'bg-white/5 border-white/10' }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="versions-panel-title"
      data-testid="versions-panel"
    >
      <div className="w-full max-w-2xl mx-4 em-glass rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[var(--em-cyan)]" aria-hidden="true" />
            <h2 id="versions-panel-title" className="text-sm font-semibold em-text-primary">Versions</h2>
            <span className="text-[11px] em-text-muted" data-testid="versions-count">{snapshots.length}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Close"
            data-testid="versions-panel-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[12px] em-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading versions…
            </div>
          ) : err ? (
            <p role="alert" className="flex items-center gap-2 text-[12px] text-red-400" data-testid="versions-error">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {err}
            </p>
          ) : snapshots.length === 0 ? (
            <div className="py-12 text-center">
              <Clock className="w-8 h-8 mx-auto mb-3 text-[var(--em-text-muted)]" aria-hidden="true" />
              <p className="text-[12px] em-text-secondary mb-1">No versions yet</p>
              <p className="text-[11px] em-text-muted">Versions are created automatically after each build.</p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="versions-list">
              {snapshots.map((snap) => {
                const kind = kindLabel(snap)
                const isCurrent = snapshots[0]?.id === snap.id
                return (
                  <li
                    key={snap.id}
                    className="group rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    data-testid={`version-row-${snap.id}`}
                  >
                    <div className="flex items-start gap-3 p-3">
                      <div className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wider border ${kind.bg} ${kind.color}`}>
                        {kind.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[12px] em-text-primary truncate">
                          <span className="truncate">{snap.name}</span>
                          {isCurrent ? (
                            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[9px] font-semibold">
                              <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" /> latest
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] em-text-muted">
                          <span>{new Date(snap.created_at).toLocaleString()}</span>
                          <span aria-hidden="true">·</span>
                          <span>{snap.metadata?.file_count ?? '?'} files</span>
                          {snap.metadata?.brand ? (<>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{snap.metadata.brand}</span>
                          </>) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!isCurrent ? (
                          confirmingRestore === snap.id ? (
                            <>
                              <button
                                onClick={() => restore(snap)}
                                disabled={restoring === snap.id}
                                className="px-2 py-1 rounded-md text-[10px] font-semibold bg-[var(--em-cyan)] text-black hover:bg-[var(--em-cyan)]/90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                data-testid={`version-confirm-restore-${snap.id}`}
                              >
                                {restoring === snap.id ? 'Restoring…' : 'Confirm restore'}
                              </button>
                              <button
                                onClick={() => setConfirmingRestore(null)}
                                className="px-2 py-1 rounded-md text-[10px] em-text-secondary hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmingRestore(snap.id)}
                              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--em-text-secondary)] hover:text-[var(--em-cyan)] hover:bg-[rgba(0,229,255,0.08)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40"
                              aria-label="Restore this version"
                              data-testid={`version-restore-btn-${snap.id}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )
                        ) : null}
                        <button
                          onClick={() => remove(snap)}
                          disabled={deleting === snap.id}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--em-text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 disabled:opacity-50"
                          aria-label="Delete this version"
                          data-testid={`version-delete-btn-${snap.id}`}
                        >
                          {deleting === snap.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.30)] text-[10px] em-text-muted">
          Restoring creates a safety snapshot of the current state so you can undo.
        </div>
      </div>
    </div>
  )
}
