/**
 * Stripe API routes — ported from /app/backend/server.py (Stripe block).
 *
 * Endpoints handled here (all go through the catch-all):
 *   POST /api/stripe/checkout          — create Checkout session
 *   GET  /api/stripe/status/:sessionId — poll session status + idempotent mark-paid
 *   POST /api/stripe/confirm-credits/:sessionId — frontend idempotency flag
 *
 * The webhook lives at /app/app/api/webhook/stripe/route.js because it requires
 * the raw body for signature verification, which the catch-all would consume.
 */

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { getDb } from '@/lib/mongodb'

// Server-authoritative package catalogue. The frontend MUST send a `package_id`
// that exists here — it cannot specify the price itself.
export const STRIPE_PACKAGES = {
  starter: { amount: 10.0, credits: 100, label: '$10 → 100 credits' },
  pro: { amount: 45.0, credits: 500, label: '$45 → 500 credits' },
  ultra: { amount: 80.0, credits: 1000, label: '$80 → 1,000 credits' },
}

function getStripe() {
  const apiKey = process.env.STRIPE_API_KEY
  if (!apiKey) return null
  // Pin API version for stable behaviour across Stripe releases.
  return new Stripe(apiKey, { apiVersion: '2024-11-20.acacia' })
}

export async function handle(route, method, path, request) {
  // ── POST /api/stripe/checkout ───────────────────────────────────────
  if (route === '/stripe/checkout' && method === 'POST') {
    const user = await getAuthUser(request)
    if (!user) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    let body
    try {
      body = await request.json()
    } catch {
      return handleCORS(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }))
    }

    const { package_id, origin_url } = body
    if (!package_id || !STRIPE_PACKAGES[package_id]) {
      return handleCORS(
        NextResponse.json(
          { error: `Invalid package. Valid: ${Object.keys(STRIPE_PACKAGES).join(', ')}` },
          { status: 400 },
        ),
      )
    }
    if (!origin_url) {
      return handleCORS(NextResponse.json({ error: 'origin_url required' }, { status: 400 }))
    }

    const stripe = getStripe()
    if (!stripe) {
      return handleCORS(NextResponse.json({ error: 'Stripe not configured' }, { status: 500 }))
    }

    const pkg = STRIPE_PACKAGES[package_id]

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Auroraly — ${pkg.credits} credits`,
                description: pkg.label,
              },
              unit_amount: Math.round(pkg.amount * 100), // cents
            },
            quantity: 1,
          },
        ],
        success_url: `${origin_url}?stripe_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin_url}?stripe_status=cancelled`,
        metadata: {
          user_id: user.id,
          user_email: user.email || '',
          package_id,
          credits: String(pkg.credits),
        },
      })

      // Save pending transaction (session_id is the idempotency key)
      const db = await getDb()
      await db.collection('payment_transactions').insertOne({
        session_id: session.id,
        user_id: user.id,
        user_email: user.email,
        package_id,
        amount: pkg.amount,
        credits: pkg.credits,
        currency: 'usd',
        payment_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      console.log(`[Stripe] Checkout session created: ${session.id} for user ${user.id} (${package_id})`)

      return handleCORS(
        NextResponse.json({
          url: session.url,
          session_id: session.id,
        }),
      )
    } catch (err) {
      console.error('[Stripe] Checkout error:', err.message)
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // ── GET /api/stripe/status/:sessionId ───────────────────────────────
  const statusMatch = route.match(/^\/stripe\/status\/(.+)$/)
  if (statusMatch && method === 'GET') {
    const user = await getAuthUser(request)
    if (!user) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const sessionId = statusMatch[1]
    const stripe = getStripe()
    if (!stripe) {
      return handleCORS(NextResponse.json({ error: 'Stripe not configured' }, { status: 500 }))
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const db = await getDb()
      const txn = await db
        .collection('payment_transactions')
        .findOne({ session_id: sessionId }, { projection: { _id: 0 } })

      if (!txn) {
        return handleCORS(NextResponse.json({ error: 'Transaction not found' }, { status: 404 }))
      }

      // Idempotent mark-paid (we do NOT grant credits here — that happens via
      // /api/credits/add called by the frontend, which owns the auth context).
      if (session.payment_status === 'paid' && txn.payment_status !== 'paid') {
        await db.collection('payment_transactions').updateOne(
          { session_id: sessionId, payment_status: { $ne: 'paid' } },
          {
            $set: {
              payment_status: 'paid',
              status: session.status,
              updated_at: new Date().toISOString(),
            },
          },
        )
        console.log(
          `[Stripe] Payment confirmed for session ${sessionId}, credits to grant: ${txn.credits}`,
        )
      } else if (session.status === 'expired') {
        await db.collection('payment_transactions').updateOne(
          { session_id: sessionId },
          {
            $set: {
              payment_status: 'expired',
              status: 'expired',
              updated_at: new Date().toISOString(),
            },
          },
        )
      }

      const needs_grant = session.payment_status === 'paid' && !txn.credits_granted

      return handleCORS(
        NextResponse.json({
          status: session.status,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          credits: txn.credits,
          granted: session.payment_status === 'paid',
          needs_credit_grant: needs_grant,
        }),
      )
    } catch (err) {
      console.error('[Stripe] Status check error:', err.message)
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // ── POST /api/stripe/confirm-credits/:sessionId ─────────────────────
  const confirmMatch = route.match(/^\/stripe\/confirm-credits\/(.+)$/)
  if (confirmMatch && method === 'POST') {
    const user = await getAuthUser(request)
    if (!user) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const sessionId = confirmMatch[1]
    const db = await getDb()
    const result = await db.collection('payment_transactions').updateOne(
      { session_id: sessionId, credits_granted: { $ne: true } },
      {
        $set: {
          credits_granted: true,
          updated_at: new Date().toISOString(),
        },
      },
    )
    if (result.modifiedCount > 0) {
      console.log(`[Stripe] Credits confirmed as granted for session ${sessionId}`)
    }
    return handleCORS(NextResponse.json({ confirmed: true }))
  }

  return null
}
