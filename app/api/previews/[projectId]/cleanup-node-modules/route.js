// POST /api/previews/:projectId/cleanup-node-modules
//
// Emergency cleanup endpoint: removes all node_modules rows from the
// project_files table and triggers a runner restart.
//
// PROBLEM: The sync process was treating node_modules/ as source files
// and writing them to the database. This caused "removed 13552 stale"
// bugs that deleted critical dependency files on subsequent syncs.
//
// This endpoint:
//   1. Deletes all rows where path contains node_modules
//   2. Stops the preview machine (if running)
//   3. Returns success (next /start will do a fresh npm install)
//
// Safe to call multiple times — idempotent.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { createAdminClient } from '@/lib/supabase/admin'
import { findMachineForProject, stopMachine } from '@/lib/fly/machines'

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
    const supabase = createAdminClient()
    
    // Count how many rows we're about to delete
    const { count, error: countError } = await supabase
      .from('project_files')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .or('path.like.%/node_modules/%,path.like.node_modules/%')
    
    if (countError) {
      console.error('[cleanup-node-modules] Count failed:', countError)
      return handleCORS(NextResponse.json({
        error: 'Failed to count node_modules rows',
        details: countError.message,
      }, { status: 500 }))
    }
    
    if (count === 0) {
      return handleCORS(NextResponse.json({
        ok: true,
        alreadyClean: true,
        message: 'No node_modules rows found — project is already clean',
      }))
    }
    
    // Delete all node_modules rows
    const { error: deleteError } = await supabase
      .from('project_files')
      .delete()
      .eq('project_id', projectId)
      .or('path.like.%/node_modules/%,path.like.node_modules/%')
    
    if (deleteError) {
      console.error('[cleanup-node-modules] Delete failed:', deleteError)
      return handleCORS(NextResponse.json({
        error: 'Failed to delete node_modules rows',
        details: deleteError.message,
      }, { status: 500 }))
    }
    
    // Stop the preview machine so the next /start does a fresh npm install
    try {
      const machine = await findMachineForProject(projectId)
      if (machine) {
        await stopMachine(machine.id)
      }
    } catch (stopErr) {
      // Non-fatal — the cleanup succeeded, stopping is just a courtesy
      console.warn('[cleanup-node-modules] Failed to stop machine:', stopErr)
    }
    
    return handleCORS(NextResponse.json({
      ok: true,
      deleted: count,
      message: `Deleted ${count} node_modules rows. Preview machine stopped. Next start will do a fresh npm install.`,
    }))
  } catch (err) {
    console.error('[cleanup-node-modules] Unexpected error:', err)
    return handleCORS(NextResponse.json({
      error: err?.message || 'cleanup failed',
    }, { status: 500 }))
  }
}
