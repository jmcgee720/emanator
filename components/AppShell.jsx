'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
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

/**
 * Auth gate + Dashboard renderer. Used by both `/` and `/project/[projectId]`
 * pages so URL-driven project selection can deep-link without duplicating
 * the entire auth-check flow.
 *
 * @param {{ initialProjectId?: string }} props
 */
export default function AppShell({ initialProjectId = null }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [dbUser, setDbUser] = useState(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessMessage, setAccessMessage] = useState('')
  const pathname = usePathname()
  const router = useRouter()

  // Pretty-URL redirect: authenticated users on `/` get bounced to
  // `/project-bin` so the address bar reads meaningfully ("here's your
  // project list") instead of the bare domain. Login lives at `/`, so
  // unauthenticated users stay there. Skipped on any non-root path
  // (e.g. /project/[id], /pricing, /gallery) so we don't yank users
  // out of deep links.
  useEffect(() => {
    if (!user) return
    if (pathname === '/') {
      try { router.replace('/project-bin') } catch {}
    }
  }, [user, pathname, router])

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
      const provider = authUser.app_metadata?.provider || authUser.app_metadata?.providers?.[0] || 'email'
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

      console.log('[AppShell] validateAccess received data:', data)

      if (!data) {
        console.log('[AppShell] No data - setting access denied')
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
        console.log('[AppShell] data.allowed is true, setting dbUser:', data.user)
        setUser(authUser)
        setDbUser(data.user)
        console.log('[AppShell] After setDbUser call')
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

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
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

  const handleAuthSuccess = useCallback(async (session) => {
    setLoading(true)
    if (session?.user) {
      await validateAccess(session.user, session.access_token)
    } else {
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

  return <Dashboard user={user} dbUser={dbUser} onSignOut={handleSignOut} initialProjectId={initialProjectId} />
}
