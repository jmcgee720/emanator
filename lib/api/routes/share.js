import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { randomBytes } from 'crypto'

export async function handle(route, method, path, request) {

  // ── Create a shareable preview link ──
  if (route.match(/^\/projects\/[^/]+\/share$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = route.split('/')[2]
    try {
      const files = await db.projectFiles.findByProjectId(projectId)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files to share. Build something first!' }, { status: 404 }))
      }

      const body = await request.json().catch(() => ({}))
      const { expires_in } = body // 'never', '1h', '24h', '7d', '30d'

      let expiresAt = null
      if (expires_in && expires_in !== 'never') {
        const now = new Date()
        const durations = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
        const ms = durations[expires_in]
        if (ms) expiresAt = new Date(now.getTime() + ms).toISOString()
      }

      const shareToken = randomBytes(16).toString('hex')
      const filesSnapshot = files.map(f => ({ path: f.path, content: f.content || '', file_type: f.file_type }))

      // Get project name
      let title = 'Shared Preview'
      try {
        const projects = await db.projects.findById(projectId)
        if (projects) title = projects.name || title
      } catch { /* non-critical */ }

      const preview = await db.sharedPreviews.create({
        share_token: shareToken,
        project_id: projectId,
        user_id: dbUser.id,
        title,
        files_snapshot: filesSnapshot,
        views: 0,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      })

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
      const shareUrl = `${baseUrl}/share/${shareToken}`

      return handleCORS(NextResponse.json({
        share_id: preview.id,
        share_token: shareToken,
        share_url: shareUrl,
        title,
        files_count: filesSnapshot.length,
        expires_at: expiresAt,
      }, { status: 201 }))
    } catch (err) {
      console.error('[Share] Create error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to create share link' }, { status: 500 }))
    }
  }

  // ── List shared links for a project ──
  if (route.match(/^\/projects\/[^/]+\/shares$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = route.split('/')[2]
    try {
      const shares = await db.sharedPreviews.findByProjectId(projectId)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
      const enriched = shares.map(s => ({
        ...s,
        share_url: `${baseUrl}/share/${s.share_token}`,
        is_expired: s.expires_at ? new Date(s.expires_at) < new Date() : false,
      }))
      return handleCORS(NextResponse.json({ shares: enriched }))
    } catch (err) {
      console.error('[Share] List error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to list shares' }, { status: 500 }))
    }
  }

  // ── Delete/revoke a share link ──
  if (route.match(/^\/projects\/[^/]+\/share\/[^/]+$/) && method === 'DELETE') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const parts = route.split('/')
    const projectId = parts[2]
    const shareId = parts[4]
    try {
      await db.sharedPreviews.delete(shareId, projectId)
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      console.error('[Share] Delete error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to delete share' }, { status: 500 }))
    }
  }

  // ── Public: Get shared preview data (NO AUTH REQUIRED) ──
  if (route.match(/^\/shared\/[a-zA-Z0-9_-]+$/) && method === 'GET') {
    const token = route.split('/').pop()
    try {
      const preview = await db.sharedPreviews.findByToken(token)
      if (!preview) {
        return handleCORS(NextResponse.json({ error: 'Preview not found or expired' }, { status: 404 }))
      }

      // Check expiry
      if (preview.expires_at && new Date(preview.expires_at) < new Date()) {
        return handleCORS(NextResponse.json({ error: 'This share link has expired' }, { status: 410 }))
      }

      // Increment view count (fire and forget)
      db.sharedPreviews.incrementViews(token).catch(() => {})

      return handleCORS(NextResponse.json({
        title: preview.title,
        files: preview.files_snapshot || [],
        created_at: preview.created_at,
        views: (preview.views || 0) + 1,
        expires_at: preview.expires_at || null,
      }))
    } catch (err) {
      console.error('[Share] Public fetch error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to load preview' }, { status: 500 }))
    }
  }

  // ── Remix a shared preview: clone the files into a new project for the
  // authenticated user. Gated by auth — anon users get redirected to login
  // from the UI before hitting this.
  if (route.match(/^\/shared\/[a-zA-Z0-9_-]+\/remix$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser?.email) {
      return handleCORS(NextResponse.json({ error: 'Sign in to remix this app' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    const token = route.split('/')[2]
    try {
      const preview = await db.sharedPreviews.findByToken(token)
      if (!preview) return handleCORS(NextResponse.json({ error: 'Preview not found' }, { status: 404 }))
      if (preview.expires_at && new Date(preview.expires_at) < new Date()) {
        return handleCORS(NextResponse.json({ error: 'This share link has expired' }, { status: 410 }))
      }

      // Create a new project for the remixer
      const newProject = await db.projects.create({
        user_id: dbUser.id,
        name: `Remix of ${preview.title || 'Shared app'}`,
        description: 'Remixed from a shared Auroraly build — edit freely.',
        type: 'react',
        settings: { remixed_from: { token, title: preview.title } },
      })

      // Clone the files snapshot into the new project
      if (preview.files_snapshot && preview.files_snapshot.length > 0) {
        const clonedFiles = preview.files_snapshot.map((f) => ({
          project_id: newProject.id,
          path: f.path,
          content: f.content || '',
          file_type: f.file_type || null,
          version: 1,
        }))
        await db.projectFiles.bulkInsert(clonedFiles)
      }

      // Seed an initial chat so the user can iterate right away
      let firstChat = null
      try {
        firstChat = await db.chats.create({
          project_id: newProject.id,
          user_id: dbUser.id,
          title: 'Remix',
        })
      } catch {}

      return handleCORS(NextResponse.json({
        success: true,
        project: newProject,
        chat: firstChat,
        file_count: preview.files_snapshot?.length || 0,
      }))
    } catch (err) {
      console.error('[Share] Remix error:', err)
      return handleCORS(NextResponse.json({ error: err.message || 'Remix failed' }, { status: 500 }))
    }
  }

  return null
}
