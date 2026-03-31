import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  // Get all projects for user
  if (route === '/projects' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    
    const projects = await db.projects.findByUserId(dbUser.id)
    return handleCORS(NextResponse.json(projects))
  }

  // Create project
  if (route === '/projects' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized \u2014 no auth session in cookies' }, { status: 401 }))
    }
    
    // Look up the internal user row
    let dbUser = await db.users.findByEmail(authUser.email)
    
    // Auto-create user row if it doesn't exist
    if (!dbUser) {
      const ownerEmail = process.env.DEFAULT_OWNER_EMAIL
      const isOwner = ownerEmail && authUser.email === ownerEmail
      dbUser = await db.users.create({
        email: authUser.email,
        role: isOwner ? 'owner' : 'member',
        is_allowlisted: isOwner
      })
    }
    
    if (!dbUser.is_allowlisted) {
      return handleCORS(NextResponse.json({ error: 'Access denied \u2014 not on allowlist' }, { status: 403 }))
    }
    
    const body = await request.json()
    const { name, description = '', settings = {} } = body
    const type = body.type === 'core' ? 'core' : 'app'
    
    if (!name) {
      return handleCORS(NextResponse.json({ error: 'Project name is required' }, { status: 400 }))
    }
    
    // All data writes use the service-role db client (bypasses RLS)
    try {
      const project = await db.projects.create({
        user_id: dbUser.id,
        name,
        description,
        type: type || 'app',
        settings
      })
      
      // Initialize project canvas
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
          completed_tasks: []
        }
      })
      
      // Create initial chat thread
      const initialChat = await db.chats.create({
        project_id: project.id,
        title: 'New Conversation'
      })
      
      return handleCORS(NextResponse.json({ project, initialChat }, { status: 201 }))
    } catch (insertErr) {
      console.error('[CreateProject] DB insert error:', insertErr)
      return handleCORS(NextResponse.json({ error: `Database error: ${insertErr.message}` }, { status: 500 }))
    }
  }

  // Get single project
  if (route.match(/^\/projects\/[^/]+$/) && method === 'GET') {
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
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }
    
    return handleCORS(NextResponse.json(project))
  }

  // Update project
  if (route.match(/^\/projects\/[^/]+$/) && method === 'PUT') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    
    const body = await request.json()
    const updates = {}
    if (body.name) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.type) updates.type = body.type
    if (body.settings) updates.settings = body.settings
    
    await db.projects.update(projectId, updates)
    
    return handleCORS(NextResponse.json({ success: true }))
  }

  // Delete project (with ownership check)
  if (route.match(/^\/projects\/[^/]+$/) && method === 'DELETE') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    // Verify ownership
    const project = await db.projects.findById(projectId)
    if (!project) {
      return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
    }
    if (project.user_id !== dbUser.id) {
      return handleCORS(NextResponse.json({ error: 'You can only delete your own projects' }, { status: 403 }))
    }

    // Cascade delete is handled by Supabase foreign keys (chats, messages, files, canvas, etc.)
    await db.projects.delete(projectId)
    
    return handleCORS(NextResponse.json({ success: true, deleted_project_id: projectId }))
  }

  // Bulk delete all projects for current user (account cleanup)
  if (route === '/account/cleanup' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const userProjects = await db.projects.findByUserId(dbUser.id)
    if (!userProjects || userProjects.length === 0) {
      return handleCORS(NextResponse.json({ success: true, deleted_count: 0, message: 'No projects to delete' }))
    }

    let deletedCount = 0
    const errors = []

    for (const project of userProjects) {
      try {
        await db.projects.delete(project.id)
        deletedCount++
      } catch (err) {
        errors.push({ project_id: project.id, name: project.name, error: err.message })
      }
    }

    return handleCORS(NextResponse.json({
      success: errors.length === 0,
      deleted_count: deletedCount,
      total_projects: userProjects.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Deleted ${deletedCount} of ${userProjects.length} projects and all associated data`,
    }))
  }

  return null
}
