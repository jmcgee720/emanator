'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Lock } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getEmailRedirectUrl } from '@/lib/auth-config'

export default function LoginPage({ onAuthSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('signin')
  const [staySignedIn, setStaySignedIn] = useState(true)

  const [googleLoading, setGoogleLoading] = useState(false)

  const supabase = createClient()
  const { toast } = useToast()

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) {
        toast({ title: 'Google Sign In Failed', description: error.message, variant: 'destructive' })
        setGoogleLoading(false)
      }
      // On success, browser redirects to Google — no need to handle here
    } catch {
      toast({ title: 'Error', description: 'Failed to start Google sign in', variant: 'destructive' })
      setGoogleLoading(false)
    }
  }

  const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        toast({ title: 'Sign In Failed', description: error.message, variant: 'destructive' })
        setLoading(false)
        return
      }
      toast({ title: 'Welcome back!', description: staySignedIn ? 'You will stay signed in.' : 'Session will end when you close the browser.' })
      if (onAuthSuccess) await onAuthSuccess(data.session)
    } catch {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: getEmailRedirectUrl() } })
      if (error) {
        toast({ title: 'Sign Up Failed', description: error.message, variant: 'destructive' })
        setLoading(false)
        return
      }
      if (data.session) {
        toast({ title: 'Account Created!', description: 'Signing you in...' })
        if (onAuthSuccess) await onAuthSuccess(data.session)
      } else {
        toast({ title: 'Check Your Email', description: 'A confirmation link has been sent to your email address.' })
      }
    } catch {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  const handlePasswordReset = async () => {
    if (!email) { toast({ title: 'Email Required', description: 'Please enter your email address first.', variant: 'destructive' }); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: getEmailRedirectUrl() })
      if (error) toast({ title: 'Reset Failed', description: error.message, variant: 'destructive' })
      else toast({ title: 'Check Your Email', description: 'A password reset link has been sent.' })
    } catch {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally { setLoading(false) }
  }

  const inputStyle = {
    background: 'rgba(5, 5, 26, 0.8)',
    border: '1px solid rgba(124, 58, 237, 0.18)',
    color: '#FFFFFF',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
    colorScheme: 'dark',
  }

  const inputFocusClass = "h-11 rounded-xl text-sm transition-all duration-200 focus:border-[rgba(0,229,255,0.4)] focus:shadow-[0_0_16px_rgba(0,229,255,0.08)] focus:outline-none placeholder:text-[#7A7E98] autofill:shadow-[inset_0_0_0_1000px_rgba(5,5,26,0.9)] autofill:[-webkit-text-fill-color:#FFFFFF]"

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden em-aurora em-aurora--login" data-testid="login-page">

      {/* ── AURORA BOREALIS BACKGROUND (dramatic login variant) ── */}
      <div className="em-aurora-veil-1" />
      <div className="em-aurora-veil-2" />
      <div className="em-aurora-veil-3" />
      <div className="em-aurora-veil-4" />
      <div className="em-aurora-veil-5" />
      <div className="em-aurora-veil-6" />
      <div className="em-aurora-horizon" />
      <div className="em-aurora-noise" />


      {/* ── BRAND LOCKUP ── */}
      <div className="relative z-10 text-center mb-16 em-panel-enter" style={{ animationDelay: '0ms' }}>
        {/* Logo glow halo */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[120px] pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, rgba(0, 229, 255, 0.1) 0%, rgba(124, 58, 237, 0.05) 40%, transparent 70%)',
          filter: 'blur(30px)',
        }} />

        {/* Logo wordmark — clean, large, no container */}
        <img
          src="/emanator-logo.png"
          alt="Emanator"
          className="relative mx-auto mb-5 drop-shadow-[0_0_20px_rgba(0,229,255,0.15)]"
          style={{ width: '260px', height: 'auto' }}
          draggable={false}
        />

        <p className="text-sm font-medium tracking-[0.2em] uppercase" style={{ color: '#9498BE' }}>
          AI Builder Platform
        </p>
      </div>


      {/* ── AUTH CARD ── */}
      <div
        className="relative z-10 w-full max-w-[420px] mx-4 em-panel-enter"
        style={{ animationDelay: '60ms' }}
      >
        {/* Card outer glow — soft halo around glass */}
        <div className="absolute -inset-2 rounded-3xl pointer-events-none" style={{
          background: 'radial-gradient(ellipse at 30% 20%, rgba(255, 255, 255, 0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(0, 229, 255, 0.04) 0%, transparent 50%)',
          filter: 'blur(24px)',
        }} />

        <div
          className="relative rounded-2xl overflow-hidden"
          data-testid="login-card"
          style={{
            background: 'linear-gradient(170deg, rgba(255, 255, 255, 0.08) 0%, rgba(200, 220, 255, 0.04) 40%, rgba(255, 255, 255, 0.06) 100%)',
            backdropFilter: 'blur(32px) saturate(1.4) brightness(1.05)',
            WebkitBackdropFilter: 'blur(32px) saturate(1.4) brightness(1.05)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            boxShadow: `
              0 20px 80px rgba(0, 0, 0, 0.25),
              0 4px 30px rgba(0, 0, 0, 0.15),
              inset 0 1px 0 rgba(255, 255, 255, 0.30),
              inset 0 0 60px rgba(255, 255, 255, 0.03)
            `,
          }}
        >
          {/* Specular top edge — bright crisp shimmer */}
          <div className="absolute top-0 left-0 right-0 h-px" style={{
            background: 'linear-gradient(90deg, transparent 2%, rgba(255,255,255,0.15) 8%, rgba(255,255,255,0.45) 20%, rgba(255,255,255,0.6) 32%, rgba(255,255,255,0.5) 50%, rgba(0,229,255,0.3) 60%, rgba(255,255,255,0.35) 75%, rgba(255,255,255,0.12) 90%, transparent 98%)',
          }} />
          {/* Left edge highlight — bright catch */}
          <div className="absolute top-0 left-0 w-px h-full" style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0.15) 20%, rgba(255,255,255,0.06) 50%, transparent 80%)',
          }} />
          {/* Right edge highlight */}
          <div className="absolute top-0 right-0 w-px h-full" style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 30%, transparent 65%)',
          }} />
          {/* Bottom edge subtle shimmer */}
          <div className="absolute bottom-0 left-0 right-0 h-px" style={{
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 80%, transparent 95%)',
          }} />
          {/* Diagonal gradient shimmer — light refraction across the glass surface */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 30%, transparent 50%, rgba(255,255,255,0.04) 70%, rgba(0,229,255,0.03) 85%, transparent 100%)',
            borderRadius: 'inherit',
          }} />
          {/* Top-left corner light catch — like real glass */}
          <div className="absolute top-0 left-0 w-32 h-32 pointer-events-none" style={{
            background: 'radial-gradient(ellipse at 15% 15%, rgba(255,255,255,0.10) 0%, transparent 60%)',
            borderRadius: 'inherit',
          }} />

          <div className="relative p-8">
            {/* Card header */}
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-3.5 h-3.5" style={{ color: '#00E5FF', opacity: 0.5 }} />
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: '#00E5FF', opacity: 0.5 }}>
                  Secure Login
                </span>
              </div>
              <h2 className="text-xl font-semibold" style={{ color: '#FFFFFF' }}>Welcome</h2>
              <p className="text-sm mt-1.5" style={{ color: '#B0B4CC' }}>Sign in to your account</p>
            </div>

            {/* Google Sign In */}
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 h-11 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 mb-5"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
              }}
              data-testid="google-signin-btn"
            >
              {googleLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#8A8EA6' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* Tabs */}
            <Tabs value={mode} onValueChange={setMode} className="w-full">
              <TabsList
                className="grid w-full grid-cols-2 mb-7 h-10 rounded-xl p-1"
                style={{
                  background: 'rgba(5, 5, 26, 0.5)',
                  border: '1px solid rgba(124, 58, 237, 0.1)',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
                }}
              >
                <TabsTrigger value="signin" data-testid="signin-tab"
                  className="text-xs font-semibold rounded-lg transition-all duration-150 data-[state=active]:shadow-none"
                  style={{
                    color: mode === 'signin' ? '#FFFFFF' : '#8A8EA6',
                    background: mode === 'signin' ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
                    boxShadow: mode === 'signin' ? '0 0 12px rgba(0, 229, 255, 0.06)' : 'none',
                  }}
                >Sign In</TabsTrigger>
                <TabsTrigger value="signup" data-testid="signup-tab"
                  className="text-xs font-semibold rounded-lg transition-all duration-150 data-[state=active]:shadow-none"
                  style={{
                    color: mode === 'signup' ? '#FFFFFF' : '#8A8EA6',
                    background: mode === 'signup' ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
                    boxShadow: mode === 'signup' ? '0 0 12px rgba(0, 229, 255, 0.06)' : 'none',
                  }}
                >Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-5" data-testid="signin-form">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-medium" style={{ color: '#B0B4CC' }}>Email</Label>
                    <Input id="email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      data-testid="email-input" className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-xs font-medium" style={{ color: '#B0B4CC' }}>Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required
                      data-testid="password-input" className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <Checkbox id="stay-signed-in" checked={staySignedIn} onCheckedChange={setStaySignedIn}
                      className="border-[rgba(124,58,237,0.3)] data-[state=checked]:bg-[#00E5FF] data-[state=checked]:border-[#00E5FF]" />
                    <Label htmlFor="stay-signed-in" className="text-xs font-normal cursor-pointer" style={{ color: '#8A8EA6' }}>Stay signed in</Label>
                  </div>
                  <button type="submit" disabled={loading} data-testid="signin-btn"
                    className="w-full h-12 rounded-2xl text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.015] active:scale-[0.985] disabled:opacity-60 disabled:hover:scale-100 mt-2"
                    style={{
                      background: 'linear-gradient(135deg, #6D28D9 0%, #C026D3 60%, #E040FB 100%)',
                      boxShadow: '0 0 30px rgba(124, 58, 237, 0.3), 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                    }}>
                    {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Signing In...</span> : 'Sign In'}
                  </button>
                  <button type="button" onClick={handlePasswordReset} disabled={loading}
                    className="w-full text-xs py-2 transition-colors duration-150 hover:opacity-80" style={{ color: '#8A8EA6' }}>
                    Forgot password?
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-5" data-testid="signup-form">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-xs font-medium" style={{ color: '#B0B4CC' }}>Email</Label>
                    <Input id="signup-email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-xs font-medium" style={{ color: '#B0B4CC' }}>Password</Label>
                    <Input id="signup-password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required minLength={6}
                      className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <Checkbox id="stay-signed-in-signup" checked={staySignedIn} onCheckedChange={setStaySignedIn}
                      className="border-[rgba(124,58,237,0.3)] data-[state=checked]:bg-[#00E5FF] data-[state=checked]:border-[#00E5FF]" />
                    <Label htmlFor="stay-signed-in-signup" className="text-xs font-normal cursor-pointer" style={{ color: '#8A8EA6' }}>Stay signed in</Label>
                  </div>
                  <button type="submit" disabled={loading} data-testid="signup-btn"
                    className="w-full h-12 rounded-2xl text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.015] active:scale-[0.985] disabled:opacity-60 disabled:hover:scale-100 mt-2"
                    style={{
                      background: 'linear-gradient(135deg, #6D28D9 0%, #C026D3 60%, #E040FB 100%)',
                      boxShadow: '0 0 30px rgba(124, 58, 237, 0.3), 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                    }}>
                    {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Creating Account...</span> : 'Create Account'}
                  </button>
                  <p className="text-[11px] text-center pt-1" style={{ color: '#8A8EA6' }}>
                    By signing up you agree to our terms of service.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="relative z-10 text-center text-[11px] mt-10 em-panel-enter" style={{ color: '#6E7290', animationDelay: '120ms' }}>
        Emanator — AI Builder Platform
      </p>
    </div>
  )
}
