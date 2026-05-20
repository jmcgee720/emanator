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
    
    const codes = await db.promoCodes.findAll()
    return handleCORS(NextResponse.json(codes))
  }

  // Create a new promo code (owner only)
  if (route === '/admin/promo-codes' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const currentUser = await db.users.findByEmail(authUser.email)
    if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
      return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
    }
    
    const body = await request.json()
    const { prefix = '', plan = 'unlimited', max_uses = 1, expires_at = null } = body
    
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
    
    const newCode = await db.promoCodes.create({
      code,
      plan,
      max_uses,
      created_by: currentUser.id,
      expires_at,
    })
    
    return handleCORS(NextResponse.json(newCode, { status: 201 }))
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
