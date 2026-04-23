import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { creditsDb, CREDIT_COSTS, CREDIT_PACKAGES, MODEL_COSTS, LOYALTY_TIERS, applyLoyaltyBonus } from '@/lib/credits/service'

export async function handle(route, method, path, request) {
  if (route === '/credits' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    let dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const balance = await creditsDb.getBalance(dbUser.id)
      // Show preview of loyalty bonus for each pack based on current lifetime.
      const packagesWithBonus = CREDIT_PACKAGES.map((p) => {
        const { bonus, total, tier } = applyLoyaltyBonus(p.amount, balance.lifetime_purchased_usd)
        return { ...p, baseCredits: p.amount, bonusCredits: bonus, totalCredits: total, tier: tier.label }
      })
      return handleCORS(NextResponse.json({
        ...balance,
        costs: CREDIT_COSTS,
        packages: packagesWithBonus,
        modelCosts: MODEL_COSTS,
        loyaltyTiers: LOYALTY_TIERS,
      }))
    } catch (err) {
      console.error('[Credits] Get balance error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to get credits' }, { status: 500 }))
    }
  }

  if (route === '/credits/use' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    let dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const { action_type } = body

      if (!action_type || !CREDIT_COSTS[action_type]) {
        return handleCORS(NextResponse.json({
          error: `Invalid action_type. Valid types: ${Object.keys(CREDIT_COSTS).join(', ')}`,
        }, { status: 400 }))
      }

      const result = await creditsDb.deductCredits(dbUser.id, action_type)

      if (result.error) {
        return handleCORS(NextResponse.json(result, { status: 402 }))
      }

      return handleCORS(NextResponse.json(result))
    } catch (err) {
      console.error('[Credits] Use error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 }))
    }
  }

  if (route === '/credits/add' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    let dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const { amount, price_paid_usd } = body

      if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        return handleCORS(NextResponse.json({ error: 'Invalid amount' }, { status: 400 }))
      }

      const result = await creditsDb.addCredits(dbUser.id, parseFloat(amount), {
        pricePaidUsd: price_paid_usd ? parseFloat(price_paid_usd) : 0,
      })
      return handleCORS(NextResponse.json(result))
    } catch (err) {
      console.error('[Credits] Add error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to add credits' }, { status: 500 }))
    }
  }

  return null
}
