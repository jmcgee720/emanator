import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function generatePromoCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// GET /api/admin/promo-codes — list all promo codes (owner only)
export async function GET(request) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dbUser = await db.users.findByEmail(authUser.email)
  if (!dbUser || dbUser.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const codes = await db.promoCodes.findAll()
  return NextResponse.json(codes)
}

// POST /api/admin/promo-codes — generate a new promo code (owner only)
export async function POST(request) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dbUser = await db.users.findByEmail(authUser.email)
  if (!dbUser || dbUser.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { plan, max_uses, description } = await request.json()
  const code = generatePromoCode()

  try {
    const newCode = await db.promoCodes.create({
      code,
      plan: plan || 'unlimited',
      max_uses: max_uses || 1,
      created_by: dbUser.id,
      description,
    })

    return NextResponse.json(newCode)
  } catch (err) {
    console.error('[POST /api/admin/promo-codes] Error:', err)
    return NextResponse.json({ 
      error: err.message || 'Failed to create promo code',
      details: err.details || null,
      hint: err.hint || null,
      code: err.code || null
    }, { status: 500 })
  }
}
