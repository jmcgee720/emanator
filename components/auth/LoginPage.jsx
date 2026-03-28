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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4" style={{ background: 'var(--em-void)' }} data-testid="login-page">
      {/* Ambient glow orbs */}
      <div className="absolute top-[-30%] left-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(0, 229, 255, 0.04)' }} />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(124, 58, 237, 0.04)' }} />

      <div className="w-full max-w-[400px] relative z-10 em-panel-enter">
        {/* Brand header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5 border border-[rgba(0,229,255,0.15)]" style={{ background: 'linear-gradient(135deg, rgba(0,229,255,0.1), rgba(124,58,237,0.08))' }}>
            <img src="/emanator-logo.png" alt="Emanator" className="w-8 h-8 object-contain" draggable={false} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight em-gradient-text" data-testid="brand-title">Emanator</h1>
          <p className="em-text-muted text-sm mt-2">AI Builder Platform</p>
        </div>

        <div className="em-glass p-0 overflow-hidden" data-testid="login-card">
          <div className="space-y-1.5 pb-5 px-6 pt-6">
            <div className="flex items-center gap-2 text-[var(--em-cyan)] text-xs font-medium tracking-wide uppercase opacity-70">
              <Lock className="w-3.5 h-3.5" />
              <span>Private Access</span>
            </div>
            <h2 className="text-lg font-semibold em-text-primary">Welcome</h2>
            <p className="text-sm em-text-secondary">Sign in with your approved account</p>
          </div>
          <div className="px-6 pb-6">
            <Tabs value={mode} onValueChange={setMode} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6 h-9 bg-[rgba(20,20,56,0.6)] border border-[rgba(124,58,237,0.1)] rounded-lg">
                <TabsTrigger value="signin" data-testid="signin-tab" className="text-xs font-medium rounded-md data-[state=active]:bg-[rgba(0,229,255,0.08)] data-[state=active]:text-[var(--em-text-primary)] data-[state=active]:shadow-none em-text-muted transition-colors duration-150">Sign In</TabsTrigger>
                <TabsTrigger value="signup" data-testid="signup-tab" className="text-xs font-medium rounded-md data-[state=active]:bg-[rgba(0,229,255,0.08)] data-[state=active]:text-[var(--em-text-primary)] data-[state=active]:shadow-none em-text-muted transition-colors duration-150">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4" data-testid="signin-form">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium em-text-secondary">Email</Label>
                    <Input id="email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className="h-10 em-input placeholder:text-[var(--em-text-muted)]" data-testid="email-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs font-medium em-text-secondary">Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required
                      className="h-10 em-input placeholder:text-[var(--em-text-muted)]" data-testid="password-input" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="stay-signed-in" checked={staySignedIn}
                      onCheckedChange={setStaySignedIn} className="border-[rgba(124,58,237,0.25)] data-[state=checked]:bg-[var(--em-cyan)] data-[state=checked]:border-[var(--em-cyan)]" />
                    <Label htmlFor="stay-signed-in" className="text-xs font-normal em-text-muted cursor-pointer">
                      Stay signed in
                    </Label>
                  </div>
                  <Button type="submit" className="w-full h-10 font-medium text-sm em-btn-brand" disabled={loading} data-testid="signin-btn">
                    {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing In...</>) : 'Sign In'}
                  </Button>
                  <Button type="button" variant="link" className="w-full text-xs em-text-muted hover:text-[var(--em-text-secondary)] transition-colors duration-150"
                    onClick={handlePasswordReset} disabled={loading}>
                    Forgot password?
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4" data-testid="signup-form">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-xs font-medium em-text-secondary">Email</Label>
                    <Input id="signup-email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className="h-10 em-input placeholder:text-[var(--em-text-muted)]" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-xs font-medium em-text-secondary">Password</Label>
                    <Input id="signup-password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required minLength={6}
                      className="h-10 em-input placeholder:text-[var(--em-text-muted)]" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="stay-signed-in-signup" checked={staySignedIn}
                      onCheckedChange={setStaySignedIn} className="border-[rgba(124,58,237,0.25)] data-[state=checked]:bg-[var(--em-cyan)] data-[state=checked]:border-[var(--em-cyan)]" />
                    <Label htmlFor="stay-signed-in-signup" className="text-xs font-normal em-text-muted cursor-pointer">
                      Stay signed in
                    </Label>
                  </div>
                  <Button type="submit" className="w-full h-10 font-medium text-sm em-btn-brand" disabled={loading} data-testid="signup-btn">
                    {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating Account...</>) : 'Create Account'}
                  </Button>
                  <p className="text-[11px] text-center em-text-muted">
                    You need to be on the allowlist to access the platform after signing up.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <p className="text-center text-[11px] em-text-muted mt-6" style={{ opacity: 0.6 }}>
          Private internal tool — access by invitation only
        </p>
      </div>
    </div>
  )
}
