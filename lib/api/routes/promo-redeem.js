import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  // Redeem a promo code
  if (route === '/promo/redeem' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const currentUser = await db.users.findByEmail(authUser.email)
    if (!currentUser) {
      return handleCORS(NextResponse.json({ error: 'User not found' }, { status: 404 }))
    }
    
    const body = await request.json()
    const { code } = body
    
    if (!code || typeof code !== 'string') {
      return handleCORS(NextResponse.json({ error: 'Code is required' }, { status: 400 }))
    }
    
    // Find the promo code
    const promoCode = await db.promoCodes.findByCode(code.trim())
    
    if (!promoCode) {
      return handleCORS(NextResponse.json({ error: 'Invalid promo code' }, { status: 404 }))
    }
    
    // Check if code is active
    if (!promoCode.is_active) {
      return handleCORS(NextResponse.json({ error: 'This promo code is no longer active' }, { status: 400 }))
    }
    
    // Check if code has expired
    if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date()) {
      return handleCORS(NextResponse.json({ error: 'This promo code has expired' }, { status: 400 }))
    }
    
    // Check if user has already redeemed this code
    const alreadyRedeemed = await db.promoRedemptions.hasUserRedeemed(currentUser.id, promoCode.id)
    if (alreadyRedeemed) {
      return handleCORS(NextResponse.json({ error: 'You have already redeemed this code' }, { status: 400 }))
    }
    
    // Check if code has reached max uses
    if (promoCode.uses_count >= promoCode.max_uses) {
      return handleCORS(NextResponse.json({ error: 'This promo code has reached its usage limit' }, { status: 400 }))
    }
    
    // Redeem the code
    try {
      // Create redemption record
      await db.promoRedemptions.create({
        user_id: currentUser.id,
        promo_code_id: promoCode.id,
      })
      
      // Increment uses count
      await db.promoCodes.incrementUses(promoCode.id)
      
      // Update user plan
      await db.users.update(currentUser.id, { plan: promoCode.plan })
      
      return handleCORS(NextResponse.json({
        success: true,
        plan: promoCode.plan,
        message: `Successfully redeemed! You now have ${promoCode.plan} access.`
      }))
    } catch (error) {
      console.error('[promo-redeem] Error:', error)
      return handleCORS(NextResponse.json({ error: 'Failed to redeem code' }, { status: 500 }))
    }
  }

  // Get user's redemption history
  if (route === '/promo/history' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const currentUser = await db.users.findByEmail(authUser.email)
    if (!currentUser) {
      return handleCORS(NextResponse.json({ error: 'User not found' }, { status: 404 }))
    }
    
    const redemptions = await db.promoRedemptions.findByUserId(currentUser.id)
    return handleCORS(NextResponse.json(redemptions))
  }

  return null
}
