import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/monitored — list monitored account activity (owner only)
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

  // For now, return empty array - you can implement monitored activity tracking later
  return NextResponse.json([])
}
