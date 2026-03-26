'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Lock, Zap } from 'lucide-react'
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
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden p-4" data-testid="login-page">
      {/* Subtle ambient glow */}
      <div className="absolute top-[-30%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[hsl(199_89%_48%/0.04)] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[hsl(267_60%_55%/0.03)] blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[400px] relative z-10">
        {/* Brand header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/8 border border-primary/10 mb-5">
            <Zap className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight em-gradient-text" data-testid="brand-title">Emanator</h1>
          <p className="text-muted-foreground text-sm mt-2">AI Builder Platform</p>
        </div>

        <Card className="border-border/60 bg-card/80 backdrop-blur-sm shadow-2xl shadow-black/20" data-testid="login-card">
          <CardHeader className="space-y-1.5 pb-5 px-6 pt-6">
            <div className="flex items-center gap-2 text-primary/70 text-xs font-medium tracking-wide uppercase">
              <Lock className="w-3.5 h-3.5" />
              <span>Private Access</span>
            </div>
            <CardTitle className="text-lg font-semibold">Welcome</CardTitle>
            <CardDescription className="text-sm">Sign in with your approved account</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <Tabs value={mode} onValueChange={setMode} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6 h-9 bg-muted/50">
                <TabsTrigger value="signin" data-testid="signin-tab" className="text-xs font-medium">Sign In</TabsTrigger>
                <TabsTrigger value="signup" data-testid="signup-tab" className="text-xs font-medium">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4" data-testid="signin-form">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email</Label>
                    <Input id="email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className="h-10 bg-input/50 border-border/60 placeholder:text-muted-foreground/40 focus:border-primary/40" data-testid="email-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required
                      className="h-10 bg-input/50 border-border/60 placeholder:text-muted-foreground/40 focus:border-primary/40" data-testid="password-input" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="stay-signed-in" checked={staySignedIn}
                      onCheckedChange={setStaySignedIn} />
                    <Label htmlFor="stay-signed-in" className="text-xs font-normal text-muted-foreground cursor-pointer">
                      Stay signed in
                    </Label>
                  </div>
                  <Button type="submit" className="w-full h-10 font-medium text-sm" disabled={loading} data-testid="signin-btn">
                    {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing In...</>) : 'Sign In'}
                  </Button>
                  <Button type="button" variant="link" className="w-full text-xs text-muted-foreground/70 hover:text-muted-foreground"
                    onClick={handlePasswordReset} disabled={loading}>
                    Forgot password?
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4" data-testid="signup-form">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-xs font-medium text-muted-foreground">Email</Label>
                    <Input id="signup-email" type="email" placeholder="you@company.com" value={email}
                      onChange={(e) => setEmail(e.target.value)} required
                      className="h-10 bg-input/50 border-border/60 placeholder:text-muted-foreground/40 focus:border-primary/40" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-xs font-medium text-muted-foreground">Password</Label>
                    <Input id="signup-password" type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} required minLength={6}
                      className="h-10 bg-input/50 border-border/60 placeholder:text-muted-foreground/40 focus:border-primary/40" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="stay-signed-in-signup" checked={staySignedIn}
                      onCheckedChange={setStaySignedIn} />
                    <Label htmlFor="stay-signed-in-signup" className="text-xs font-normal text-muted-foreground cursor-pointer">
                      Stay signed in
                    </Label>
                  </div>
                  <Button type="submit" className="w-full h-10 font-medium text-sm" disabled={loading} data-testid="signup-btn">
                    {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating Account...</>) : 'Create Account'}
                  </Button>
                  <p className="text-[11px] text-center text-muted-foreground/60">
                    You need to be on the allowlist to access the platform after signing up.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-6">
          Private internal tool — access by invitation only
        </p>
      </div>
    </div>
  )
}
