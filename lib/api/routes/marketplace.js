import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {

  // ── List all published marketplace templates ──
  if (route === '/marketplace' && method === 'GET') {
    try {
      const templates = await db.marketplaceTemplates.findAll()
      return handleCORS(NextResponse.json({ templates }))
    } catch (err) {
      console.error('[Marketplace] List error:', err)
      return handleCORS(NextResponse.json({ templates: [] }))
    }
  }

  // ── Publish a project as a marketplace template ──
  if (route === '/marketplace/publish' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    try {
      const body = await request.json()
      const { project_id, name, description, category } = body
      if (!project_id || !name) {
        return handleCORS(NextResponse.json({ error: 'project_id and name are required' }, { status: 400 }))
      }

      const files = await db.projectFiles.findByProjectId(project_id)
      if (!files || files.length === 0) {
        return handleCORS(NextResponse.json({ error: 'Project has no files to publish' }, { status: 404 }))
      }

      const filesSnapshot = files.map(f => ({ path: f.path, content: f.content || '', file_type: f.file_type }))

      const template = await db.marketplaceTemplates.create({
        project_id,
        user_id: dbUser.id,
        author_email: authUser.email,
        name: name.trim(),
        description: (description || '').trim(),
        category: category || 'General',
        files_snapshot: filesSnapshot,
        file_count: filesSnapshot.length,
        clones: 0,
      })

      return handleCORS(NextResponse.json({ template }, { status: 201 }))
    } catch (err) {
      console.error('[Marketplace] Publish error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to publish template' }, { status: 500 }))
    }
  }

  // ── Clone a marketplace template into a new project ──
  if (route.match(/^\/marketplace\/[^/]+\/clone$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    const templateId = route.split('/')[2]
    try {
      const template = await db.marketplaceTemplates.findById(templateId)
      if (!template) {
        return handleCORS(NextResponse.json({ error: 'Template not found' }, { status: 404 }))
      }

      // Create a new project from the template
      const project = await db.projects.create({
        user_id: dbUser.id,
        name: template.name,
        description: template.description || '',
        type: 'app',
        settings: { cloned_from_marketplace: templateId },
      })

      // Initialize canvas
      await db.projectCanvas.create({
        project_id: project.id,
        canvas_content: {
          project_overview: '',
          project_goals: [],
          key_decisions: [],
          architecture_notes: [],
          master_prompts: [],
          working_prompts: [],
          failed_prompts: [],
          successful_patterns: [],
          feature_requirements: [],
          technical_specs: [],
          constraints: [],
          open_tasks: [],
          completed_tasks: [],
        },
      })

      // Create initial chat
      const initialChat = await db.chats.create({
        project_id: project.id,
        title: 'New Conversation',
      })

      // Populate files from template snapshot
      const files = template.files_snapshot || []
      for (const file of files) {
        await db.projectFiles.upsert(project.id, file.path, file.content, file.file_type || 'jsx')
      }

      // Increment clone count
      await db.marketplaceTemplates.incrementClones(templateId)

      return handleCORS(NextResponse.json({ project, initialChat }, { status: 201 }))
    } catch (err) {
      console.error('[Marketplace] Clone error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to clone template' }, { status: 500 }))
    }
  }

  // ── Delete own marketplace template ──
  if (route.match(/^\/marketplace\/[^/]+$/) && method === 'DELETE') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    const templateId = route.split('/').pop()
    try {
      const deleted = await db.marketplaceTemplates.delete(templateId, dbUser.id)
      if (!deleted) return handleCORS(NextResponse.json({ error: 'Template not found or not yours' }, { status: 404 }))
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      console.error('[Marketplace] Delete error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to delete template' }, { status: 500 }))
    }
  }

  return null
}
