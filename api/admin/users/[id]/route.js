import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PUT /api/admin/users/[id] — update user role (owner only)
export async function PUT(request, { params }) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dbUser = await db.users.findByEmail(authUser.email)
  if (!dbUser || dbUser.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { role } = await request.json()
  if (!role) {
    return NextResponse.json({ error: 'Missing role' }, { status: 400 })
  }

  await db.users.updateRole(id, role)
  return NextResponse.json({ success: true })
}

// DELETE /api/admin/users/[id] — remove user (owner only)
export async function DELETE(request, { params }) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dbUser = await db.users.findByEmail(authUser.email)
  if (!dbUser || dbUser.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  await db.users.delete(id)
  return NextResponse.json({ success: true })
}
