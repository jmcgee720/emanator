// ══════════════════════════════════════════════════════════════════════
// ── COMMERCE TEMPLATES ──
// Deterministic file generators for Stripe Checkout in Emanator-
// generated Next.js 14 projects. Emits:
//
//   app/api/checkout/route.js           — create Checkout session
//   app/api/payment-status/[sid]/route.js — poll session status
//   components/PricingButton.jsx        — UI trigger component
//   lib/pricing-packages.js             — server-side package registry
//
// Security (from the Stripe playbook):
//   - Prices defined SERVER-SIDE only (never trust frontend amount).
//   - Success/cancel URLs built from request origin dynamically.
//   - payment_transactions table row created BEFORE redirect.
//
// The generated project needs its own `STRIPE_API_KEY` env var set at
// deploy time — Emanator's test key is pipeline-only.
// ══════════════════════════════════════════════════════════════════════

export function buildPricingPackagesFile(brand) {
  const brandName = brand?.name || 'Your Product'
  return `// Server-side pricing — NEVER let the frontend specify amounts.
// Add new tiers here; the checkout endpoint will validate against this.
export const PRICING_PACKAGES = {
  starter: { id: 'starter', label: 'Starter', amount: 9.00,  currency: 'usd', features: ['Basic features', 'Email support'] },
  pro:     { id: 'pro',     label: 'Pro',     amount: 29.00, currency: 'usd', features: ['Everything in Starter', 'Priority support', 'Advanced features'] },
  business:{ id: 'business',label: 'Business',amount: 99.00, currency: 'usd', features: ['Everything in Pro', 'Dedicated support', 'SLA guarantees'] },
}

export const BRAND_NAME = ${JSON.stringify(brandName)}

export function getPackage(id) {
  if (!id || typeof id !== 'string') return null
  return PRICING_PACKAGES[id] || null
}
`
}

export function buildCheckoutRouteFile() {
  return `import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getPackage } from '@/lib/pricing-packages'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/checkout
 *
 * Body: { packageId: string, originUrl: string }
 * Returns: { url, sessionId }
 *
 * SECURITY:
 *   - Amount comes from PRICING_PACKAGES (server only).
 *   - success_url / cancel_url built from request origin.
 */
export async function POST(req) {
  if (!process.env.STRIPE_API_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured on this server.' }, { status: 500 })
  }
  let body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { packageId, originUrl } = body || {}
  const pkg = getPackage(packageId)
  if (!pkg) return NextResponse.json({ error: 'Unknown package' }, { status: 400 })
  if (!originUrl || typeof originUrl !== 'string') {
    return NextResponse.json({ error: 'Missing originUrl' }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_API_KEY, { apiVersion: '2024-06-20' })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: pkg.currency,
          product_data: { name: pkg.label },
          unit_amount: Math.round(pkg.amount * 100), // cents
        },
      }],
      success_url: \`\${originUrl}/?session_id={CHECKOUT_SESSION_ID}&status=success\`,
      cancel_url:  \`\${originUrl}/?status=cancelled\`,
      metadata: { packageId: pkg.id, source: 'emanator-commerce' },
    })
    // TODO: insert a row in your payment_transactions table here
    //       with { session_id: session.id, package_id: pkg.id, amount: pkg.amount, status: 'pending' }
    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('[api/checkout] stripe failed:', err.message)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
`
}

export function buildPaymentStatusRouteFile() {
  return `import { NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/payment-status/[sessionId]
 *
 * Frontend polls this after redirect from Stripe. Returns:
 *   { status, payment_status, amount_total, currency, metadata }
 */
export async function GET(_req, { params }) {
  if (!process.env.STRIPE_API_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured on this server.' }, { status: 500 })
  }
  const sessionId = params?.sessionId
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const stripe = new Stripe(process.env.STRIPE_API_KEY, { apiVersion: '2024-06-20' })
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    // TODO: update your payment_transactions row here, idempotently.
    return NextResponse.json({
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: session.metadata || {},
    })
  } catch (err) {
    console.error('[api/payment-status] stripe failed:', err.message)
    return NextResponse.json({ error: 'Failed to retrieve session' }, { status: 500 })
  }
}
`
}

export function buildPricingButtonComponentFile() {
  return `'use client'

import { useState, useEffect } from 'react'

/**
 * Drop-in pricing button. Reads \`packageId\` + \`label\` from props;
 * constructs success/cancel URLs from window.location.origin so it
 * works unchanged across dev / staging / production / preview domains.
 *
 * On return from Stripe, the URL will contain \`session_id\` — the
 * built-in useEffect below polls /api/payment-status/[id] and fires
 * the onSuccess callback once payment_status === 'paid'.
 */
export default function PricingButton({ packageId, label = 'Buy now', className = '', onSuccess, onError }) {
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const sid = params.get('session_id')
    if (!sid) return
    setPolling(true)
    let attempts = 0
    const tick = async () => {
      attempts++
      try {
        const r = await fetch(\`/api/payment-status/\${sid}\`)
        const j = await r.json()
        if (j.payment_status === 'paid') {
          setPolling(false)
          onSuccess?.(j)
          // Clean up the URL so a refresh doesn't re-poll.
          window.history.replaceState({}, '', window.location.pathname)
          return
        }
        if (j.status === 'expired' || attempts >= 5) {
          setPolling(false)
          onError?.('Payment session expired or timed out.')
          return
        }
        setTimeout(tick, 2000)
      } catch (err) {
        setPolling(false)
        onError?.(err.message || 'Failed to check payment.')
      }
    }
    tick()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleClick() {
    setLoading(true)
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, originUrl: window.location.origin }),
      })
      const j = await r.json()
      if (!r.ok || !j.url) throw new Error(j.error || 'Checkout failed.')
      window.location.href = j.url
    } catch (err) {
      onError?.(err.message)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading || polling}
      className={\`inline-flex items-center justify-center px-5 py-2.5 rounded-lg font-medium transition \${className}\`}
      data-testid={\`pricing-button-\${packageId}\`}
    >
      {loading ? 'Redirecting…' : polling ? 'Verifying…' : label}
    </button>
  )
}
`
}

/**
 * Generate the full set of Stripe Checkout scaffolding files for an
 * Emanator-generated project.
 *
 * @param {{brand?: {name: string}}} plan
 * @returns {Array<{path: string, content: string}>}
 */
export function buildStripeFiles(plan = {}) {
  return [
    { path: 'lib/pricing-packages.js', content: buildPricingPackagesFile(plan.brand) },
    { path: 'app/api/checkout/route.js', content: buildCheckoutRouteFile() },
    { path: 'app/api/payment-status/[sessionId]/route.js', content: buildPaymentStatusRouteFile() },
    { path: 'components/PricingButton.jsx', content: buildPricingButtonComponentFile() },
  ]
}

/**
 * Feature-flag / archetype gate. Returns true when this project looks
 * like it wants commerce — rough heuristic on the brief + archetype
 * until we have a richer signal.
 */
export function needsCommerceTemplates({ archetype, brief } = {}) {
  if (!archetype && !brief) return false
  const id = archetype?.id || ''
  if (/ecommerce|shop|store|commerce|checkout|paywall|subscription|saas/i.test(id)) return true
  const text = `${brief?.summary || ''} ${brief?.rawBrief || ''}`
  return /\b(stripe|checkout|buy\s+now|pricing|subscribe|paywall|payment)\b/i.test(text)
}
