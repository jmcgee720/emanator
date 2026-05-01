'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Check, Sparkles, Zap, Crown, Gift } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import AuroraBackground from '@/components/AuroraBackground'

const TIER_ICONS = {
  starter: Zap,
  pro: Sparkles,
  ultra: Crown,
}

export default function PricingPage() {
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(null)
  const [data, setData] = useState(null)
  const [user, setUser] = useState(null)
  const { toast } = useToast()

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setLoading(false)
        return
      }
      setUser(session.user)

      // Auto-apply referral code if ?ref=<user_id> in the URL.
      try {
        const params = new URLSearchParams(window.location.search)
        const ref = params.get('ref')
        if (ref) {
          // Fire-and-forget — response handled by toast below.
          const res = await fetch('/api/credits/apply-referral', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ referral_code: ref }),
          })
          if (res.ok) {
            const json = await res.json().catch(() => ({}))
            if (json.recorded) {
              toast({
                title: 'Referral applied',
                description: "You and your friend will both get 25 credits on your first purchase.",
              })
            }
          }
          // Clean up the URL so a refresh doesn't re-apply.
          params.delete('ref')
          const qs = params.toString()
          const newUrl = window.location.pathname + (qs ? `?${qs}` : '')
          window.history.replaceState({}, '', newUrl)
        }
      } catch { /* non-fatal */ }

      try {
        const res = await fetch('/api/credits', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [toast])

  const handleCheckout = async (pkg) => {
    if (!user) {
      toast({ title: 'Please sign in first', description: 'Create an account to purchase credits.', variant: 'default' })
      window.location.href = '/'
      return
    }

    setCheckoutLoading(pkg.id)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          package_id: pkg.id,
          origin_url: `${window.location.origin}/`,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Checkout failed')
      }
      if (json.url) {
        window.location.href = json.url
      }
    } catch (err) {
      toast({ title: 'Checkout Failed', description: err.message, variant: 'destructive' })
      setCheckoutLoading(null)
    }
  }

  const packages = data?.packages || [
    { id: 'starter', amount: 100, price: 10, label: '$10', totalCredits: 100, bonusCredits: 0 },
    { id: 'pro', amount: 500, price: 45, label: '$45', totalCredits: 500, bonusCredits: 0 },
    { id: 'ultra', amount: 1000, price: 80, label: '$80', totalCredits: 1000, bonusCredits: 0 },
  ]

  const currentTier = data?.loyalty_tier?.label || 'Starter'
  const lifetime = data?.lifetime_purchased_usd || 0
  const isFirstPurchase = data && !data.first_purchase_completed

  return (
    <div className="min-h-screen relative overflow-hidden" data-testid="pricing-page">
      <AuroraBackground activityLevel={1} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-14 em-panel-enter">
          <a href="/" className="inline-block mb-8" data-testid="pricing-back-home">
            <img src="/auroraly-logo.png" alt="Auroraly" style={{ width: '180px', height: 'auto' }} draggable={false} />
          </a>
          <h1 className="text-5xl sm:text-6xl font-semibold mb-4" style={{ color: '#FFFFFF' }}>
            Pay for what you build
          </h1>
          <p className="text-base max-w-2xl mx-auto" style={{ color: '#B0B4CC' }}>
            One-time credit packs. No subscription. Credits never expire. The more you buy, the bigger the bonus.
          </p>

          {/* First-purchase banner */}
          {isFirstPurchase && (
            <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full"
              style={{
                background: 'linear-gradient(90deg, rgba(0,229,255,0.15) 0%, rgba(124,58,237,0.15) 100%)',
                border: '1px solid rgba(0,229,255,0.3)',
              }}
              data-testid="pricing-first-purchase-banner"
            >
              <Gift className="w-4 h-4" style={{ color: '#00E5FF' }} />
              <span className="text-sm font-medium" style={{ color: '#FFFFFF' }}>
                First purchase bonus: +50% credits on any pack
              </span>
            </div>
          )}

          {/* Current tier badge */}
          {user && !isFirstPurchase && (
            <div className="mt-8 inline-flex items-center gap-2 text-xs" style={{ color: '#8A8EA6' }}>
              <span>Your tier:</span>
              <span
                className="px-2.5 py-1 rounded-full font-semibold"
                style={{ background: 'rgba(124,58,237,0.15)', color: '#E040FB' }}
                data-testid="pricing-current-tier"
              >
                {currentTier}
              </span>
              <span>· Lifetime: ${lifetime.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Packages */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {loading ? (
            <div className="col-span-3 flex justify-center py-16" data-testid="pricing-loading">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#00E5FF' }} />
            </div>
          ) : (
            packages.map((pkg, idx) => {
              const Icon = TIER_ICONS[pkg.id] || Sparkles
              const isPro = pkg.id === 'pro'
              const total = pkg.totalCredits || pkg.amount
              const bonus = pkg.bonusCredits || 0
              return (
                <div
                  key={pkg.id}
                  data-testid={`pricing-card-${pkg.id}`}
                  className="relative rounded-2xl overflow-hidden em-panel-enter"
                  style={{
                    animationDelay: `${idx * 100}ms`,
                    background: isPro
                      ? 'linear-gradient(170deg, rgba(0,229,255,0.08) 0%, rgba(124,58,237,0.06) 100%)'
                      : 'linear-gradient(170deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%)',
                    backdropFilter: 'blur(24px) saturate(1.3)',
                    border: isPro ? '1px solid rgba(0,229,255,0.3)' : '1px solid rgba(255,255,255,0.12)',
                    boxShadow: isPro
                      ? '0 0 40px rgba(0,229,255,0.1), 0 20px 60px rgba(0,0,0,0.3)'
                      : '0 20px 60px rgba(0,0,0,0.2)',
                  }}
                >
                  {isPro && (
                    <div
                      className="absolute top-4 right-4 px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase"
                      style={{ background: 'rgba(0,229,255,0.2)', color: '#00E5FF' }}
                    >
                      Most Popular
                    </div>
                  )}

                  <div className="p-8">
                    <div
                      className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-5"
                      style={{ background: isPro ? 'rgba(0,229,255,0.15)' : 'rgba(124,58,237,0.15)' }}
                    >
                      <Icon className="w-6 h-6" style={{ color: isPro ? '#00E5FF' : '#E040FB' }} />
                    </div>

                    <h3 className="text-xl font-semibold mb-2 capitalize" style={{ color: '#FFFFFF' }}>
                      {pkg.id}
                    </h3>
                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-5xl font-bold" style={{ color: '#FFFFFF' }}>${pkg.price}</span>
                      <span className="text-sm" style={{ color: '#8A8EA6' }}>one-time</span>
                    </div>

                    <div className="mb-6">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span
                          className="text-2xl font-semibold"
                          style={{ color: isPro ? '#00E5FF' : '#E040FB' }}
                          data-testid={`pricing-credits-${pkg.id}`}
                        >
                          {total}
                        </span>
                        <span className="text-sm" style={{ color: '#B0B4CC' }}>credits</span>
                      </div>
                      {bonus > 0 && (
                        <div className="text-xs" style={{ color: '#00E5FF' }} data-testid={`pricing-bonus-${pkg.id}`}>
                          {pkg.amount} base + {bonus} bonus credits
                        </div>
                      )}
                    </div>

                    <ul className="space-y-3 mb-8 text-sm" style={{ color: '#B0B4CC' }}>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00E5FF' }} />
                        <span>{Math.floor(total / 0.5)} standard chat messages</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00E5FF' }} />
                        <span>{Math.floor(total / 3)} full project builds</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00E5FF' }} />
                        <span>{Math.floor(total / 5)} AI-generated images</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00E5FF' }} />
                        <span>All premium models (GPT-5.2, Claude, Gemini)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00E5FF' }} />
                        <span>Credits never expire</span>
                      </li>
                    </ul>

                    <button
                      onClick={() => handleCheckout(pkg)}
                      disabled={checkoutLoading !== null}
                      data-testid={`pricing-checkout-${pkg.id}`}
                      className="w-full h-12 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.015] active:scale-[0.985] disabled:opacity-60"
                      style={{
                        background: isPro
                          ? 'linear-gradient(135deg, #00E5FF 0%, #6D28D9 60%, #C026D3 100%)'
                          : 'linear-gradient(135deg, #6D28D9 0%, #C026D3 60%, #E040FB 100%)',
                        boxShadow: isPro
                          ? '0 0 30px rgba(0,229,255,0.3), 0 4px 12px rgba(0,0,0,0.3)'
                          : '0 0 20px rgba(124,58,237,0.2), 0 4px 12px rgba(0,0,0,0.3)',
                      }}
                    >
                      {checkoutLoading === pkg.id ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Redirecting...
                        </span>
                      ) : user ? (
                        `Buy ${pkg.label} pack`
                      ) : (
                        'Sign in to buy'
                      )}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Loyalty tiers ladder */}
        <div
          className="rounded-2xl p-8 mb-16 em-panel-enter"
          style={{
            background: 'linear-gradient(170deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            animationDelay: '400ms',
          }}
          data-testid="pricing-loyalty-ladder"
        >
          <h2 className="text-2xl font-semibold mb-2" style={{ color: '#FFFFFF' }}>
            Loyalty bonuses stack
          </h2>
          <p className="text-sm mb-6" style={{ color: '#8A8EA6' }}>
            As your lifetime spend grows, your bonus on every future purchase grows too.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(data?.loyaltyTiers || [
              { minLifetimeUsd: 0, bonusPercent: 0, label: 'Starter' },
              { minLifetimeUsd: 25, bonusPercent: 5, label: 'Regular' },
              { minLifetimeUsd: 100, bonusPercent: 15, label: 'Loyal' },
              { minLifetimeUsd: 500, bonusPercent: 25, label: 'VIP' },
            ]).map((t) => {
              const active = t.label === currentTier
              return (
                <div
                  key={t.label}
                  data-testid={`pricing-tier-${t.label.toLowerCase()}`}
                  className="rounded-xl p-4"
                  style={{
                    background: active ? 'rgba(0,229,255,0.08)' : 'rgba(255,255,255,0.03)',
                    border: active ? '1px solid rgba(0,229,255,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold" style={{ color: active ? '#00E5FF' : '#FFFFFF' }}>
                      {t.label}
                    </span>
                    {active && (
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: '#00E5FF' }}>
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold mb-1" style={{ color: '#FFFFFF' }}>
                    +{t.bonusPercent}%
                  </div>
                  <div className="text-xs" style={{ color: '#8A8EA6' }}>
                    {t.minLifetimeUsd === 0 ? 'From day one' : `At $${t.minLifetimeUsd}+ lifetime`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* FAQ */}
        <div className="em-panel-enter" style={{ animationDelay: '500ms' }}>
          <h2 className="text-2xl font-semibold mb-6 text-center" style={{ color: '#FFFFFF' }}>
            Frequently asked
          </h2>
          <div className="max-w-2xl mx-auto space-y-5">
            {[
              {
                q: 'How do credits get used?',
                a: 'Every AI action costs credits — a chat message on a standard model is 0.5 credits, a premium model (GPT-5.2 / Claude Opus) is 1.5–2.5 credits, a full AI image generation is 5 credits. You see the exact cost update in real time.',
              },
              {
                q: 'Do credits expire?',
                a: 'Never. Buy once, use whenever.',
              },
              {
                q: 'Can I get a refund?',
                a: 'Unused credits within 14 days of purchase can be refunded — just email us.',
              },
              {
                q: 'What about subscriptions?',
                a: 'Coming soon. For now, one-time credit packs let you pay for what you actually build without a recurring charge.',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl p-5"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
                data-testid={`pricing-faq-${i}`}
              >
                <div className="font-semibold mb-2" style={{ color: '#FFFFFF' }}>
                  {item.q}
                </div>
                <div className="text-sm" style={{ color: '#B0B4CC' }}>
                  {item.a}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-[11px] mt-16" style={{ color: '#6E7290' }}>
          Auroraly — AI Builder Platform · An Aetherly Studio product · Secure checkout by Stripe
        </p>
      </div>
    </div>
  )
}
