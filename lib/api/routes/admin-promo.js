import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { getUserRole, hasPermission } from '@/lib/constants'

// Generate a random promo code
function generatePromoCode(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = prefix.toUpperCase()
  const length = 12 - code.length
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export async function handle(route, method, path, request) {
  // Get all promo codes (owner only)
  if (route === '/admin/promo-codes' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const currentUser = await db.users.findByEmail(authUser.email)
    if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
      return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
    }
    
    // Fetch promo codes and enrich with redemption data
    const codes = await db.promoCodes.findAll()
    const enriched = await Promise.all(codes.map(async (code) => {
      // Check if redeemed (uses_count > 0 means used)
      const isUsed = code.uses_count > 0
      let redemptionInfo = {}
      if (isUsed) {
        // Fetch redemption details
        const supabase = (await import('@/lib/supabase/db')).getSupabaseAdmin()
        const { data: redemption } = await supabase
          .from('user_promo_redemptions')
          .select('redeemed_at, users!user_promo_redemptions_user_id_fkey(email)')
          .eq('promo_code_id', code.id)
          .maybeSingle()
        if (redemption) {
          redemptionInfo = {
            redeemed_at: redemption.redeemed_at,
            redeemed_by_email: redemption.users?.email || null,
          }
        }
      }
      return {
        ...code,
        status: isUsed ? 'used' : 'active',
        ...redemptionInfo,
      }
    }))
    return handleCORS(NextResponse.json(enriched))
  }

  // Create a new promo code (owner only)
  if (route === '/admin/promo-codes' && method === 'POST') {
    try {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const currentUser = await db.users.findByEmail(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
        return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
      }
      
      const body = await request.json()
      const { prefix = '', plan = 'unlimited', max_uses = 1, expires_at = null, description, recipient_email } = body
      
      console.log('[Promo] Creating code:', { description, recipient_email, hasEmail: !!recipient_email })
      
      if (!recipient_email || !recipient_email.trim()) {
        return handleCORS(NextResponse.json({ error: 'Recipient email is required' }, { status: 400 }))
      }
      
      // Generate unique code
      let code = generatePromoCode(prefix)
      let attempts = 0
      while (attempts < 10) {
        const existing = await db.promoCodes.findByCode(code)
        if (!existing) break
        code = generatePromoCode(prefix)
        attempts++
      }
      
      if (attempts >= 10) {
        return handleCORS(NextResponse.json({ error: 'Failed to generate unique code' }, { status: 500 }))
      }
      
      console.log('[Promo] Generated code:', code)
      
      const newCode = await db.promoCodes.create({
        code,
        plan,
        max_uses,
        created_by: currentUser.id,
        expires_at,
        description: description || null,
      })
      
      console.log('[Promo] Code saved to DB:', newCode.id)
      
      // Send email to recipient
      try {
        const { sendPromoCodeEmail } = await import('@/lib/email/service')
        console.log('[Promo] Sending email to:', recipient_email)
        await sendPromoCodeEmail({
          to: recipient_email.trim(),
          code: code,
          senderName: currentUser.email.split('@')[0] || 'Auroraly',
        })
        console.log('[Promo] Email sent successfully')
      } catch (emailError) {
        console.error('[Promo] Email send failed:', emailError.message)
        // Don't fail the request if email fails — code is still valid
      }
      
      return handleCORS(NextResponse.json(newCode, { status: 201 }))
    } catch (err) {
      console.error('[Promo] Create error:', err.message, err.stack)
      return handleCORS(NextResponse.json({ 
        error: 'Failed to create promo code', 
        details: err.message 
      }, { status: 500 }))
    }
  }

  // Deactivate a promo code (owner only)
  if (route.startsWith('/admin/promo-codes/') && method === 'DELETE') {
    const codeId = path[2]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const currentUser = await db.users.findByEmail(authUser.email)
    if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
      return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
    }
    
    await db.promoCodes.deactivate(codeId)
    return handleCORS(NextResponse.json({ success: true }))
  }

  return null
}
