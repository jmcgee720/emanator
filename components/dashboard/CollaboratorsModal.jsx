'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Users, UserPlus, Trash2, Loader2, Mail, Shield, Eye } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

/**
 * Collaborators modal — invite by email, list collaborators, remove.
 * Owner-only (the API enforces it too). Roles: viewer | editor.
 *
 * Rendered conditionally from the parent; dismisses on Escape + backdrop click.
 * Fixed: Added p-4 padding and max-h-[90vh] to prevent top cropping.
 */
export default function CollaboratorsModal({ open, onClose, projectId, projectName }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  // DIAGNOSTIC: verify modal is rendering with new code
  useEffect(() => {
    if (open) console.log('[CollaboratorsModal] Mounted with padding fix (v2)')
  }, [open])

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const r = await authFetch(`/api/projects/${projectId}/collaborators`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error || `Request failed (${r.status})`)
      }
      const j = await r.json()
      setList(j.collaborators || [])
    } catch (err) {
      setError(err.message || 'Failed to load collaborators.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { if (open) load() }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const invite = useCallback(async (e) => {
    e?.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setError(null)
    try {
      const r = await authFetch(`/api/projects/${projectId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`)
      setEmail('')
      await load()
    } catch (err) {
      setError(err.message || 'Failed to invite.')
    } finally {
      setInviting(false)
    }
  }, [email, role, projectId, load])

  const remove = useCallback(async (userId) => {
    if (!userId) return
    if (!confirm('Remove this collaborator from the project?')) return
    setRemovingId(userId)
    setError(null)
    try {
      const r = await authFetch(`/api/projects/${projectId}/collaborators?user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`)
      setList((prev) => prev.filter((c) => c.user_id !== userId))
    } catch (err) {
      setError(err.message || 'Failed to remove.')
    } finally {
      setRemovingId(null)
    }
  }, [projectId])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      data-testid="collaborators-modal"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0D1220] shadow-2xl" style={{ margin: 'auto' }}>
        <div className="flex items-start justify-between p-5 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/45">
              <Users className="w-3 h-3" /> Collaborators
            </div>
            <h2 className="text-lg font-semibold text-white mt-1">{projectName || 'Project'}</h2>
            <p className="text-xs text-white/50 mt-1">Invite teammates to view or edit this project.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-white/50 hover:bg-white/5 hover:text-white"
            data-testid="collaborators-close"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={invite} className="p-5 border-b border-white/5 space-y-2.5" data-testid="collaborators-invite-form">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/35" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/40"
                data-testid="collaborators-email-input"
                required
              />
            </div>
            <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
              {['viewer', 'editor'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`inline-flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium ${role === r ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/55 hover:bg-white/5'}`}
                  data-testid={`collaborators-role-${r}`}
                >
                  {r === 'editor' ? <Shield className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {r}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={inviting || !email.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--em-cyan,#00e5ff)] text-[#0C1018] text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
              data-testid="collaborators-invite-btn"
            >
              {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Invite
            </button>
          </div>
          {error && <p className="text-xs text-rose-300" data-testid="collaborators-error">{error}</p>}
          <p className="text-[10px] text-white/35">
            Your teammate must have an Auroraly account already — ask them to sign up first if they haven't.
          </p>
        </form>

        <div className="p-5 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-white/45 text-sm" data-testid="collaborators-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : list.length === 0 ? (
            <div className="text-center text-white/40 text-sm py-6" data-testid="collaborators-empty">
              No collaborators yet. Invite someone above.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="collaborators-list">
              {list.map((c) => (
                <li
                  key={c.user_id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.015]"
                  data-testid={`collaborator-${c.user_id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-semibold text-white/70">
                    {(c.name || c.email || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/90 truncate">{c.name || c.email}</div>
                    <div className="text-[10px] text-white/45 truncate">{c.email}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${c.role === 'editor' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-white/5 text-white/55'}`}>
                    {c.role === 'editor' ? <Shield className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                    {c.role}
                  </span>
                  <button
                    onClick={() => remove(c.user_id)}
                    disabled={removingId === c.user_id}
                    className="p-1.5 rounded text-white/30 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
                    data-testid={`collaborator-remove-${c.user_id}`}
                    aria-label={`Remove ${c.email}`}
                  >
                    {removingId === c.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
