'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/auth-fetch'
import { X, Database, CheckCircle2, ExternalLink, AlertTriangle } from 'lucide-react'

/**
 * Minimal Supabase backend opt-in for generated apps.
 *
 * When a user saves a URL + anon key, the brief-builder pipeline:
 *   1. Emits components/supabaseClient.jsx into the scaffold wave
 *   2. Swaps AuthContext + MockAPIProvider recipes for Supabase-wired variants
 *   3. The Vercel export bundler swaps in real Vite/env supabase client code
 *
 * The preview keeps working (the client is null → code falls back to
 * localStorage). The exported app uses the user's real Supabase project.
 */
export default function BackendConfigModal({ project, onClose, onSaved }) {
  const supa = project?.settings?.supabase || {}
  const stripe = project?.settings?.stripe || {}
  const [url, setUrl] = useState(supa.url || '')
  const [anonKey, setAnonKey] = useState(supa.anonKey || '')
  const [stripeKey, setStripeKey] = useState(stripe.publishableKey || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const isEnabled = !!(supa.url && supa.anonKey)
  const isStripeEnabled = !!stripe.publishableKey

  const save = async () => {
    setErr('')
    const trimmedUrl = url.trim()
    const trimmedKey = anonKey.trim()
    const trimmedStripe = stripeKey.trim()
    if (trimmedUrl && !/^https?:\/\/.+/.test(trimmedUrl)) {
      setErr('Supabase URL must start with https://')
      return
    }
    if (trimmedStripe && !/^pk_(test|live)_/.test(trimmedStripe)) {
      setErr('Stripe key must start with pk_test_ or pk_live_ (never the secret key!)')
      return
    }
    setSaving(true)
    try {
      const nextSettings = { ...(project.settings || {}) }
      if (trimmedUrl && trimmedKey) {
        nextSettings.supabase = { url: trimmedUrl, anonKey: trimmedKey, configuredAt: new Date().toISOString() }
      } else {
        delete nextSettings.supabase
      }
      if (trimmedStripe) {
        nextSettings.stripe = { publishableKey: trimmedStripe, configuredAt: new Date().toISOString() }
      } else {
        delete nextSettings.stripe
      }
      const res = await authFetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: nextSettings }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save')
      }
      const data = await res.json()
      onSaved?.(data.project)
      onClose?.()
    } catch (e) {
      setErr(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async () => {
    setUrl('')
    setAnonKey('')
    setStripeKey('')
    setTimeout(save, 0)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backend-config-title"
      data-testid="backend-config-modal"
    >
      <div className="w-full max-w-lg mx-4 em-glass rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--em-cyan)]" aria-hidden="true" />
            <h2 id="backend-config-title" className="text-sm font-semibold em-text-primary">Wire up a real backend</h2>
            {isEnabled ? (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium" data-testid="backend-config-status-enabled">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Connected
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--em-text-secondary)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Close"
            data-testid="backend-config-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-[12px] text-[var(--em-text-secondary)] leading-relaxed">
            Paste your Supabase project URL and anon public key. Every NEW build from this project will auto-wire real Supabase auth + CRUD. Existing builds stay on the preview mock.
          </p>

          <div>
            <label htmlFor="backend-supabase-url" className="block text-[11px] font-medium em-text-secondary mb-1.5">Supabase URL</label>
            <input
              id="backend-supabase-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://abcxyz.supabase.co"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] em-text-primary text-[12px] placeholder:text-[var(--em-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40 focus:border-[rgba(0,229,255,0.30)]"
              data-testid="backend-supabase-url"
            />
          </div>

          <div>
            <label htmlFor="backend-supabase-key" className="block text-[11px] font-medium em-text-secondary mb-1.5">Anon public key</label>
            <input
              id="backend-supabase-key"
              type="password"
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="eyJ…"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] em-text-primary text-[12px] font-mono placeholder:text-[var(--em-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40 focus:border-[rgba(0,229,255,0.30)]"
              data-testid="backend-supabase-key"
            />
            <p className="mt-1 text-[10px] em-text-muted">
              This is the <strong>anon public</strong> key, safe for client-side use — never paste the service_role key.
            </p>
          </div>

          <a
            href="https://supabase.com/dashboard/project/_/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-[var(--em-cyan)] hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded"
            data-testid="backend-supabase-docs-link"
          >
            Where to find these <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>

          <div className="pt-4 mt-2 border-t border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="backend-stripe-key" className="block text-[11px] font-medium em-text-secondary">Stripe publishable key <span className="em-text-muted">(optional)</span></label>
              {isStripeEnabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 text-[10px] font-medium" data-testid="backend-stripe-status-enabled">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Connected
                </span>
              ) : null}
            </div>
            <input
              id="backend-stripe-key"
              type="password"
              value={stripeKey}
              onChange={(e) => setStripeKey(e.target.value)}
              placeholder="pk_test_… or pk_live_…"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] em-text-primary text-[12px] font-mono placeholder:text-[var(--em-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--em-cyan)]/40 focus:border-[rgba(0,229,255,0.30)]"
              data-testid="backend-stripe-key"
            />
            <p className="mt-1 text-[10px] em-text-muted">
              Only the <strong>publishable</strong> key. Checkout sessions are created server-side — see the exported README for the serverless endpoint template.
            </p>
          </div>

          {err ? (
            <p role="alert" aria-live="polite" className="flex items-center gap-2 text-[11px] text-red-400" data-testid="backend-config-error">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {err}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.30)]">
          {isEnabled ? (
            <button
              onClick={disconnect}
              disabled={saving}
              className="text-[11px] em-text-secondary hover:text-red-400 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 rounded"
              data-testid="backend-config-disconnect"
            >
              Disconnect
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-[11px] em-text-secondary hover:bg-[rgba(255,255,255,0.08)] hover:text-white transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              data-testid="backend-config-cancel"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !url.trim() || !anonKey.trim()}
              className="px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--em-cyan)] text-black hover:bg-[var(--em-cyan)]/90 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              data-testid="backend-config-save"
            >
              {saving ? 'Saving…' : isEnabled ? 'Update' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
