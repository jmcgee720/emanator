import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  if (route.match(/^\/projects\/[^/]+\/files$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const files = await db.projectFiles.findByProjectId(projectId)
    const sanitized = files.map(f => {
      if (f.path?.startsWith('_generated/') || (f.path?.startsWith('_uploads/') && f.file_type === 'image')) {
        return { ...f, content: `[asset: ${f.path}]` }
      }
      return f
    })
    return handleCORS(NextResponse.json(sanitized))
  }

  if (route.match(/^\/projects\/[^/]+\/files-index$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const files = await db.projectFiles.findIndexByProjectId(projectId)
    return handleCORS(NextResponse.json({ files }))
  }

  if (route.match(/^\/projects\/[^/]+\/files$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const body = await request.json()
    const { path: filePath, content, file_type = 'text' } = body
    
    if (!filePath) {
      return handleCORS(NextResponse.json({ error: 'File path required' }, { status: 400 }))
    }
    
    const result = await db.projectFiles.upsert(projectId, filePath, content || '', file_type)
    
    return handleCORS(NextResponse.json({ 
      success: true, 
      ...result 
    }, { status: result.action === 'created' ? 201 : 200 }))
  }

  if (route.match(/^\/projects\/[^/]+\/files\/[^/]+$/) && method === 'DELETE') {
    const fileId = path[3]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    await db.projectFiles.delete(fileId)
    
    return handleCORS(NextResponse.json({ success: true }))
  }

  // ── Preview Snapshot: GET ──
  if (route.match(/^\/projects\/[^/]+\/preview-snapshot$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const project = await db.projects.findById(projectId)
    if (!project) return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    const snapshot = project.settings?.preview_snapshot || null
    return handleCORS(NextResponse.json({ snapshot }))
  }

  // ── Preview Snapshot: PUT ──
  if (route.match(/^\/projects\/[^/]+\/preview-snapshot$/) && method === 'PUT') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const project = await db.projects.findById(projectId)
    if (!project) return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    const body = await request.json()
    const { html, files_hash } = body
    const settings = { ...(project.settings || {}), preview_snapshot: { html, files_hash, saved_at: new Date().toISOString() } }
    await db.projects.update(projectId, { settings })
    return handleCORS(NextResponse.json({ success: true }))
  }

  if (route.match(/^\/projects\/[^/]+\/sync-repo$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const project = await db.projects.findById(projectId)
    if (!project || project.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    }

    const fs = await import('fs/promises')
    const nodePath = await import('path')
    const BASE = process.cwd()
    const SYNC_DIRS = ['lib', 'app', 'components']
    const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.md'])
    const SKIP = new Set(['node_modules', '.next', '.git', '.emergent', 'dist', 'build'])

    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const files = []
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue
        const full = nodePath.join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...await walk(full))
        } else if (EXTENSIONS.has(nodePath.extname(entry.name).toLowerCase())) {
          files.push(full)
        }
      }
      return files
    }

    let synced = 0
    let errors = 0
    for (const dir of SYNC_DIRS) {
      const absDir = nodePath.join(BASE, dir)
      try { await fs.access(absDir) } catch { continue }
      const diskFiles = await walk(absDir)
      for (const absPath of diskFiles) {
        const relPath = nodePath.relative(BASE, absPath)
        try {
          const content = await fs.readFile(absPath, 'utf-8')
          const ext = nodePath.extname(absPath).toLowerCase().replace('.', '')
          await db.projectFiles.upsert(projectId, relPath, content, ext || 'text')
          synced++
        } catch (err) {
          console.log(`[sync-repo] Error syncing ${relPath}:`, err.message)
          errors++
        }
      }
    }

    const ROOT_FILES = ['package.json', 'next.config.mjs', 'tailwind.config.js', 'postcss.config.mjs', 'jsconfig.json']
    for (const name of ROOT_FILES) {
      try {
        const content = await fs.readFile(nodePath.join(BASE, name), 'utf-8')
        const ext = nodePath.extname(name).toLowerCase().replace('.', '')
        await db.projectFiles.upsert(projectId, name, content, ext || 'text')
        synced++
      } catch {}
    }

    return handleCORS(NextResponse.json({ success: true, synced, errors }))
  }

  return null
}
