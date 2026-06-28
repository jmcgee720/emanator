import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { pushProjectToGithub, validateGithubToken } from '@/lib/github/push-service'

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
  // SNAPSHOT_VERSION bumps invalidate older saved snapshots whose embedded
  // HTML still pins broken external CDN URLs. v2 (Jun 2026): @babel/standalone
  // pinned to @7 because v8 removed `isTSX`/`allExtensions` on preset-typescript
  // and broke every cached preview thumbnail with red "Preview Compile Error".
  const SNAPSHOT_VERSION = 'v2-babel7'
  if (route.match(/^\/projects\/[^/]+\/preview-snapshot$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const project = await db.projects.findById(projectId)
    if (!project) return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    const snapshot = project.settings?.preview_snapshot || null
    // Stale snapshot — client will lazy-rebuild from files with the new pinned URL.
    if (snapshot && snapshot.version !== SNAPSHOT_VERSION) {
      return handleCORS(NextResponse.json({ snapshot: null, invalidated: true }))
    }
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

    // Read raw body. Vercel's request.json() will throw if the
    // body exceeds the 4.5 MB Lambda payload limit, so we manually
    // text() and skip the save (returning 200 ok-skip) when the
    // imported app produces a giant snapshot full of base64 image
    // data. The thumbnail will simply re-build from files next time.
    let rawText = ''
    try { rawText = await request.text() } catch { rawText = '' }
    const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024 // 3 MB cap — leaves headroom under Lambda's 4.5 MB
    if (rawText.length > MAX_SNAPSHOT_BYTES) {
      console.log(`[preview-snapshot] skipping save for ${projectId} — ${(rawText.length/1024/1024).toFixed(1)} MB exceeds cap`)
      return handleCORS(NextResponse.json({ success: true, skipped: true, reason: 'snapshot_too_large', bytes: rawText.length }))
    }
    let body = {}
    try { body = JSON.parse(rawText) } catch { body = {} }
    const { html, files_hash } = body
    if (!html || typeof html !== 'string') {
      return handleCORS(NextResponse.json({ error: 'html required' }, { status: 400 }))
    }
    const settings = { ...(project.settings || {}), preview_snapshot: { html, files_hash, version: SNAPSHOT_VERSION, saved_at: new Date().toISOString() } }
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

  // POST /api/projects/:id/github/validate-token
  // Validates a GitHub PAT before we attempt a push. Returns the
  // authenticated user's login so the UI can confirm "you're pushing
  // as @username" before they confirm. Doesn't persist the token.
  if (route.match(/^\/projects\/[^/]+\/github\/validate-token$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    try {
      const { token } = await request.json()
      const info = await validateGithubToken(token)
      return handleCORS(NextResponse.json({ valid: true, user: info }))
    } catch (e) {
      return handleCORS(NextResponse.json({ valid: false, error: e.message || 'Invalid token' }, { status: 200 }))
    }
  }

  // POST /api/projects/:id/github/push
  // Pushes all of a project's files to a GitHub repo (creates the repo
  // on first push). If `save_token` is true, persists the PAT in
  // project.settings.github so subsequent pushes are one-click.
  if (route.match(/^\/projects\/[^/]+\/github\/push$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const project = await db.projects.findById(projectId)
    if (!project || project.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }

    try {
      const body = await request.json()
      const tokenFromBody = body.token
      const savedToken = project.settings?.github?.token
      const token = tokenFromBody || savedToken
      if (!token) {
        return handleCORS(NextResponse.json({ error: 'GitHub token required (paste or use saved)' }, { status: 400 }))
      }
      const repoName = body.repo_name || `auroraly-${project.name?.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'}`
      const commitMessage = body.commit_message || `Update from Auroraly — ${new Date().toISOString().slice(0, 10)}`
      const isPrivate = body.private !== false // default to private

      // Pull all files for this project. Skip generated assets (binary
      // images embedded as data URLs in JSX inline already, no need for
      // /generated tree noise).
      const allFiles = await db.projectFiles.findByProjectId(projectId)
      const pushable = allFiles
        .filter(f => f.path && typeof f.content === 'string')
        .filter(f => !f.path.startsWith('_generated/'))
        .filter(f => !f.path.startsWith('_uploads/'))
        .map(f => ({ path: f.path, content: f.content }))

      // Inject a minimal README + package.json if not present so the repo
      // looks meaningful when cloned.
      const hasReadme = pushable.some(f => f.path.toLowerCase() === 'readme.md')
      if (!hasReadme) {
        pushable.push({
          path: 'README.md',
          content: `# ${project.name}\n\n${project.description || 'Built with [Auroraly](https://auroraly.co) — AI website builder.'}\n\n## Generated\n\n${pushable.length} files written by Auroraly.\n\n_Last pushed: ${new Date().toISOString()}_\n`,
        })
      }

      const result = await pushProjectToGithub({
        token,
        repoName,
        isPrivate,
        description: project.description || `Built with Auroraly — ${project.name}`,
        files: pushable,
        commitMessage,
      })

      // Persist repo URL + last push timestamp so the UI can show "last
      // pushed 2 minutes ago" and pre-fill the repo name on next push.
      const newSettings = {
        ...(project.settings || {}),
        github: {
          ...(project.settings?.github || {}),
          repo_url: result.repo_url,
          html_url: result.html_url,
          last_push_at: new Date().toISOString(),
          last_commit_sha: result.commit_sha,
          repo_name: result.repo,
          owner: result.owner,
          ...(body.save_token ? { token } : {}),
        },
      }
      await db.projects.update(projectId, { settings: newSettings })

      return handleCORS(NextResponse.json({ success: true, ...result }))
    } catch (e) {
      console.error('[github/push] failed:', e.message, e.detail)
      return handleCORS(NextResponse.json({ error: e.message, detail: e.detail }, { status: 500 }))
    }
  }

  return null
}
