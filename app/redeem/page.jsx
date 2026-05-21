'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authFetch } from '@/lib/auth-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Gift, CheckCircle, Loader2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

function RedeemContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const codeFromUrl = searchParams.get('code') || ''
  
  const [code, setCode] = useState(codeFromUrl)
  const [redeeming, setRedeeming] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)
  const [user, setUser] = useState(null)

  useEffect(() => {
    // Check if user is signed in
    authFetch('/api/auth/session')
      .then(r => r.json())
      .then(data => {
        if (data.user) {
          setUser(data.user)
        }
      })
      .catch(() => {})
  }, [])

  const handleRedeem = async () => {
    if (!code.trim()) return
    setError(null)
    setRedeeming(true)

    try {
      const r = await authFetch('/api/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      })

      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || 'Failed to redeem code')
      }

      const result = await r.json()
      setSuccess(true)
      
      // Redirect to dashboard after 3 seconds
      setTimeout(() => {
        router.push('/project-bin')
      }, 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 50%, #16213e 100%)'
    }}>
      <div className="w-full max-w-md">
        <div className="bg-[#0D0D2B] rounded-2xl border border-[rgba(255,255,255,0.15)] shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* Header */}
          <div className="p-8 text-center border-b border-[rgba(255,255,255,0.1)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[rgba(0,229,255,0.1)] border-2 border-[#00e5ff] flex items-center justify-center">
              <Gift className="w-8 h-8 text-[#00e5ff]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Redeem Your Promo Code</h1>
            <p className="text-sm text-gray-400">Unlock unlimited credits on Auroraly</p>
          </div>

          {/* Body */}
          <div className="p-8">
            {!user ? (
              <div className="text-center">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-amber-400" />
                <p className="text-sm text-gray-300 mb-6">
                  You need to sign in before redeeming a promo code.
                </p>
                <Link href="/auth/signin">
                  <Button className="w-full bg-[#00e5ff] text-[#0a0a1a] hover:brightness-110">
                    Sign In
                  </Button>
                </Link>
              </div>
            ) : success ? (
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold text-emerald-400 mb-2">Success!</h2>
                <p className="text-sm text-gray-300 mb-4">
                  You now have <strong className="text-[#00e5ff]">unlimited credits</strong>!
                </p>
                <p className="text-xs text-gray-500">Redirecting to your dashboard...</p>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <Input
                    type="text"
                    placeholder="Enter your promo code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="text-center font-mono text-lg tracking-wider bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.2)] text-white"
                    maxLength={20}
                    autoFocus
                    disabled={redeeming}
                  />
                </div>

                {error && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleRedeem}
                  disabled={redeeming || !code.trim()}
                  className="w-full bg-[#00e5ff] text-[#0a0a1a] hover:brightness-110 font-semibold"
                >
                  {redeeming ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Redeeming...
                    </>
                  ) : (
                    'Redeem Code'
                  )}
                </Button>

                <p className="text-xs text-center text-gray-500 mt-4">
                  Already have an account? <Link href="/project-bin" className="text-[#00e5ff] hover:underline">Go to dashboard</Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RedeemPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{
        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 50%, #16213e 100%)'
      }}>
        <Loader2 className="w-8 h-8 animate-spin text-[#00e5ff]" />
      </div>
    }>
      <RedeemContent />
    </Suspense>
  )
}
