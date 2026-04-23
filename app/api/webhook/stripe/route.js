/**
 * Stripe webhook receiver — ported from server.py.
 *
 * Lives outside the catch-all because Stripe's signature verification needs
 * the raw request body, byte-for-byte. The catch-all would consume it as JSON.
 *
 * Signature verification requires STRIPE_WEBHOOK_SECRET to be set
 * (from the Stripe dashboard: Developers → Webhooks → Add endpoint → reveal signing secret).
 *
 * If STRIPE_WEBHOOK_SECRET is missing, we accept the event without verification
 * ONLY in development. In production, unsigned webhooks are rejected.
 */

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'
// Important: tell Next.js not to parse the body — we need raw bytes for sig.
export const dynamic = 'force-dynamic'

function getStripe() {
  const apiKey = process.env.STRIPE_API_KEY
  if (!apiKey) return null
  return new Stripe(apiKey, { apiVersion: '2024-11-20.acacia' })
}

export async function POST(request) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const rawBody = await request.text()

  let event
  try {
    if (secret && signature) {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret)
    } else if (process.env.NODE_ENV !== 'production') {
      // Dev-mode fallback: parse without verifying (Stripe CLI forwarding).
      event = JSON.parse(rawBody)
      console.warn('[Stripe Webhook] Signature NOT verified — STRIPE_WEBHOOK_SECRET missing. Dev mode only.')
    } else {
      return NextResponse.json(
        { error: 'Webhook signature verification failed (missing secret or signature)' },
        { status: 400 },
      )
    }
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  console.log(`[Stripe Webhook] Event: ${event.type}, id: ${event.id}`)

  // Only handle what we care about.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const sessionId = session.id

    try {
      const db = await getDb()
      const txn = await db
        .collection('payment_transactions')
        .findOne({ session_id: sessionId }, { projection: { _id: 0 } })

      if (txn && txn.payment_status !== 'paid') {
        await db.collection('payment_transactions').updateOne(
          { session_id: sessionId, payment_status: { $ne: 'paid' } },
          {
            $set: {
              payment_status: 'paid',
              status: 'complete',
              updated_at: new Date().toISOString(),
            },
          },
        )
        console.log(
          `[Stripe Webhook] Payment confirmed for session ${sessionId}, credits pending frontend grant: ${txn.credits}`,
        )
      } else {
        console.log('[Stripe Webhook] Skipped — already paid or transaction not found')
      }
    } catch (err) {
      console.error('[Stripe Webhook] DB error:', err.message)
      // We still ack to Stripe — they'll retry if we return non-2xx.
    }
  }

  return NextResponse.json({ received: true })
}
