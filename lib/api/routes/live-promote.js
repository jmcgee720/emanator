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
  // GET /projects/:id/file-diff?path=...
  if (route.match(/^\/projects\/[^/]+\/file-diff$/) && method === 'GET') {
    return handleFileDiff(route, method, pathSegments, request)
  }
  
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

    // Write files to disk (with size guardrail warning)
    const written = []
    const errors = []
    const warnings = []
    for (const { fullPath, content, path: filePath } of resolved) {
      try {
        // ── Size Guardrail: warn on potential destructive rewrites ──
        if (fs.existsSync(fullPath)) {
          const originalSize = fs.statSync(fullPath).size
          const newSize = Buffer.byteLength(content, 'utf-8')
          if (originalSize > 500 && newSize < originalSize * 0.3) {
            warnings.push({ path: filePath, originalSize, newSize, note: `File shrunk to ${Math.round(newSize/originalSize*100)}% of original. Use Rollback if this was unintended.` })
            console.warn('[promote-to-live] Size warning:', filePath, `${originalSize}→${newSize} bytes`)
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

    // Invalidate module caches for written files so hot-reload picks them up
    if (written.length > 0) {
      try {
        const { invalidateCache } = await import('/app/lib/ai/filesystem.js')
        invalidateCache?.()
      } catch { /* non-critical */ }

      // Clear Node.js require cache for the specific written files
      for (const filePath of written) {
        const fullPath = path.resolve(APP_ROOT, filePath)
        try {
          // Delete from require cache if cached
          if (require.cache[fullPath]) {
            delete require.cache[fullPath]
          }
          // Touch file to ensure file watcher detects the change
          const now = new Date()
          fs.utimesSync(fullPath, now, now)
        } catch { /* non-critical */ }
      }
      console.log('[promote-to-live] Cache invalidated, files touched for hot-reload:', written.join(', '))
    }

    return handleCORS(NextResponse.json({
      success: errors.length === 0,
      files_written: written.length,
      files_failed: errors.length,
      files_warned: warnings.length,
      snapshot_id: snapshotId,
      written,
      warnings: warnings.length > 0 ? warnings : undefined,
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

  // GET /projects/:id/patch-history
  if (route.match(/^\/projects\/[^/]+\/patch-history$/) && method === 'GET') {
    return handlePatchHistory(route, method, pathSegments, request)
  }

  return null
}

async function handlePatchHistory(route, method, pathSegments, request) {
  const projectId = pathSegments[1]
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Not allowed' }, { status: 403 }))

  // Fetch all snapshots for this project (pre-promote snapshots = patch history)
  const snapshots = await db.snapshots.findByProjectId(projectId)
  // Filter to only "Pre-promote live" snapshots (created by Apply to Live)
  const patchHistory = (snapshots || [])
    .filter(s => s.name && s.name.startsWith('Pre-promote live:'))
    .map(s => ({
      id: s.id,
      name: s.name,
      created_at: s.created_at,
      file_count: s.files_snapshot?.length || 0,
      files: (s.files_snapshot || []).map(f => ({ path: f.path, size: f.content?.length || 0 })),
    }))
    .slice(0, 50) // limit

  return handleCORS(NextResponse.json({ history: patchHistory }))
}

export async function handleFileDiff(route, method, pathSegments, request) {
  // GET /projects/:id/file-diff?path=lib/ai/prompt-builder.js
  if (method !== 'GET') return null
  
  const user = await getAuthUser(request)
  if (!user) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  
  const url = new URL(request.url)
  const filePath = url.searchParams.get('path')
  if (!filePath) return handleCORS(NextResponse.json({ error: 'path required' }, { status: 400 }))
  
  const fullPath = safePath(filePath)
  if (!fullPath) return handleCORS(NextResponse.json({ error: 'Invalid path' }, { status: 400 }))
  
  try {
    if (fs.existsSync(fullPath)) {
      const original = fs.readFileSync(fullPath, 'utf-8')
      return handleCORS(NextResponse.json({ original, path: filePath }))
    }
    return handleCORS(NextResponse.json({ original: null, path: filePath }))
  } catch (err) {
    return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
