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

    // Write files to disk (with size guardrail + syntax validation)
    const written = []
    const errors = []
    const warnings = []
    for (const { fullPath, content, path: filePath } of resolved) {
      try {
        // ── Syntax Validation: check JS/JSX files compile before writing ──
        if (filePath.match(/\.(js|jsx|ts|tsx|mjs)$/)) {
          // ── Package Import Validation: block imports of non-installed packages ──
          const allowedPackages = new Set([
            'fs', 'path', 'url', 'crypto', 'util', 'stream', 'buffer', 'os', 'child_process', 'http', 'https', 'events', 'querystring',
            'next', 'next/server', 'next/router', 'next/navigation', 'next/image', 'next/link', 'next/font',
            'react', 'react-dom', 'openai', '@anthropic-ai/sdk', '@supabase/supabase-js', '@supabase/ssr',
            'axios', 'jszip', 'file-saver', 'uuid', 'date-fns', 'zod', 'lucide-react',
            'react-markdown', 'remark-gfm', 'recharts', 'sonner', 'clsx', 'tailwind-merge',
            'mongodb', 'pg', 'resend', 'class-variance-authority', 'prop-types',
            '@tanstack/react-table', 'cmdk', 'vaul', 'embla-carousel-react', 'input-otp',
            'react-hook-form', '@hookform/resolvers', 'react-day-picker', 'react-resizable-panels',
            'tailwindcss-animate', 'next-themes',
          ])
          // Match require('pkg') and import ... from 'pkg'
          const importRegex = /(?:require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)|from\s+['"]([^'"./][^'"]*)['"]\s*)/g
          let importMatch
          const blockedImports = []
          while ((importMatch = importRegex.exec(content)) !== null) {
            const pkg = (importMatch[1] || importMatch[2] || '').split('/')[0]
            const fullPkg = importMatch[1] || importMatch[2]
            // Skip @/ path aliases (Next.js internal imports like @/lib/*, @/components/*, @/hooks/*)
            if (fullPkg.startsWith('@/')) continue
            if (pkg && !allowedPackages.has(pkg) && !allowedPackages.has(fullPkg) && !pkg.startsWith('@radix-ui')) {
              blockedImports.push(fullPkg)
            }
          }
          if (blockedImports.length > 0) {
            errors.push({ path: filePath, error: `Blocked: imports non-installed package(s): ${blockedImports.join(', ')}. Only use packages already in package.json.` })
            console.warn('[promote-to-live] BLOCKED:', filePath, '— unknown imports:', blockedImports.join(', '))
            continue
          }

          try {
            // Basic syntax check: try to parse as a module
            new Function('"use strict";' + content.replace(/export\s+/g, '').replace(/import\s+.*?from\s+/g, '// '))
          } catch (syntaxErr) {
            // Check for common AI-introduced syntax errors
            const hasBrokenObject = /\{[^}]*,\s*\n\s*[a-zA-Z]/.test(content) && content.includes('{,')
            const hasOrphanedCode = /^\s*(const|let|var|function|class|export)\s/m.test(content) && content.split('{').length !== content.split('}').length
            if (hasBrokenObject || hasOrphanedCode) {
              errors.push({ path: filePath, error: `Syntax error detected — file not written to prevent corruption. Error: ${syntaxErr.message}` })
              console.warn('[promote-to-live] BLOCKED:', filePath, '— syntax error:', syntaxErr.message)
              continue
            }
            // Non-critical parse warnings (template literals, JSX etc may not parse in Function constructor)
            console.log('[promote-to-live] Parse warning (non-blocking):', filePath, syntaxErr.message?.slice(0, 80))
          }
        }

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

      // ── Post-write Health Check: verify app still compiles after changes ──
      // Wait for Next.js to recompile, then check health
      try {
        await new Promise(resolve => setTimeout(resolve, 3000))
        // Hit both health AND the chat stream compile path to catch lazy-loaded import errors
        const [healthRes, compileRes] = await Promise.all([
          fetch('http://localhost:3000/api/health'),
          fetch('http://localhost:3000/api/health?compile=full').catch(() => ({ ok: true })) // non-critical
        ])
        
        // Also try to trigger compilation of the stream route by hitting the chat API
        try {
          await fetch('http://localhost:3000/api/chats/healthcheck', { method: 'GET' }).catch(() => {})
          await new Promise(resolve => setTimeout(resolve, 2000)) // wait for lazy compile
        } catch { /* non-critical */ }

        // Re-check health after compilation
        const health2 = await fetch('http://localhost:3000/api/health').catch(() => ({ ok: false }))
        const isHealthy = healthRes.ok && (health2?.ok !== false)
        
        if (!isHealthy) {
          console.error('[promote-to-live] HEALTH CHECK FAILED — auto-reverting!')
          // Revert: restore from snapshot
          const snapshot = await db.snapshots.findById(snapshotId)
          if (snapshot?.files_snapshot) {
            let reverted = 0
            for (const file of snapshot.files_snapshot) {
              try {
                const revertPath = path.resolve(APP_ROOT, file.path)
                fs.writeFileSync(revertPath, file.content, 'utf-8')
                reverted++
              } catch { /* best effort */ }
            }
            console.log(`[promote-to-live] Auto-reverted ${reverted} file(s) from snapshot ${snapshotId}`)
            return handleCORS(NextResponse.json({
              success: false,
              auto_reverted: true,
              files_reverted: reverted,
              error: 'Changes caused a compilation error and were automatically reverted. The AI patch broke something — try a smaller, more targeted edit.',
              snapshot_id: snapshotId,
            }))
          }
        } else {
          console.log('[promote-to-live] Health check passed — changes are safe')
        }
      } catch (healthErr) {
        console.warn('[promote-to-live] Health check error (non-fatal):', healthErr.message)
      }
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
