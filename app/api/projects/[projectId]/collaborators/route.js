import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

async function assertOwner(projectId, userId) {
  const project = await db.projects.findById(projectId)
  if (!project) return { ok: false, status: 404, error: 'Project not found' }
  if (project.user_id !== userId) return { ok: false, status: 403, error: 'Only the project owner can manage collaborators.' }
  return { ok: true, project }
}

export async function GET(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const check = await assertOwner(params.projectId, dbUser.id)
  if (!check.ok) return handleCORS(NextResponse.json({ error: check.error }, { status: check.status }))

  const list = await db.projectCollaborators.list(params.projectId)
  return handleCORS(NextResponse.json({
    collaborators: list.map((c) => ({
      user_id: c.user_id,
      role: c.role,
      invited_at: c.invited_at,
      email: c.users?.email || null,
      name: c.users?.name || null,
      avatar_url: c.users?.avatar_url || null,
    })),
  }))
}

export async function POST(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const check = await assertOwner(params.projectId, dbUser.id)
  if (!check.ok) return handleCORS(NextResponse.json({ error: check.error }, { status: check.status }))

  let body
  try { body = await request.json() } catch { return handleCORS(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })) }
  const email = body?.email
  const role = body?.role || 'viewer'
  if (!email) return handleCORS(NextResponse.json({ error: 'email is required' }, { status: 400 }))
  if (email.toLowerCase() === authUser.email?.toLowerCase()) {
    return handleCORS(NextResponse.json({ error: 'You are already the owner of this project.' }, { status: 400 }))
  }

  try {
    const row = await db.projectCollaborators.invite({
      projectId: params.projectId,
      email,
      role,
      invitedBy: dbUser.id,
    })
    return handleCORS(NextResponse.json({ ok: true, collaborator: row }))
  } catch (err) {
    const status = /No user found/.test(err.message) ? 404 : 400
    return handleCORS(NextResponse.json({ error: err.message || 'Failed to invite' }, { status }))
  }
}

export async function DELETE(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const check = await assertOwner(params.projectId, dbUser.id)
  if (!check.ok) return handleCORS(NextResponse.json({ error: check.error }, { status: check.status }))

  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id')
  if (!userId) return handleCORS(NextResponse.json({ error: 'user_id query param required' }, { status: 400 }))

  try {
    await db.projectCollaborators.remove({ projectId: params.projectId, userId })
    return handleCORS(NextResponse.json({ ok: true }))
  } catch (err) {
    return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
