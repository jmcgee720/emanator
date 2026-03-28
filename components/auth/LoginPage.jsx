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

  const supabase = createClient()
  const { toast } = useToast()

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
    color: '#F0F0F8',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
  }

  const inputFocusClass = "h-11 rounded-xl text-sm transition-all duration-200 focus:border-[rgba(0,229,255,0.4)] focus:shadow-[0_0_16px_rgba(0,229,255,0.08)] focus:outline-none placeholder:text-[#444466]"

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden em-aurora em-aurora--login" data-testid="login-page">

      {/* ── AURORA BOREALIS BACKGROUND (dramatic login variant) ── */}
      <div className="em-aurora-veil-1" />
      <div className="em-aurora-veil-2" />
      <div className="em-aurora-veil-3" />
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

        <p className="text-sm font-medium tracking-[0.2em] uppercase" style={{ color: '#6668AA' }}>
          AI Builder Platform
        </p>
      </div>


      {/* ── AUTH CARD ── */}
      <div
        className="relative z-10 w-full max-w-[420px] mx-4 em-panel-enter"
        style={{ animationDelay: '60ms' }}
      >
        {/* Card outer glow */}
        <div className="absolute -inset-1 rounded-3xl pointer-events-none" style={{
          background: 'linear-gradient(165deg, rgba(0, 229, 255, 0.06) 0%, rgba(124, 58, 237, 0.04) 50%, rgba(224, 64, 251, 0.03) 100%)',
          filter: 'blur(20px)',
        }} />

        <div
          className="relative rounded-2xl overflow-hidden"
          data-testid="login-card"
          style={{
            background: 'linear-gradient(170deg, rgba(22, 22, 72, 0.92) 0%, rgba(16, 16, 54, 0.94) 40%, rgba(12, 12, 46, 0.96) 100%)',
            backdropFilter: 'blur(54px) saturate(1.7) brightness(1.06)',
            WebkitBackdropFilter: 'blur(54px) saturate(1.7) brightness(1.06)',
            border: '1px solid rgba(124, 58, 237, 0.24)',
            boxShadow: `
              0 20px 100px rgba(0, 0, 0, 0.6),
              0 4px 50px rgba(0, 0, 0, 0.35),
              0 0 120px rgba(124, 58, 237, 0.06),
              0 0 60px rgba(0, 229, 255, 0.035),
              inset 0 1px 0 rgba(255, 255, 255, 0.12),
              inset 0 0 80px rgba(0, 229, 255, 0.025),
              inset 0 0 40px rgba(124, 58, 237, 0.02)
            `,
          }}
        >
          {/* Specular top edge — 1px crisp, color refraction */}
          <div className="absolute top-0 left-0 right-0 h-px" style={{
            background: 'linear-gradient(90deg, transparent 3%, rgba(0,229,255,0.15) 10%, rgba(0,229,255,0.55) 22%, rgba(0,229,255,0.58) 30%, rgba(180,160,255,0.38) 44%, rgba(124,58,237,0.45) 56%, rgba(224,64,251,0.2) 74%, rgba(224,64,251,0.06) 90%, transparent 97%)',
          }} />
          {/* Left edge highlight */}
          <div className="absolute top-0 left-0 w-px h-full" style={{
            background: 'linear-gradient(180deg, rgba(0,229,255,0.25) 0%, rgba(180,160,255,0.1) 30%, rgba(124,58,237,0.08) 60%, transparent 85%)',
          }} />
          {/* Right edge highlight */}
          <div className="absolute top-0 right-0 w-px h-full" style={{
            background: 'linear-gradient(180deg, rgba(124,58,237,0.18) 0%, rgba(224,64,251,0.08) 40%, transparent 75%)',
          }} />
          {/* Inner reflection — bright, cyan→violet refraction shift */}
          <div className="absolute top-0 left-0 right-0 h-32 pointer-events-none" style={{
            background: 'linear-gradient(180deg, rgba(0, 229, 255, 0.05) 0%, rgba(140, 120, 255, 0.025) 35%, rgba(124, 58, 237, 0.01) 65%, transparent 100%)',
          }} />

          <div className="relative p-8">
            {/* Card header */}
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-3.5 h-3.5" style={{ color: '#00E5FF', opacity: 0.5 }} />
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: '#00E5FF', opacity: 0.5 }}>
                  Private Access
                </span>
              </div>
              <h2 className="text-xl font-semibold" style={{ color: '#F0F0F8' }}>Welcome</h2>
              <p className="text-sm mt-1.5" style={{ color: '#7778AA' }}>Sign in with your approved account</p>
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
                    color: mode === 'signin' ? '#F0F0F8' : '#555577',
                    background: mode === 'signin' ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
                    boxShadow: mode === 'signin' ? '0 0 12px rgba(0, 229, 255, 0.06)' : 'none',
                  }}
                >Sign In</TabsTrigger>
                <TabsTrigger value="signup" data-testid="signup-tab"
                  className="text-xs font-semibold rounded-lg transition-all duration-150 data-[state=active]:shadow-none"
                  style={{
                    color: mode === 'signup' ? '#F0F0F8' : '#555577',
                    background: mode === 'signup' ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
                    boxShadow: mode === 'signup' ? '0 0 12px rgba(0, 229, 255, 0.06)' : 'none',
                  }}
                >Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-5" data-testid="signin-form">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-medium" style={{ color: '#7778AA' }}>Email</Label>
                    <Input id="email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      data-testid="email-input" className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-xs font-medium" style={{ color: '#7778AA' }}>Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required
                      data-testid="password-input" className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <Checkbox id="stay-signed-in" checked={staySignedIn} onCheckedChange={setStaySignedIn}
                      className="border-[rgba(124,58,237,0.3)] data-[state=checked]:bg-[#00E5FF] data-[state=checked]:border-[#00E5FF]" />
                    <Label htmlFor="stay-signed-in" className="text-xs font-normal cursor-pointer" style={{ color: '#555577' }}>Stay signed in</Label>
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
                    className="w-full text-xs py-2 transition-colors duration-150 hover:opacity-80" style={{ color: '#555577' }}>
                    Forgot password?
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-5" data-testid="signup-form">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-xs font-medium" style={{ color: '#7778AA' }}>Email</Label>
                    <Input id="signup-email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-xs font-medium" style={{ color: '#7778AA' }}>Password</Label>
                    <Input id="signup-password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required minLength={6}
                      className={inputFocusClass} style={inputStyle} />
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <Checkbox id="stay-signed-in-signup" checked={staySignedIn} onCheckedChange={setStaySignedIn}
                      className="border-[rgba(124,58,237,0.3)] data-[state=checked]:bg-[#00E5FF] data-[state=checked]:border-[#00E5FF]" />
                    <Label htmlFor="stay-signed-in-signup" className="text-xs font-normal cursor-pointer" style={{ color: '#555577' }}>Stay signed in</Label>
                  </div>
                  <button type="submit" disabled={loading} data-testid="signup-btn"
                    className="w-full h-12 rounded-2xl text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.015] active:scale-[0.985] disabled:opacity-60 disabled:hover:scale-100 mt-2"
                    style={{
                      background: 'linear-gradient(135deg, #6D28D9 0%, #C026D3 60%, #E040FB 100%)',
                      boxShadow: '0 0 30px rgba(124, 58, 237, 0.3), 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                    }}>
                    {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Creating Account...</span> : 'Create Account'}
                  </button>
                  <p className="text-[11px] text-center pt-1" style={{ color: '#555577' }}>
                    You need to be on the allowlist to access the platform after signing up.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="relative z-10 text-center text-[11px] mt-10 em-panel-enter" style={{ color: '#444466', animationDelay: '120ms' }}>
        Private internal tool — access by invitation only
      </p>
    </div>
  )
}
