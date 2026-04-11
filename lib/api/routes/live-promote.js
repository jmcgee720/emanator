import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import fs from 'fs'
import path from 'path'

const APP_ROOT = '/app'

function safePath(filePath) {
  const resolved = path.resolve(APP_ROOT, filePath)
  if (!resolved.startsWith(APP_ROOT + '/')) return null
  // Block writes to critical infrastructure
  if (resolved.includes('/.git/') || resolved.includes('/.emergent/') || resolved.includes('/node_modules/')) return null
  return resolved
}

export async function handle(route, method, pathSegments, request) {
  // POST /projects/:id/promote-to-live
  if (route.match(/^\/projects\/[^/]+\/promote-to-live$/) && method === 'POST') {
    const projectId = pathSegments[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Not allowed' }, { status: 403 }))
    }

    // Must be owner
    if (dbUser.role !== 'owner') {
      return handleCORS(NextResponse.json({ error: 'Only the owner can promote to live' }, { status: 403 }))
    }

    const project = await db.projects.findById(projectId)
    if (!project || project.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }

    if (!project.settings?.is_core) {
      return handleCORS(NextResponse.json({ error: 'Only Core System projects can promote to live' }, { status: 400 }))
    }

    // Load draft files from DB
    const draftFiles = await db.projectFiles.findByProjectId(projectId)
    const writableFiles = draftFiles.filter(f => f.content != null && f.path && !f.path.startsWith('_'))

    if (writableFiles.length === 0) {
      return handleCORS(NextResponse.json({ error: 'No files to promote' }, { status: 400 }))
    }

    // Validate all paths before any writes
    const resolved = []
    for (const file of writableFiles) {
      const fullPath = safePath(file.path)
      if (!fullPath) {
        return handleCORS(NextResponse.json({ error: `Unsafe path rejected: ${file.path}` }, { status: 400 }))
      }
      resolved.push({ fullPath, content: file.content, path: file.path })
    }

    // Snapshot current disk state for files being overwritten
    const snapshotFiles = []
    for (const { fullPath, path: filePath } of resolved) {
      try {
        if (fs.existsSync(fullPath)) {
          const currentContent = fs.readFileSync(fullPath, 'utf-8')
          snapshotFiles.push({ path: filePath, content: currentContent })
        }
      } catch {}
    }

    let snapshotId = null
    try {
      const snapshot = await db.snapshots.create({
        project_id: projectId,
        name: `Pre-promote live: ${new Date().toISOString()}`,
        files_snapshot: snapshotFiles,
        canvas_snapshot: null,
      })
      snapshotId = snapshot.id
    } catch (snapErr) {
      console.error('[promote-to-live] Snapshot creation failed:', snapErr.message)
    }

    // Write files to disk (with size guardrail)
    const written = []
    const errors = []
    const blocked = []
    for (const { fullPath, content, path: filePath } of resolved) {
      try {
        // ── Size Guardrail: block destructive rewrites ──
        // If the new file is less than 30% the size of the original, it's likely
        // a destructive AI rewrite that stripped most of the code. Block it.
        if (fs.existsSync(fullPath)) {
          const originalSize = fs.statSync(fullPath).size
          const newSize = Buffer.byteLength(content, 'utf-8')
          if (originalSize > 500 && newSize < originalSize * 0.3) {
            blocked.push({ path: filePath, originalSize, newSize, reason: `New file is ${Math.round(newSize/originalSize*100)}% of original — likely destructive rewrite` })
            continue
          }
        }
        const dir = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(fullPath, content, 'utf-8')
        written.push(filePath)
      } catch (writeErr) {
        errors.push({ path: filePath, error: writeErr.message })
      }
    }

    if (blocked.length > 0) {
      console.warn('[promote-to-live] Blocked destructive rewrites:', blocked)
    }

    return handleCORS(NextResponse.json({
      success: errors.length === 0 && blocked.length === 0,
      files_written: written.length,
      files_failed: errors.length,
      files_blocked: blocked.length,
      snapshot_id: snapshotId,
      written,
      blocked: blocked.length > 0 ? blocked : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }))
  }

  // POST /projects/:id/rollback-live
  if (route.match(/^\/projects\/[^/]+\/rollback-live$/) && method === 'POST') {
    const projectId = pathSegments[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser || dbUser.role !== 'owner') {
      return handleCORS(NextResponse.json({ error: 'Only the owner can rollback live' }, { status: 403 }))
    }

    const project = await db.projects.findById(projectId)
    if (!project || project.user_id !== dbUser.id || !project.settings?.is_core) {
      return handleCORS(NextResponse.json({ error: 'Invalid project' }, { status: 400 }))
    }

    const body = await request.json()
    const { snapshot_id } = body

    if (!snapshot_id) {
      return handleCORS(NextResponse.json({ error: 'snapshot_id required' }, { status: 400 }))
    }

    const snapshot = await db.snapshots.findById(snapshot_id)
    if (!snapshot || snapshot.project_id !== projectId) {
      return handleCORS(NextResponse.json({ error: 'Snapshot not found' }, { status: 404 }))
    }

    const files = snapshot.files_snapshot || []
    if (files.length === 0) {
      return handleCORS(NextResponse.json({ error: 'Snapshot is empty' }, { status: 400 }))
    }

    const restored = []
    const errors = []
    for (const file of files) {
      const fullPath = safePath(file.path)
      if (!fullPath) continue
      try {
        const dir = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(fullPath, file.content, 'utf-8')
        restored.push(file.path)
      } catch (err) {
        errors.push({ path: file.path, error: err.message })
      }
    }

    return handleCORS(NextResponse.json({
      success: errors.length === 0,
      files_restored: restored.length,
      restored,
      errors: errors.length > 0 ? errors : undefined,
    }))
  }

  return null
}
