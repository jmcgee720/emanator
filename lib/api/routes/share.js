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

      // Increment view count (fire and forget)
      db.sharedPreviews.incrementViews(token).catch(() => {})

      return handleCORS(NextResponse.json({
        title: preview.title,
        files: preview.files_snapshot || [],
        created_at: preview.created_at,
        views: (preview.views || 0) + 1,
      }))
    } catch (err) {
      console.error('[Share] Public fetch error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to load preview' }, { status: 500 }))
    }
  }

  return null
}
