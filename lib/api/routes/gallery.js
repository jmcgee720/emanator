import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { randomBytes } from 'crypto'

/**
 * Gallery + publish routes. Builds on shipped infrastructure:
 *   - sharedPreviews (used for public share tokens)
 *   - projects.settings.is_public flag (new in this session)
 *
 *   GET  /gallery                       — list public projects (public endpoint)
 *   POST /projects/:id/publish          — mark project public + mint share token if needed
 *   POST /projects/:id/unpublish        — mark project private
 */
export async function handle(route, method, path, request) {

  // ── Public gallery listing ──
  if (route === '/gallery' && method === 'GET') {
    try {
      const url = new URL(request.url)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '24', 10), 60)
      const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0)

      const projects = await db.projects.findPublic({ limit, offset })

      // For each public project, look up its latest (newest) share token.
      // We store that token's id + view count in the gallery card so the
      // frontend doesn't need a second round-trip per card.
      const items = await Promise.all(projects.map(async (p) => {
        let shareToken = null
        let views = 0
        let remixCount = 0
        try {
          const shares = await db.sharedPreviews.findByProjectId(p.id)
          // Filter out expired shares
          const now = Date.now()
          const active = (shares || []).filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now)
          if (active.length > 0) {
            shareToken = active[0].share_token
            views = active[0].views || 0
          }
        } catch { /* non-critical */ }
        // Remix count: number of projects that have this project's token in settings.remixed_from.token
        // Skip for MVP — expensive query. Can add as a materialized column later.

        return {
          id: p.id,
          name: p.name,
          description: p.description || '',
          archetype: p.settings?.archetype || null,
          brand: p.settings?.brand || null,
          share_token: shareToken,
          views,
          remix_count: remixCount,
          published_at: p.settings?.published_at || p.updated_at,
        }
      }))

      // Drop cards that have no share token — they can't be previewed anyway.
      const displayable = items.filter((i) => i.share_token)

      return handleCORS(NextResponse.json({
        items: displayable,
        count: displayable.length,
        limit,
        offset,
      }, { headers: { 'Cache-Control': 'public, max-age=30' } }))
    } catch (err) {
      console.error('[Gallery] List error:', err)
      return handleCORS(NextResponse.json({ error: err.message || 'Gallery unavailable' }, { status: 500 }))
    }
  }

  // ── Publish a project to the gallery ──
  if (route.match(/^\/projects\/[^/]+\/publish$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = path[1]

    try {
      const project = await db.projects.findById(projectId)
      if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
      if (project.user_id !== dbUser.id) return handleCORS(NextResponse.json({ error: 'You do not own this project' }, { status: 403 }))

      // Require files before publish
      const files = await db.projectFiles.findByProjectId(projectId)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'Build the project first — nothing to showcase yet.' }, { status: 400 }))
      }

      // If the project has no share token yet, mint one so the gallery card
      // has something to link to. Use a never-expire token since published
      // projects are meant to live on the gallery indefinitely.
      let shareToken = null
      try {
        const existing = await db.sharedPreviews.findByProjectId(projectId)
        const active = (existing || []).filter((s) => !s.expires_at)
        if (active.length > 0) {
          shareToken = active[0].share_token
        }
      } catch { /* non-critical */ }

      if (!shareToken) {
        shareToken = randomBytes(16).toString('hex')
        const filesSnapshot = files.map((f) => ({ path: f.path, content: f.content || '', file_type: f.file_type }))
        await db.sharedPreviews.create({
          share_token: shareToken,
          project_id: projectId,
          user_id: dbUser.id,
          title: project.name,
          files_snapshot: filesSnapshot,
          views: 0,
          expires_at: null,
          created_at: new Date().toISOString(),
        })
      }

      // Flip the public flag
      const nextSettings = { ...(project.settings || {}), is_public: true, published_at: new Date().toISOString() }
      const updated = await db.projects.update(projectId, { settings: nextSettings })

      return handleCORS(NextResponse.json({
        success: true,
        project: updated,
        share_token: shareToken,
      }))
    } catch (err) {
      console.error('[Gallery] Publish error:', err)
      return handleCORS(NextResponse.json({ error: err.message || 'Publish failed' }, { status: 500 }))
    }
  }

  // ── Unpublish a project (keep the share token — just hide from gallery) ──
  if (route.match(/^\/projects\/[^/]+\/unpublish$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const projectId = path[1]

    try {
      const project = await db.projects.findById(projectId)
      if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
      if (project.user_id !== dbUser.id) return handleCORS(NextResponse.json({ error: 'You do not own this project' }, { status: 403 }))

      const nextSettings = { ...(project.settings || {}) }
      delete nextSettings.is_public
      delete nextSettings.published_at
      const updated = await db.projects.update(projectId, { settings: nextSettings })
      return handleCORS(NextResponse.json({ success: true, project: updated }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message || 'Unpublish failed' }, { status: 500 }))
    }
  }

  return null
}
