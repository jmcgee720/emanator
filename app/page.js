'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import LoginPage from '@/components/auth/LoginPage'
import { Loader2 } from 'lucide-react'

const Dashboard = dynamic(() => import('@/components/dashboard/Dashboard'), {
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading Auroraly...</p>
      </div>
    </div>
  ),
  ssr: false,
})

export default function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [dbUser, setDbUser] = useState(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessMessage, setAccessMessage] = useState('')

  const supabaseRef = useRef(null)
  if (!supabaseRef.current) {
    supabaseRef.current = createClient()
  }
  const supabase = supabaseRef.current

  const validateAccess = useCallback(async (authUser, accessToken) => {
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
      }

      // Detect OAuth provider from Supabase user metadata
      const provider = authUser.app_metadata?.provider || authUser.app_metadata?.providers?.[0] || 'email'

      // Retry 3x on transient errors. We've seen ~30-90s Supabase
      // Cloudflare 522 outages that recover automatically. Without a
      // retry, every reload during one of those windows shows
      // "Access Denied" — misleading and scary for users.
      const TRANSIENT_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524])
      const ATTEMPTS = 3
      let lastErr = null
      let response = null
      let data = null
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        try {
          response = await fetch('/api/auth/check', {
            method: 'POST',
            headers,
            body: JSON.stringify({ email: authUser.email, provider }),
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (TRANSIENT_STATUS.has(response.status)) {
            lastErr = { transient: true, status: response.status }
            if (attempt < ATTEMPTS - 1) {
              await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)))
              continue
            }
          }
          // Defensive parse — Supabase 5xx HTML pages occasionally slip through.
          const txt = await response.text()
          try { data = txt ? JSON.parse(txt) : null } catch { data = null }
          if (!data) {
            lastErr = { transient: true, status: response.status }
            if (attempt < ATTEMPTS - 1) {
              await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)))
              continue
            }
          }
          break
        } catch (err) {
          clearTimeout(timeout)
          lastErr = { transient: err?.name === 'AbortError' || /fetch|network|ECONN/i.test(err?.message || ''), error: err }
          if (attempt < ATTEMPTS - 1) {
            await new Promise(r => setTimeout(r, 600 * Math.pow(2, attempt)))
            continue
          }
          throw err
        }
      }

      if (!data) {
        // All retries exhausted on a transient error — say so clearly.
        // DO NOT call this "Access Denied"; the user's account is fine.
        setUser(authUser)
        setAccessDenied(true)
        setAccessMessage(
          lastErr?.transient
            ? `Supabase is temporarily unreachable (status ${lastErr.status || 'network'}). Hit reload in a moment — your account is fine.`
            : 'Unable to verify access. Please try again.'
        )
        return
      }

      if (data.allowed) {
        setUser(authUser)
        setDbUser(data.user)
        setAccessDenied(false)
        if (accessToken) {
          sessionStorage.setItem('mymergent_token', accessToken)
        }
      } else {
        setUser(authUser)
        setAccessDenied(true)
        setAccessMessage(data.message || 'Access denied. Contact owner for approval.')
      }
    } catch (error) {
      setUser(authUser)
      setAccessDenied(true)
      setAccessMessage(
        error?.name === 'AbortError'
          ? 'Supabase timed out. Hit reload in a moment — your account is fine.'
          : 'Unable to verify access. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial session check on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        // Timeout the session check to avoid hanging on "Loading Auroraly..."
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('session_timeout')), 10000))
        const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise])
        if (!mounted) return
        if (session?.user) {
          await validateAccess(session.user, session.access_token)
        } else {
          setLoading(false)
        }
      } catch (err) {
        // Any error (AbortError, timeout, network) — just show login page
        if (err?.name === 'AbortError') {
          console.warn('[Auth] Lock aborted during init — showing login')
        } else if (err?.message === 'session_timeout') {
          console.warn('[Auth] Session check timed out — showing login')
        }
        if (mounted) setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setDbUser(null)
        setAccessDenied(false)
        setLoading(false)
        sessionStorage.removeItem('mymergent_token')
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user)
        if (session.access_token) {
          sessionStorage.setItem('mymergent_token', session.access_token)
        }
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, validateAccess])

  // Called by LoginPage with the session from signInWithPassword/signUp result
  const handleAuthSuccess = useCallback(async (session) => {
    setLoading(true)
    if (session?.user) {
      await validateAccess(session.user, session.access_token)
    } else {
      // Fallback: try reading session (shouldn't be needed, but safety net)
      try {
        const { data } = await supabase.auth.getSession()
        if (data.session?.user) {
          await validateAccess(data.session.user, data.session.access_token)
          return
        }
      } catch {}
      setLoading(false)
    }
  }, [supabase, validateAccess])

  const handleSignOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setUser(null)
    setDbUser(null)
    setAccessDenied(false)
    sessionStorage.removeItem('mymergent_token')
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading Auroraly...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage onAuthSuccess={handleAuthSuccess} />
  }

  if (accessDenied) {
    // Distinguish "real" access denial from transient infrastructure errors.
    const isTransient = /temporarily unreachable|timed out|please try again/i.test(accessMessage || '')
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md p-8 rounded-xl bg-card border border-border">
          <h1 className="text-2xl font-bold text-foreground mb-4" data-testid="access-gate-heading">
            {isTransient ? 'Hold tight…' : 'Access Denied'}
          </h1>
          <p className="text-muted-foreground mb-6" data-testid="access-gate-message">{accessMessage}</p>
          <p className="text-sm text-muted-foreground mb-6">
            Signed in as: <span className="text-foreground">{user.email}</span>
          </p>
          <div className="flex gap-2">
            {isTransient && (
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                data-testid="access-gate-retry"
              >
                Reload
              </button>
            )}
            <button
              onClick={handleSignOut}
              className={`${isTransient ? 'flex-1' : 'w-full'} py-2 px-4 ${isTransient ? 'bg-muted text-muted-foreground border border-border' : 'bg-primary text-primary-foreground'} rounded-lg hover:opacity-90 transition-colors`}
              data-testid="sign-out-btn"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <Dashboard user={user} dbUser={dbUser} onSignOut={handleSignOut} />
}
