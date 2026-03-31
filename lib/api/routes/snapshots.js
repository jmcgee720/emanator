import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  // Get snapshots for project
  if (route.match(/^\/projects\/[^/]+\/snapshots$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const snapshots = await db.snapshots.findByProjectId(projectId)
    return handleCORS(NextResponse.json(snapshots))
  }

  // Create snapshot
  if (route.match(/^\/projects\/[^/]+\/snapshots$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const body = await request.json()
    const { name } = body
    
    if (!name) {
      return handleCORS(NextResponse.json({ error: 'Snapshot name required' }, { status: 400 }))
    }
    
    // Get all files for project
    const files = await db.projectFiles.findByProjectId(projectId)
    
    // Get canvas
    const canvas = await db.projectCanvas.findByProjectId(projectId)
    
    const snapshot = await db.snapshots.create({
      project_id: projectId,
      name,
      files_snapshot: files,
      canvas_snapshot: canvas?.canvas_content || null,
      metadata: {
        file_count: files.length,
        created_by: authUser.email
      }
    })
    
    return handleCORS(NextResponse.json(snapshot, { status: 201 }))
  }

  // Restore snapshot
  if (route.match(/^\/snapshots\/[^/]+\/restore$/) && method === 'POST') {
    const snapshotId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const snapshot = await db.snapshots.findById(snapshotId)
    if (!snapshot) {
      return handleCORS(NextResponse.json({ error: 'Snapshot not found' }, { status: 404 }))
    }
    
    const projectId = snapshot.project_id
    
    // Delete current files
    await db.projectFiles.deleteByProjectId(projectId)
    
    // Restore files from snapshot
    if (snapshot.files_snapshot && snapshot.files_snapshot.length > 0) {
      const restoredFiles = snapshot.files_snapshot.map(f => ({
        project_id: projectId,
        path: f.path,
        content: f.content,
        file_type: f.file_type,
        version: 1,
        restored_from: snapshotId
      }))
      await db.projectFiles.bulkInsert(restoredFiles)
    }
    
    // Restore canvas if present
    if (snapshot.canvas_snapshot) {
      await db.projectCanvas.update(projectId, snapshot.canvas_snapshot)
    }
    
    return handleCORS(NextResponse.json({ 
      success: true, 
      restored_files: snapshot.files_snapshot?.length || 0 
    }))
  }

  return null
}
