'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Lock } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getEmailRedirectUrl, getOAuthCallbackUrl } from '@/lib/auth-config'

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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        toast({ title: 'Sign In Failed', description: error.message, variant: 'destructive' })
        setLoading(false)
        return
      }

      toast({
        title: 'Welcome back!',
        description: staySignedIn ? 'You will stay signed in.' : 'Session will end when you close the browser.',
      })

      if (onAuthSuccess) {
        await onAuthSuccess(data.session)
      }
    } catch (error) {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const emailRedirectTo = getEmailRedirectUrl()
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo }
      })

      if (error) {
        toast({ title: 'Sign Up Failed', description: error.message, variant: 'destructive' })
        setLoading(false)
        return
      }

      if (data.session) {
        toast({ title: 'Account Created!', description: 'Signing you in...' })
        if (onAuthSuccess) {
          await onAuthSuccess(data.session)
        }
      } else {
        toast({
          title: 'Check Your Email',
          description: 'A confirmation link has been sent to your email address.',
        })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!email) {
      toast({ title: 'Email Required', description: 'Please enter your email address first.', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getEmailRedirectUrl()
      })

      if (error) {
        toast({ title: 'Reset Failed', description: error.message, variant: 'destructive' })
      } else {
        toast({ title: 'Check Your Email', description: 'A password reset link has been sent.' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4" data-testid="login-page"
      style={{
        background: `
          radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 229, 255, 0.08) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 20% 80%, rgba(124, 58, 237, 0.07) 0%, transparent 50%),
          radial-gradient(ellipse 50% 50% at 85% 70%, rgba(224, 64, 251, 0.05) 0%, transparent 50%),
          radial-gradient(ellipse 120% 80% at 50% 50%, rgba(7, 7, 40, 1) 0%, rgba(7, 7, 30, 1) 100%),
          #05051A
        `
      }}
    >
      {/* Soft energy bloom — top center */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0, 229, 255, 0.06) 0%, rgba(124, 58, 237, 0.03) 40%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Secondary bloom — bottom right */}
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(224, 64, 251, 0.05) 0%, rgba(124, 58, 237, 0.02) 50%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Subtle noise grain overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="w-full max-w-[420px] relative z-10">

        {/* ── Brand Lockup ── */}
        <div className="text-center mb-12 em-panel-enter">
          <div className="flex justify-center mb-6">
            <div className="relative">
              {/* Glow behind logo */}
              <div className="absolute inset-0 rounded-3xl blur-xl opacity-40"
                style={{ background: 'radial-gradient(circle, rgba(0, 229, 255, 0.3), rgba(124, 58, 237, 0.15), transparent)' }}
              />
              <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center border border-[rgba(0,229,255,0.12)]"
                style={{
                  background: 'linear-gradient(145deg, rgba(13, 13, 43, 0.9), rgba(20, 20, 56, 0.7))',
                  boxShadow: '0 0 40px rgba(0, 229, 255, 0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                <img
                  src="/emanator-logo.png"
                  alt="Emanator"
                  className="w-14 h-14 object-contain drop-shadow-[0_0_8px_rgba(0,229,255,0.2)]"
                  draggable={false}
                />
              </div>
            </div>
          </div>
          <h1
            className="text-4xl font-bold tracking-tight mb-2"
            style={{
              background: 'linear-gradient(135deg, #00E5FF 0%, #7C3AED 45%, #E040FB 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
            data-testid="brand-title"
          >
            Emanator
          </h1>
          <p className="text-sm tracking-wide" style={{ color: '#6668AA' }}>
            AI Builder Platform
          </p>
        </div>

        {/* ── Auth Card ── */}
        <div
          className="em-panel-enter relative rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(165deg, rgba(18, 18, 52, 0.92) 0%, rgba(10, 10, 35, 0.95) 100%)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(124, 58, 237, 0.15)',
            boxShadow: `
              0 0 0 1px rgba(0, 229, 255, 0.03),
              0 4px 40px rgba(0, 0, 0, 0.4),
              0 0 60px rgba(124, 58, 237, 0.04),
              inset 0 1px 0 rgba(255, 255, 255, 0.03)
            `,
          }}
          data-testid="login-card"
        >
          {/* Top edge glow line */}
          <div className="absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent 10%, rgba(0,229,255,0.25) 50%, transparent 90%)' }}
          />

          <div className="p-7">
            {/* Card header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-3.5 h-3.5" style={{ color: '#00E5FF', opacity: 0.6 }} />
                <span className="text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: '#00E5FF', opacity: 0.6 }}>
                  Private Access
                </span>
              </div>
              <h2 className="text-xl font-semibold" style={{ color: '#F0F0F8' }}>Welcome</h2>
              <p className="text-sm mt-1" style={{ color: '#8888AA' }}>Sign in with your approved account</p>
            </div>

            {/* Tabs */}
            <Tabs value={mode} onValueChange={setMode} className="w-full">
              <TabsList
                className="grid w-full grid-cols-2 mb-6 h-9 rounded-xl p-0.5"
                style={{
                  background: 'rgba(7, 7, 30, 0.6)',
                  border: '1px solid rgba(124, 58, 237, 0.1)',
                }}
              >
                <TabsTrigger
                  value="signin"
                  data-testid="signin-tab"
                  className="text-xs font-medium rounded-lg transition-all duration-150 data-[state=active]:shadow-none"
                  style={{
                    color: mode === 'signin' ? '#F0F0F8' : '#555577',
                    background: mode === 'signin' ? 'rgba(0, 229, 255, 0.08)' : 'transparent',
                  }}
                >
                  Sign In
                </TabsTrigger>
                <TabsTrigger
                  value="signup"
                  data-testid="signup-tab"
                  className="text-xs font-medium rounded-lg transition-all duration-150 data-[state=active]:shadow-none"
                  style={{
                    color: mode === 'signup' ? '#F0F0F8' : '#555577',
                    background: mode === 'signup' ? 'rgba(0, 229, 255, 0.08)' : 'transparent',
                  }}
                >
                  Sign Up
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-5" data-testid="signin-form">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium" style={{ color: '#8888AA' }}>Email</Label>
                    <Input id="email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      data-testid="email-input"
                      className="h-11 rounded-xl text-sm"
                      style={{
                        background: '#07071E',
                        border: '1px solid rgba(124, 58, 237, 0.15)',
                        color: '#F0F0F8',
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs font-medium" style={{ color: '#8888AA' }}>Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required
                      data-testid="password-input"
                      className="h-11 rounded-xl text-sm"
                      style={{
                        background: '#07071E',
                        border: '1px solid rgba(124, 58, 237, 0.15)',
                        color: '#F0F0F8',
                      }}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="stay-signed-in" checked={staySignedIn}
                      onCheckedChange={setStaySignedIn}
                      className="border-[rgba(124,58,237,0.3)] data-[state=checked]:bg-[#00E5FF] data-[state=checked]:border-[#00E5FF]"
                    />
                    <Label htmlFor="stay-signed-in" className="text-xs font-normal cursor-pointer" style={{ color: '#555577' }}>
                      Stay signed in
                    </Label>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    data-testid="signin-btn"
                    className="w-full h-11 rounded-2xl text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
                    style={{
                      background: 'linear-gradient(135deg, #7C3AED 0%, #E040FB 100%)',
                      boxShadow: '0 0 24px rgba(124, 58, 237, 0.25), 0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />Signing In...
                      </span>
                    ) : 'Sign In'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={loading}
                    className="w-full text-xs py-2 transition-colors duration-150 hover:opacity-80"
                    style={{ color: '#555577' }}
                  >
                    Forgot password?
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-5" data-testid="signup-form">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-xs font-medium" style={{ color: '#8888AA' }}>Email</Label>
                    <Input id="signup-email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className="h-11 rounded-xl text-sm"
                      style={{
                        background: '#07071E',
                        border: '1px solid rgba(124, 58, 237, 0.15)',
                        color: '#F0F0F8',
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-xs font-medium" style={{ color: '#8888AA' }}>Password</Label>
                    <Input id="signup-password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required minLength={6}
                      className="h-11 rounded-xl text-sm"
                      style={{
                        background: '#07071E',
                        border: '1px solid rgba(124, 58, 237, 0.15)',
                        color: '#F0F0F8',
                      }}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="stay-signed-in-signup" checked={staySignedIn}
                      onCheckedChange={setStaySignedIn}
                      className="border-[rgba(124,58,237,0.3)] data-[state=checked]:bg-[#00E5FF] data-[state=checked]:border-[#00E5FF]"
                    />
                    <Label htmlFor="stay-signed-in-signup" className="text-xs font-normal cursor-pointer" style={{ color: '#555577' }}>
                      Stay signed in
                    </Label>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    data-testid="signup-btn"
                    className="w-full h-11 rounded-2xl text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
                    style={{
                      background: 'linear-gradient(135deg, #7C3AED 0%, #E040FB 100%)',
                      boxShadow: '0 0 24px rgba(124, 58, 237, 0.25), 0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />Creating Account...
                      </span>
                    ) : 'Create Account'}
                  </button>
                  <p className="text-[11px] text-center" style={{ color: '#555577' }}>
                    You need to be on the allowlist to access the platform after signing up.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <p className="text-center text-[11px] mt-8" style={{ color: '#555577', opacity: 0.5 }}>
          Private internal tool — access by invitation only
        </p>
      </div>
    </div>
  )
}
