'use client'

import { useState } from 'react'
import { CreditCard, X, Sparkles } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

export default function CreditsModal({
  onClose,
  creditsBalance,
  creditsLoading,
  creditsCosts,
  onBuyCredits,
  toast,
  onCreditsUpdate,
}) {
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoError, setPromoError] = useState(null)
  const [promoSuccess, setPromoSuccess] = useState(null)

  const handleRedeemPromo = async () => {
    const code = promoCode.trim()
    if (!code) {
      setPromoError('Please enter a promo code')
      return
    }

    setPromoLoading(true)
    setPromoError(null)
    setPromoSuccess(null)

    try {
      const res = await authFetch('/api/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })

      const data = await res.json()

      if (!res.ok) {
        setPromoError(data.error || 'Failed to redeem code')
        return
      }

      setPromoSuccess(data.message || 'Promo code redeemed successfully!')
      setPromoCode('')
      
      // Notify parent to refresh credits
      if (onCreditsUpdate) onCreditsUpdate()
      
      toast?.({
        title: 'Success!',
        description: data.message || 'Promo code redeemed successfully!',
      })

      // Close modal after 2 seconds
      setTimeout(() => onClose(), 2000)
    } catch (err) {
      setPromoError(err.message || 'Failed to redeem code')
    } finally {
      setPromoLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="em-glass rounded-2xl p-6 w-[420px] border border-[rgba(255,255,255,0.15)]" data-testid="credits-modal">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-semibold em-text-primary flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[var(--em-cyan)]" />
            Credits
          </h2>
          <button
            onClick={onClose}
            className="em-text-muted hover:text-[var(--em-text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance */}
        <div className="em-glass rounded-xl p-4 mb-5" data-testid="credits-balance">
          <div className="text-2xl font-bold em-gradient-text mb-1">
            {creditsBalance === 'unlimited' ? 'UNLIMITED' : creditsBalance !== null ? Number(creditsBalance).toFixed(2) : '—'}
          </div>
          <div className="text-xs em-text-secondary">Available credits</div>
        </div>

        {/* Promo Code Section */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-[var(--em-cyan)]" />
            <p className="text-[10px] em-text-muted font-medium uppercase tracking-wider">
              Have a promo code?
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => {
                setPromoCode(e.target.value)
                setPromoError(null)
                setPromoSuccess(null)
              }}
              placeholder="Enter code"
              className="flex-1 px-3 py-2 rounded-lg text-xs em-text-primary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] focus:border-[var(--em-cyan)] focus:outline-none transition-colors placeholder:text-[var(--em-text-muted)]"
              data-testid="promo-code-input"
              disabled={promoLoading}
            />
            <button
              onClick={handleRedeemPromo}
              disabled={promoLoading || !promoCode.trim()}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--em-cyan)] text-[#0C1018] hover:brightness-110 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="redeem-promo-btn"
            >
              {promoLoading ? 'Redeeming...' : 'Redeem'}
            </button>
          </div>
          {promoError && (
            <div className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" data-testid="promo-error">
              {promoError}
            </div>
          )}
          {promoSuccess && (
            <div className="mt-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2" data-testid="promo-success">
              {promoSuccess}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="relative mb-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[rgba(255,255,255,0.08)]" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
            <span className="px-2 bg-[var(--em-bg-base)] em-text-muted">Or buy credits</span>
          </div>
        </div>

        {/* Cost per action */}
        <div className="space-y-2 mb-5">
          <p className="text-[10px] em-text-muted font-medium uppercase tracking-wider mb-2">Cost per action</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(creditsCosts).map(([action, cost]) => (
              <div key={action} className="flex items-center justify-between text-[11px] px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.03)]">
                <span className="em-text-secondary capitalize">{action.replace(/_/g, ' ')}</span>
                <span className="em-text-primary font-medium">{cost}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Purchase options */}
        <div className="grid grid-cols-3 gap-2" data-testid="credits-purchase-options">
          {[
            { packageId: 'starter', amount: 100, price: '$10' },
            { packageId: 'pro', amount: 500, price: '$45' },
            { packageId: 'ultra', amount: 1000, price: '$80' }
          ].map(({ packageId, amount, price }) => (
            <button
              key={packageId}
              onClick={() => onBuyCredits(packageId)}
              disabled={creditsLoading}
              className="py-3 rounded-xl border border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.06)] transition-all duration-200 text-center disabled:opacity-50"
              data-testid={`buy-credits-${packageId}`}
            >
              <div className="text-sm font-semibold em-text-primary">{amount}</div>
              <div className="text-[11px] em-text-secondary">{price}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
