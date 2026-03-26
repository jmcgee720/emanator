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
        <p className="text-muted-foreground">Loading Emanator...</p>
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

      const response = await fetch('/api/auth/check', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: authUser.email })
      })

      const data = await response.json()

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
      setAccessMessage('Unable to verify access. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial session check on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted) return
        if (session?.user) {
          await validateAccess(session.user, session.access_token)
        } else {
          setLoading(false)
        }
      } catch {
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
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading Emanator...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage onAuthSuccess={handleAuthSuccess} />
  }

  if (accessDenied) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="max-w-md p-8 rounded-xl bg-card border border-border">
          <h1 className="text-2xl font-bold text-foreground mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-6">{accessMessage}</p>
          <p className="text-sm text-muted-foreground mb-6">
            Signed in as: <span className="text-foreground">{user.email}</span>
          </p>
          <button
            onClick={handleSignOut}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            data-testid="sign-out-btn"
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  return <Dashboard user={user} dbUser={dbUser} onSignOut={handleSignOut} />
}
