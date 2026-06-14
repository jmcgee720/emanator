// POST /api/previews/:projectId/reset
//
// Hard-reset the Fly preview machine for a project. Used when the
// dev-server filesystem ends up in a bad state — e.g. files were
// deleted in Supabase but a stale copy lingers on the machine's disk
// (the sync logic only writes/updates, never deletes). The standard
// Stop → Start cycle reuses the same machine and therefore the same
// disk. This endpoint destroys the machine entirely so the next Start
// provisions a clean slate from scratch.
//
// Idempotent: safe to call when no machine exists (returns ok:true).

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { findMachineForProject, destroyMachine } from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

export async function POST(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const projectId = params.projectId
  const project = await db.projects.findById(projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  }

  try {
    const machine = await findMachineForProject(projectId)
    if (!machine) {
      return handleCORS(NextResponse.json({ ok: true, alreadyClean: true }))
    }

    await destroyMachine(machine)
    return handleCORS(NextResponse.json({
      ok: true,
      destroyed: machine.id,
      message: 'Preview machine destroyed. Click Start Preview to provision a fresh one.',
    }))
  } catch (err) {
    return handleCORS(NextResponse.json({
      error: err?.message || 'reset failed',
    }, { status: 500 }))
  }
}
