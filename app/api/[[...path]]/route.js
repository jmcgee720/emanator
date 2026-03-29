import { NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { AIService } from '@/lib/ai/service'
import { ProviderError } from '@/lib/ai/errors'
import { SELF_EDIT_PREFIX, getChatType, getUserRole, hasPermission, VALID_ROLES, ROLES, isMonitored } from '@/lib/constants'
import { handleStreamMessage } from '@/lib/api/stream-handler'
import JSZip from 'jszip'
import { creditsDb, CREDIT_COSTS, CREDIT_PACKAGES } from '@/lib/credits/service'

// Allow larger body for file uploads (50MB)
export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } }
}

// Helper function to handle CORS
function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

// Get user from auth — tries cookies first, then bearer token fallback
async function getAuthUser(request) {
  // Strategy 1: Cookie-based SSR auth
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return user
  } catch {}

  // Strategy 2: Bearer token fallback (embedded mode / when cookies don't work)
  if (request) {
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        )
        const { data: { user } } = await supabase.auth.getUser(token)
        if (user) return user
      } catch {}
    }
  }

  return null
}

// Check if user is allowlisted, resolve effective role from DB + Supabase Auth metadata
async function checkAllowlist(email) {
  const ownerEmail = process.env.DEFAULT_OWNER_EMAIL

if (ownerEmail && email && email.toLowerCase() === ownerEmail.toLowerCase()) {
  // Ensure owner exists in DB and has a valid UUID
  let owner = await db.users.findByEmail(email)

  if (!owner) {
    owner = await db.users.create({
      email,
      role: 'owner',
      is_allowlisted: true
    })
  }

  return owner
}

  const user = await db.users.findByEmail(email)
  if (!user?.is_allowlisted) return null

  if (user.role === 'owner') return user

  try {
    const supabase = getSupabaseAdmin()
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const authUser = authUsers?.find((u) => u.email === email)
    const metaRole = authUser?.user_metadata?.app_role

    if (metaRole === 'admin' || metaRole === 'child_monitored') {
      return { ...user, role: metaRole }
    }
  } catch (error) {
  }

  return user
}

// Initialize default owner
async function initializeOwner() {
  const ownerEmail = process.env.DEFAULT_OWNER_EMAIL
  if (!ownerEmail || ownerEmail === 'YOUR_EMAIL') return
  
  try {
    const existing = await db.users.findByEmail(ownerEmail)
    if (!existing) {
      await db.users.create({
        email: ownerEmail,
        role: 'owner',
        is_allowlisted: true
      })
    }
  } catch (error) {
    // Ignore if already exists or table doesn't exist yet
    console.log('Owner initialization:', error.message)
  }
}

// OPTIONS handler for CORS
export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

// Route handler function
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    await initializeOwner()

    // Public routes
    if (route === '/' && method === 'GET') {
      return handleCORS(NextResponse.json({ message: 'MyMergent API v2.0 (Supabase)' }))
    }

    if (route === '/health' && method === 'GET') {
      return handleCORS(NextResponse.json({ 
        status: 'healthy', 
        database: 'supabase',
        timestamp: new Date().toISOString() 
      }))
    }

    // Provider status check
    if (route === '/providers/status' && method === 'GET') {
      const results = {}
      
      // Check OpenAI
      const openaiKey = process.env.OPENAI_API_KEY
      if (openaiKey) {
        try {
          const { default: OpenAI } = await import('openai')
          const client = new OpenAI({ apiKey: openaiKey })
          await client.models.list()
          results.openai = { status: 'ready' }
        } catch (err) {
          const msg = (err?.message || '').toLowerCase()
          const status = err?.status || err?.statusCode || null
          if (status === 401 || msg.includes('invalid') || msg.includes('api key')) {
            results.openai = { status: 'auth_issue', detail: 'Invalid or revoked API key' }
          } else if (status === 402 || msg.includes('billing') || msg.includes('quota') || msg.includes('credit')) {
            results.openai = { status: 'billing_issue', detail: 'Insufficient billing/credits' }
          } else {
            results.openai = { status: 'unavailable', detail: err.message }
          }
        }
      } else {
        results.openai = { status: 'no_key', detail: 'API key not configured' }
      }
      
      // Check Anthropic
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      if (anthropicKey) {
        try {
          const { default: Anthropic } = await import('@anthropic-ai/sdk')
          const client = new Anthropic({ apiKey: anthropicKey })
          // Lightweight check: send a tiny message
          await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }]
          })
          results.anthropic = { status: 'ready' }
        } catch (err) {
          const msg = (err?.message || '').toLowerCase()
          const status = err?.status || err?.statusCode || null
          if (status === 402 || msg.includes('billing') || msg.includes('credit') || msg.includes('insufficient') || msg.includes('balance is too low')) {
            results.anthropic = { status: 'billing_issue', detail: 'Insufficient billing/credits' }
          } else if (status === 401 || msg.includes('invalid api key') || msg.includes('invalid x-api-key') || msg.includes('authentication')) {
            results.anthropic = { status: 'auth_issue', detail: 'Invalid or revoked API key' }
          } else if (status === 429 || msg.includes('rate')) {
            // Rate limit during status check = provider is actually working
            results.anthropic = { status: 'ready' }
          } else {
            results.anthropic = { status: 'unavailable', detail: err.message }
          }
        }
      } else {
        results.anthropic = { status: 'no_key', detail: 'API key not configured' }
      }
      
      return handleCORS(NextResponse.json(results))
    }

    // Auth check route
    if (route === '/auth/check' && method === 'POST') {
      const body = await request.json()
      const { email, provider } = body
      
      if (!email) {
        return handleCORS(NextResponse.json({ error: 'Email required' }, { status: 400 }))
      }
      
      let user = await checkAllowlist(email)

      // Auto-create user for OAuth providers (Google, etc.)
      if (!user && provider === 'google') {
        user = await db.users.create({
          email,
          role: 'user',
          is_allowlisted: true,
        })
      }

      if (!user) {
        return handleCORS(NextResponse.json({ 
          allowed: false, 
          message: 'Access denied. Contact owner for approval.' 
        }, { status: 403 }))
      }
      
      return handleCORS(NextResponse.json({ 
        allowed: true, 
        user: { id: user.id, email: user.email, role: getUserRole(user) }
      }))
    }

    // ============ ADMIN ROUTES ============
    
    // Get all users (owner or admin)
    if (route === '/admin/users' && method === 'GET') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const currentUser = await db.users.findByEmail(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'view_admin')) {
        return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
      }
      
      const users = await db.users.findAll()
      
      // Enrich with effective roles + last_seen from Supabase Auth metadata
      try {
        const adminSupabase = getSupabaseAdmin()
        const { data: { users: authUsers } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
        const metaMap = new Map()
        const lastSeenMap = new Map()
        for (const au of (authUsers || [])) {
          if (au.user_metadata?.app_role) metaMap.set(au.email, au.user_metadata.app_role)
          if (au.last_sign_in_at) lastSeenMap.set(au.email, au.last_sign_in_at)
        }
        const enriched = users.map(u => {
          const last_seen = lastSeenMap.get(u.email) || null
          if (u.role === 'owner') return { ...u, last_seen }
          const metaRole = metaMap.get(u.email)
          if (metaRole === 'admin' || metaRole === 'child_monitored') {
            return { ...u, role: metaRole, last_seen }
          }
          return { ...u, last_seen }
        })
        return handleCORS(NextResponse.json(enriched))
      } catch {
        return handleCORS(NextResponse.json(users))
      }
    }

    // Add user to allowlist (owner only — manage_users permission)
    if (route === '/admin/users' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const currentUser = await db.users.findByEmail(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
        return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
      }
      
      const body = await request.json()
      const { email, role = 'member' } = body
      
      if (!email) {
        return handleCORS(NextResponse.json({ error: 'Email required' }, { status: 400 }))
      }
      
      const existing = await db.users.findByEmail(email)
      if (existing) {
        return handleCORS(NextResponse.json({ error: 'User already exists' }, { status: 400 }))
      }
      
      // DB constraint only allows 'owner'/'member'. Store admin/child_monitored in Supabase Auth metadata.
      const effectiveRole = VALID_ROLES.has(role) ? role : ROLES.MEMBER
      const dbRole = (effectiveRole === ROLES.ADMIN || effectiveRole === ROLES.CHILD_MONITORED) ? ROLES.MEMBER : effectiveRole
      
      const newUser = await db.users.create({
        email,
        role: dbRole,
        invited_by: currentUser.id,
        is_allowlisted: true
      })
      
      // If admin or child_monitored, store in Supabase Auth user_metadata
      if (effectiveRole === ROLES.ADMIN || effectiveRole === ROLES.CHILD_MONITORED) {
        try {
          const adminSupabase = getSupabaseAdmin()
          const { data: { users: authUsers } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
          const authUser = authUsers?.find(u => u.email === email)
          if (authUser) {
            await adminSupabase.auth.admin.updateUserById(authUser.id, {
              user_metadata: { ...authUser.user_metadata, app_role: effectiveRole }
            })
          } else {
            await adminSupabase.auth.admin.createUser({
              email,
              email_confirm: false,
              user_metadata: { app_role: effectiveRole }
            })
          }
        } catch {}
      }
      
      return handleCORS(NextResponse.json({ ...newUser, role: effectiveRole }, { status: 201 }))
    }

    // Update user role (owner only — manage_users permission)
    if (route.startsWith('/admin/users/') && method === 'PUT') {
      const userId = path[2]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const currentUser = await db.users.findByEmail(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
        return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
      }
      
      const body = await request.json()
      const { role } = body
      
      // DB constraint only allows 'owner'/'member'. Store admin/child_monitored in Supabase Auth metadata.
      const effectiveRole = VALID_ROLES.has(role) ? role : ROLES.MEMBER
      const dbRole = (effectiveRole === ROLES.ADMIN || effectiveRole === ROLES.CHILD_MONITORED) ? ROLES.MEMBER : effectiveRole
      
      await db.users.update(userId, { role: dbRole })
      
      // Sync role to Supabase Auth metadata
      try {
        const targetUser = await db.users.findById(userId)
        if (targetUser?.email) {
          const adminSupabase = getSupabaseAdmin()
          const { data: { users: authUsers } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
          const authUser = authUsers?.find(u => u.email === targetUser.email)
          if (authUser) {
            const metaRole = (effectiveRole === ROLES.ADMIN || effectiveRole === ROLES.CHILD_MONITORED) ? effectiveRole : null
            await adminSupabase.auth.admin.updateUserById(authUser.id, {
              user_metadata: { ...authUser.user_metadata, app_role: metaRole }
            })
          }
        }
      } catch {}
      
      // Log role change to changelog for activity feed
      const allProjects = await db.projects.findByUserId(currentUser.id)
      const firstProjectId = allProjects?.[0]?.id
      if (firstProjectId) {
        db.changelog.create({
          project_id: firstProjectId,
          user_id: currentUser.id,
          user_task: `Role changed for user ${userId}: → ${effectiveRole}`,
          task_mode: 'role_change',
          plan_summary: `Role → ${effectiveRole}`,
        }).catch(e => console.warn('[changelog] role_change write failed:', e.message))
      }

      return handleCORS(NextResponse.json({ success: true, role: effectiveRole }))
    }

    // Remove user from allowlist (owner only — manage_users permission)
    if (route.startsWith('/admin/users/') && method === 'DELETE') {
      const userId = path[2]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const currentUser = await db.users.findByEmail(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'manage_users')) {
        return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
      }
      
      // Prevent self-deletion
      if (userId === currentUser.id) {
        return handleCORS(NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 }))
      }
      
      await db.users.delete(userId)
      
      return handleCORS(NextResponse.json({ success: true }))
    }

    // ============ PROJECT ROUTES ============
    
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
        return handleCORS(NextResponse.json({ error: 'Unauthorized — no auth session in cookies' }, { status: 401 }))
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
        return handleCORS(NextResponse.json({ error: 'Access denied — not on allowlist' }, { status: 403 }))
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

    // ============ SANDBOX / WORKSPACE CLONE ============

    // Create sandbox from project
    if (route.match(/^\/projects\/[^/]+\/sandbox$/) && method === 'POST') {
      const sourceId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      const source = await db.projects.findById(sourceId)
      if (!source || source.user_id !== dbUser.id) {
        return handleCORS(NextResponse.json({ error: 'Source project not found' }, { status: 404 }))
      }

      // Create sandbox project
      const sandbox = await db.projects.create({
        user_id: dbUser.id,
        name: `${source.name} [sandbox]`,
        description: source.description || '',
        type: source.type || 'app',
        settings: {
          is_sandbox: true,
          sandbox_source_id: sourceId,
          sandbox_status: 'active',
          sandbox_created_by: dbUser.email,
        }
      })

      // Clone project files
      const sourceFiles = await db.projectFiles.findByProjectId(sourceId)
      if (sourceFiles.length > 0) {
        const cloned = sourceFiles.map(f => ({
          project_id: sandbox.id,
          path: f.path,
          content: f.content,
          file_type: f.file_type || 'text',
          version: 1,
        }))
        await db.projectFiles.bulkInsert(cloned)
      }

      // Create initial chat
      const chat = await db.chats.create({
        project_id: sandbox.id,
        title: 'Sandbox Chat'
      })

      // Log to changelog
      db.changelog.create({
        project_id: sandbox.id,
        user_id: dbUser.id,
        user_task: `Sandbox created from "${source.name}"`,
        task_mode: 'sandbox_create',
        plan_summary: `Source: ${sourceId}`,
      }).catch(e => console.warn('[changelog] sandbox_create write failed:', e.message))

      return handleCORS(NextResponse.json({ project: sandbox, initialChat: chat }, { status: 201 }))
    }

    // Sandbox diff — compare sandbox files vs source primary (read-only)
    if (route.match(/^\/projects\/[^/]+\/sandbox-diff$/) && method === 'GET') {
      const sandboxId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
      }

      const sandbox = await db.projects.findById(sandboxId)
      if (!sandbox || sandbox.user_id !== dbUser.id) {
        return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
      }
      const settings = sandbox.settings || {}
      if (!settings.is_sandbox) {
        return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
      }

      const sourceId = settings.sandbox_source_id
      const [sandboxFiles, sourceFiles] = await Promise.all([
        db.projectFiles.findByProjectId(sandboxId),
        db.projectFiles.findByProjectId(sourceId),
      ])

      const sourceMap = new Map(sourceFiles.map(f => [f.path, f]))
      const sandboxMap = new Map(sandboxFiles.map(f => [f.path, f]))
      const allPaths = new Set([...sourceMap.keys(), ...sandboxMap.keys()])

      const changes = []
      for (const p of allPaths) {
        const src = sourceMap.get(p)
        const sbx = sandboxMap.get(p)

        if (sbx && !src) {
          // created in sandbox
          const lines = (sbx.content || '').split('\n').length
          changes.push({ path: p, status: 'create', lines_added: lines, lines_removed: 0 })
        } else if (src && !sbx) {
          // deleted in sandbox
          const lines = (src.content || '').split('\n').length
          changes.push({ path: p, status: 'delete', lines_added: 0, lines_removed: lines })
        } else if (src && sbx && src.content !== sbx.content) {
          // modified
          const srcLines = (src.content || '').split('\n')
          const sbxLines = (sbx.content || '').split('\n')
          // Simple line-level diff count
          const srcSet = new Set(srcLines)
          const sbxSet = new Set(sbxLines)
          let added = 0, removed = 0
          for (const l of sbxLines) { if (!srcSet.has(l)) added++ }
          for (const l of srcLines) { if (!sbxSet.has(l)) removed++ }
          changes.push({ path: p, status: 'update', lines_added: added, lines_removed: removed })
        }
        // else: identical — skip
      }

      changes.sort((a, b) => {
        const order = { delete: 0, update: 1, create: 2 }
        return (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.path.localeCompare(b.path)
      })

      return handleCORS(NextResponse.json({
        sandbox_id: sandboxId,
        source_id: sourceId,
        total_changes: changes.length,
        summary: {
          created: changes.filter(c => c.status === 'create').length,
          updated: changes.filter(c => c.status === 'update').length,
          deleted: changes.filter(c => c.status === 'delete').length,
        },
        changes,
      }))
    }

    // Test-before-apply validation gate (sandbox only)
    if (route.match(/^\/projects\/[^/]+\/test-before-apply$/) && method === 'POST') {
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

      const settings = project.settings || {}
      const checks = []
      const errors = []

      // 1. Sandbox status check
      if (!settings.is_sandbox) {
        errors.push({ check: 'sandbox_status', message: 'Not a sandbox project' })
      } else if (settings.sandbox_status !== 'active') {
        errors.push({ check: 'sandbox_status', message: `Sandbox status is "${settings.sandbox_status}", expected "active"` })
      }
      checks.push({ name: 'sandbox_status', passed: errors.length === 0 })

      // 2. Parse request body for diffs
      let diffs = []
      try {
        const body = await request.json()
        diffs = body.diffs || []
      } catch {}

      // 3. Diff existence check
      const hasDiffs = diffs.length > 0
      checks.push({ name: 'diff_exists', passed: hasDiffs })
      if (!hasDiffs) {
        errors.push({ check: 'diff_exists', message: 'No pending diffs to validate' })
      }

      // 4. Syntax validation per file
      let syntaxPassed = true
      for (const file of diffs) {
        const filePath = file.path || file.filename || ''
        const content = file.content || file.newContent || ''

        if (!content.trim()) {
          errors.push({ check: 'syntax', file: filePath, message: 'Empty file content' })
          syntaxPassed = false
          continue
        }

        // JSON parse check
        if (filePath.endsWith('.json')) {
          try {
            JSON.parse(content)
          } catch (e) {
            errors.push({ check: 'syntax', file: filePath, message: `Invalid JSON: ${e.message}` })
            syntaxPassed = false
          }
          continue
        }

        // JS/JSX/TS/TSX brace balance check
        if (/\.(js|jsx|ts|tsx|mjs)$/.test(filePath)) {
          let braces = 0, parens = 0, brackets = 0
          let inString = false, stringChar = ''
          for (let i = 0; i < content.length; i++) {
            const c = content[i]
            if (inString) {
              if (c === stringChar && content[i - 1] !== '\\') inString = false
              continue
            }
            if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue }
            if (c === '{') braces++
            else if (c === '}') braces--
            else if (c === '(') parens++
            else if (c === ')') parens--
            else if (c === '[') brackets++
            else if (c === ']') brackets--
          }
          if (braces !== 0) {
            errors.push({ check: 'syntax', file: filePath, message: `Unbalanced braces (${braces > 0 ? 'missing }' : 'extra }'})` })
            syntaxPassed = false
          }
          if (parens !== 0) {
            errors.push({ check: 'syntax', file: filePath, message: `Unbalanced parentheses (${parens > 0 ? 'missing )' : 'extra )'})` })
            syntaxPassed = false
          }
          if (brackets !== 0) {
            errors.push({ check: 'syntax', file: filePath, message: `Unbalanced brackets (${brackets > 0 ? 'missing ]' : 'extra ]'})` })
            syntaxPassed = false
          }
        }
      }
      checks.push({ name: 'syntax', passed: syntaxPassed })

      // 5. Import resolution check — verify imports reference existing project files
      let importsPassed = true
      const projectFiles = await db.projectFiles.findByProjectId(projectId)
      const existingPaths = new Set(projectFiles.map(f => f.path))
      // Also add the diff files themselves as "will exist"
      for (const file of diffs) {
        existingPaths.add(file.path || file.filename || '')
      }

      for (const file of diffs) {
        const filePath = file.path || file.filename || ''
        const content = file.content || file.newContent || ''
        if (!/\.(js|jsx|ts|tsx|mjs)$/.test(filePath)) continue

        const importMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)
        for (const match of importMatches) {
          const imp = match[1]
          // Skip node_modules / package imports
          if (!imp.startsWith('.') && !imp.startsWith('/') && !imp.startsWith('@/')) continue
          // Resolve @/ alias
          let resolved = imp
          if (imp.startsWith('@/')) {
            resolved = imp.replace('@/', '')
          } else if (imp.startsWith('./') || imp.startsWith('../')) {
            // Relative imports — skip detailed resolution, just check it's not obviously broken
            continue
          }
          // Check common extensions
          const candidates = [resolved, `${resolved}.js`, `${resolved}.jsx`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.js`, `${resolved}/index.jsx`]
          const found = candidates.some(c => existingPaths.has(c))
          if (!found && !resolved.includes('node_modules')) {
            // Not an error, just a warning — the file might be in node_modules
          }
        }
      }
      checks.push({ name: 'imports', passed: importsPassed })

      const passed = errors.length === 0
      const timestamp = new Date().toISOString()
      const result = { passed, errors, checks, timestamp, files_tested: diffs.length }

      // Store result in sandbox settings
      try {
        await db.projects.update(projectId, {
          settings: { ...settings, last_test_result: result }
        })
      } catch {}

      return handleCORS(NextResponse.json(result))
    }

    // Promote sandbox → primary (owner only)
    if (route.match(/^\/projects\/[^/]+\/promote$/) && method === 'POST') {
      const sandboxId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
      }

      const sandbox = await db.projects.findById(sandboxId)
      if (!sandbox || sandbox.user_id !== dbUser.id) {
        return handleCORS(NextResponse.json({ error: 'Sandbox not found' }, { status: 404 }))
      }

      const settings = sandbox.settings || {}

      // Precondition: must be a sandbox
      if (!settings.is_sandbox) {
        return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
      }

      // Precondition: must be active
      if (settings.sandbox_status !== 'active') {
        return handleCORS(NextResponse.json({ error: `Sandbox status is "${settings.sandbox_status}", must be "active"` }, { status: 400 }))
      }

      // Precondition: last test must have passed
      const lastTest = settings.last_test_result
      if (!lastTest || !lastTest.passed) {
        return handleCORS(NextResponse.json({ error: 'Last test must pass before promotion. Run "Test Changes" first.' }, { status: 400 }))
      }

      // Precondition: sandbox must have files
      const sandboxFiles = await db.projectFiles.findByProjectId(sandboxId)
      if (sandboxFiles.length === 0) {
        return handleCORS(NextResponse.json({ error: 'Sandbox has no files to promote' }, { status: 400 }))
      }

      const sourceId = settings.sandbox_source_id
      const source = await db.projects.findById(sourceId)
      if (!source) {
        return handleCORS(NextResponse.json({ error: 'Source project no longer exists' }, { status: 404 }))
      }

      // Apply sandbox file state to source project:
      // 0. Capture pre-promotion snapshot of primary files
      const primaryFiles = await db.projectFiles.findByProjectId(sourceId)
      const primaryMap = new Map(primaryFiles.map(f => [f.path, f]))
      const sandboxPathSet = new Set(sandboxFiles.map(f => f.path))

      const snapshot = []
      // Files that existed in primary (will be overwritten or deleted)
      for (const f of primaryFiles) {
        snapshot.push({ path: f.path, previous_content: f.content, existed_before: true })
      }
      // Files that only exist in sandbox (newly created — rollback should delete them)
      for (const f of sandboxFiles) {
        if (!primaryMap.has(f.path)) {
          snapshot.push({ path: f.path, previous_content: null, existed_before: false })
        }
      }

      // 1. Delete all current source files
      await db.projectFiles.deleteByProjectId(sourceId)

      // 2. Copy sandbox files into source
      const promoted = sandboxFiles.map(f => ({
        project_id: sourceId,
        path: f.path,
        content: f.content,
        file_type: f.file_type || 'text',
        version: (f.version || 1) + 1,
      }))
      await db.projectFiles.bulkInsert(promoted)

      // 3. Mark sandbox as promoted (remains as snapshot)
      const now = new Date().toISOString()
      await db.projects.update(sandboxId, {
        settings: { ...settings, sandbox_status: 'promoted', promoted_at: now }
      })

      // 4. Log promotion event with snapshot in file_actions
      db.changelog.create({
        project_id: sourceId,
        user_id: dbUser.id,
        user_task: `Sandbox promoted to primary: ${sandbox.name}`,
        task_mode: 'sandbox_promote',
        plan_summary: `Source sandbox: ${sandboxId} → Target: ${sourceId} | ${sandboxFiles.length} file(s)`,
        file_actions: { snapshot, sandbox_id: sandboxId },
      }).catch(e => console.warn('[changelog] sandbox_promote write failed:', e.message))

      return handleCORS(NextResponse.json({
        success: true,
        files_promoted: sandboxFiles.length,
        source_project_id: sourceId,
        sandbox_status: 'promoted',
        promoted_at: now,
      }))
    }

    // Rollback a promoted sandbox — restore primary to pre-promotion state
    if (route.match(/^\/projects\/[^/]+\/rollback$/) && method === 'POST') {
      const sandboxId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
      }

      const sandbox = await db.projects.findById(sandboxId)
      if (!sandbox || sandbox.user_id !== dbUser.id) {
        return handleCORS(NextResponse.json({ error: 'Sandbox not found' }, { status: 404 }))
      }
      const settings = sandbox.settings || {}
      if (!settings.is_sandbox) {
        return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
      }
      if (settings.sandbox_status !== 'promoted') {
        return handleCORS(NextResponse.json({ error: 'Sandbox has not been promoted' }, { status: 400 }))
      }

      const sourceId = settings.sandbox_source_id

      // Find the promotion changelog entry with snapshot
      const supabase = getSupabaseAdmin()
      const { data: entries } = await supabase
        .from('changelog')
        .select('*')
        .eq('project_id', sourceId)
        .eq('task_mode', 'sandbox_promote')
        .order('created_at', { ascending: false })
        .limit(5)

      const entry = (entries || []).find(e => {
        const fa = e.file_actions
        return fa && fa.sandbox_id === sandboxId && Array.isArray(fa.snapshot)
      })

      if (!entry) {
        return handleCORS(NextResponse.json({ error: 'No promotion snapshot found for rollback' }, { status: 404 }))
      }

      const snapshot = entry.file_actions.snapshot

      // Delete all current primary files
      await db.projectFiles.deleteByProjectId(sourceId)

      // Restore files that existed before
      const toRestore = snapshot.filter(f => f.existed_before && f.previous_content != null)
      if (toRestore.length > 0) {
        await db.projectFiles.bulkInsert(toRestore.map(f => ({
          project_id: sourceId,
          path: f.path,
          content: f.previous_content,
          file_type: 'text',
          version: 1,
        })))
      }
      // Files with existed_before === false are simply not restored (effectively deleted)

      // Mark sandbox as rolled back
      const now = new Date().toISOString()
      await db.projects.update(sandboxId, {
        settings: { ...settings, sandbox_status: 'rolled_back', rolled_back_at: now }
      })

      // Log rollback event
      db.changelog.create({
        project_id: sourceId,
        user_id: dbUser.id,
        user_task: `Rollback: restored primary from pre-promotion snapshot`,
        task_mode: 'sandbox_rollback',
        plan_summary: `Sandbox: ${sandboxId} | Restored ${toRestore.length} file(s), removed ${snapshot.filter(f => !f.existed_before).length} sandbox-only file(s)`,
      }).catch(e => console.warn('[changelog] sandbox_rollback write failed:', e.message))

      return handleCORS(NextResponse.json({
        success: true,
        files_restored: toRestore.length,
        files_removed: snapshot.filter(f => !f.existed_before).length,
        sandbox_status: 'rolled_back',
        rolled_back_at: now,
      }))
    }

    // ============ CHAT ROUTES ============
    
    // Get chats for project
    if (route.match(/^\/projects\/[^/]+\/chats$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }
      
      const chats = await db.chats.findByProjectId(projectId)
      // Derive chat_type from title convention
      const enriched = chats.map(c => ({ ...c, chat_type: getChatType(c) }))
      return handleCORS(NextResponse.json(enriched))
    }

    // Create chat
    if (route.match(/^\/projects\/[^/]+\/chats$/) && method === 'POST') {
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
      const { title = 'New Chat', is_self_edit = false } = body

      // Core System Boundary: self-edit chats require both explicit flag AND owner permission
      const titleLooksSelfEdit = title.startsWith(SELF_EDIT_PREFIX)
      if (titleLooksSelfEdit || is_self_edit) {
        if (!hasPermission(getUserRole(dbUser), 'self_edit')) {
          return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
        }
      }

      // Store self-edit chats with prefix so getChatType() can classify them correctly
      let finalTitle = title
      if (is_self_edit && !titleLooksSelfEdit) {
        finalTitle = `${SELF_EDIT_PREFIX}${title}`.trim()
      } else if (titleLooksSelfEdit && !is_self_edit) {
        finalTitle = title.replace(SELF_EDIT_PREFIX, '').trim() || 'New Chat'
      }
      
      const chat = await db.chats.create({
        project_id: projectId,
        title: finalTitle
      })

      // Log self-edit chat creation to changelog for activity feed
      if (finalTitle.startsWith(SELF_EDIT_PREFIX)) {
        db.changelog.create({
          project_id: projectId,
          chat_id: chat.id,
          user_id: dbUser.id,
          user_task: `Self-edit chat created: ${title}`,
          task_mode: 'self_edit_chat',
          plan_summary: title,
        }).catch(e => console.warn('[changelog] self_edit_chat write failed:', e.message))
      }
      
      // Derive chat_type from title
      return handleCORS(NextResponse.json({ ...chat, chat_type: getChatType(chat) }, { status: 201 }))
    }

    // Get messages for chat
    if (route.match(/^\/chats\/[^/]+\/messages$/) && method === 'GET') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      // Core System Boundary: non-owner cannot view self-edit chat messages
      const chat = await db.chats.findById(chatId)
      if (chat?.title?.startsWith(SELF_EDIT_PREFIX)) {
        const dbUser = await checkAllowlist(authUser.email)
        if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
          return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
        }
      }
      
      const messages = await db.messages.findByChatId(chatId)
      // Strip imageData from generatedImage metadata (loaded on-demand via asset-content API)
      const sanitized = messages.map(m => {
        if (m.metadata?.generatedImage?.imageData) {
          return {
            ...m,
            metadata: {
              ...m.metadata,
              generatedImage: { ...m.metadata.generatedImage, imageData: undefined }
            }
          }
        }
        return m
      })
      return handleCORS(NextResponse.json(sanitized))
    }

    // Update message metadata (e.g., after image generation completes)
    if (route.match(/^\/messages\/[^/]+\/metadata$/) && method === 'PATCH') {
      const messageId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      try {
        const body = await request.json()
        const existing = await db.messages.findById(messageId)
        if (!existing) {
          return handleCORS(NextResponse.json({ error: 'Message not found' }, { status: 404 }))
        }
        const updatedMeta = { ...(existing.metadata || {}), ...body }
        await db.messages.update(messageId, { metadata: updatedMeta })
        return handleCORS(NextResponse.json({ success: true }))
      } catch (err) {
        console.error('[Messages] Metadata update error:', err)
        return handleCORS(NextResponse.json({ error: 'Failed to update metadata' }, { status: 500 }))
      }
    }


    // ============ STREAMING MESSAGE ENDPOINT ============
    if (route.match(/^\/chats\/[^/]+\/messages\/stream$/) && method === 'POST') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }
      return handleStreamMessage(request, { chatId, authUser, dbUser, db })
    }

    // Send message (with AI response) — non-streaming fallback
    if (route.match(/^\/chats\/[^/]+\/messages$/) && method === 'POST') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const body = await request.json()
      const { content, role = 'user', metadata = {} } = body
      
      if (!content) {
        return handleCORS(NextResponse.json({ error: 'Content required' }, { status: 400 }))
      }
      
      // Get the chat to find project_id
      const chat = await db.chats.findById(chatId)
      if (!chat) {
        return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
      }
      
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      // Block child_monitored from self-edit chats
      if (isMonitored(getUserRole(dbUser)) && chat.title?.startsWith(SELF_EDIT_PREFIX)) {
        return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
      }

      // Core System Boundary: only owner can post in self-edit chats
      if (chat.title?.startsWith(SELF_EDIT_PREFIX) && !hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
      }
      
      // Create user message
      const userMessage = await db.messages.create({
        chat_id: chatId,
        project_id: chat.project_id,
        role,
        content,
        metadata
      })
      
      // Update chat timestamp
      await db.chats.update(chatId, { updated_at: new Date().toISOString() })

      // Capture monitored-user prompt for review
      if (role === 'user' && isMonitored(getUserRole(dbUser))) {
        const promptSummary = content.length > 200 ? content.slice(0, 200) + '…' : content
        db.changelog.create({
          project_id: chat.project_id,
          chat_id: chatId,
          user_id: dbUser.id,
          user_task: promptSummary,
          task_mode: 'monitored_prompt',
          plan_summary: `Monitored prompt in chat: ${chat.title || chatId}`,
        }).catch(e => console.warn('[changelog] monitored_prompt write failed:', e.message))
      }
      
      // If user message, generate AI response
      if (role === 'user') {
        try {
          // Read provider/model from chat settings, project settings, or request
          const project = await db.projects.findById(chat.project_id)
          const providerName = metadata.provider || project?.settings?.provider || 'openai'
          const modelName = metadata.model || project?.settings?.model || null

          // Initialize AI service with provider routing
          const aiService = new AIService(providerName, modelName)
          
          // Process message and get AI response
          const aiResult = await aiService.processMessage({
            projectId: chat.project_id,
            chatId: chatId,
            userMessage: content,
            userId: dbUser.id,
            scope: metadata.scope || undefined
          })
          
          // Create assistant message
          const assistantMessage = await db.messages.create({
            chat_id: chatId,
            project_id: chat.project_id,
            role: 'assistant',
            content: aiResult.content,
            metadata: {
              toolMode: aiResult.toolMode,
              scope: aiResult.scope,
              intent: aiResult.intent,
              runId: aiResult.runId,
              filesGenerated: aiResult.files?.length || 0,
              provider: aiResult.provider,
              model: aiResult.model,
              canvasUpdated: aiResult.canvasUpdated,
              filesVerified: aiResult.filesVerified,
              fsStats: aiResult.fsStats
            }
          })
          
          return handleCORS(NextResponse.json({
            userMessage,
            assistantMessage,
            generatedFiles: aiResult.files || [],
            plan: aiResult.plan,
            canvasUpdated: aiResult.canvasUpdated,
            scope: aiResult.scope,
            intent: aiResult.intent
          }, { status: 201 }))
          
        } catch (aiError) {
          console.error('AI generation error:', aiError)
          
          const isProviderError = aiError instanceof ProviderError || aiError.name === 'ProviderError'
          
          // Build user-facing message (never dump raw JSON/error objects)
          const userFacingContent = isProviderError
            ? aiError.user_message
            : `I encountered an error while processing your request. Please try again or rephrase your request.`
          
          // Build rich metadata for frontend rendering & logs
          const errorMeta = {
            error: true,
            providerError: isProviderError,
            error_type: isProviderError ? aiError.error_type : 'unknown',
            provider: isProviderError ? aiError.provider : (metadata.provider || 'unknown'),
            model: isProviderError ? aiError.model : (metadata.model || 'unknown'),
            provider_status_code: isProviderError ? aiError.status_code : null,
            raw_error: isProviderError ? aiError.raw_error : aiError.message,
            user_message: userFacingContent,
          }
          
          const errorMessage = await db.messages.create({
            chat_id: chatId,
            project_id: chat.project_id,
            role: 'assistant',
            content: userFacingContent,
            metadata: errorMeta
          })
          
          return handleCORS(NextResponse.json({
            userMessage,
            assistantMessage: errorMessage,
            providerError: isProviderError ? {
              error_type: aiError.error_type,
              provider: aiError.provider,
              model: aiError.model,
              status_code: aiError.status_code,
              user_message: userFacingContent,
            } : null,
            error: userFacingContent
          }, { status: 201 }))
        }
      }
      
      return handleCORS(NextResponse.json(userMessage, { status: 201 }))
    }

    // Delete chat
    if (route.match(/^\/chats\/[^/]+$/) && method === 'DELETE') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      // Cascade delete handled by foreign keys
      await db.chats.delete(chatId)
      
      return handleCORS(NextResponse.json({ success: true }))
    }

    // ============ SESSION FORKING ============

    // Fork a chat — compress history into a new chat with a single synthetic message
    if (route.match(/^\/chats\/[^/]+\/fork$/) && method === 'POST') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        // 1. Fetch source chat
        const sourceChat = await db.chats.findById(chatId)
        if (!sourceChat) {
          return handleCORS(NextResponse.json({ error: 'Source chat not found' }, { status: 404 }))
        }

        // 2. Fetch all messages from source chat
        const messages = await db.messages.findByChatId(chatId)

        // 3. Compress the history
        const aiService = new AIService()
        const compressed = aiService.compressContext(messages)
        const summaryText = compressed.length > 0 && compressed[0].role === 'system'
          ? compressed[0].content
          : `[Forked from chat "${sourceChat.title}" with ${messages.length} messages]`

        // 4. Extract latest plan/diff metadata from the most recent assistant message
        let latestMeta = {}
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m.role === 'assistant' && m.metadata) {
            const { proposedPlan, diffStatus, diffFiles, planData, planId } = m.metadata
            if (proposedPlan || diffFiles || planData) {
              latestMeta = { proposedPlan, diffStatus, diffFiles, planData, planId }
              break
            }
          }
        }

        // 5. Create the new forked chat
        const forkedChat = await db.chats.create({
          project_id: sourceChat.project_id,
          title: `Fork of: ${sourceChat.title}`
        })

        // 6. Seed with a single synthetic message containing the summary + metadata
        await db.messages.create({
          chat_id: forkedChat.id,
          project_id: sourceChat.project_id,
          role: 'system',
          content: summaryText,
          metadata: {
            forked_from: chatId,
            original_message_count: messages.length,
            ...latestMeta
          }
        })

        return handleCORS(NextResponse.json({
          id: forkedChat.id,
          title: forkedChat.title,
          project_id: forkedChat.project_id,
          forked_from: chatId,
          original_message_count: messages.length
        }, { status: 201 }))
      } catch (err) {
        console.error('[Fork] Error forking chat:', err)
        return handleCORS(NextResponse.json({ error: 'Failed to fork chat' }, { status: 500 }))
      }
    }

    // ============ PROJECT FILES ROUTES ============
    
    // Get files for project
    if (route.match(/^\/projects\/[^/]+\/files$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const files = await db.projectFiles.findByProjectId(projectId)
      // Strip content from generated assets to avoid OOM (each is ~2MB base64)
      const sanitized = files.map(f => {
        if (f.path?.startsWith('_generated/') || (f.path?.startsWith('_uploads/') && f.file_type === 'image')) {
          return { ...f, content: `[asset: ${f.path}]` }
        }
        return f
      })
      return handleCORS(NextResponse.json(sanitized))
    }

    // Create/Update file
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

    // Delete file
    if (route.match(/^\/projects\/[^/]+\/files\/[^/]+$/) && method === 'DELETE') {
      const fileId = path[3]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      await db.projectFiles.delete(fileId)
      
      return handleCORS(NextResponse.json({ success: true }))
    }

    // Sync repo files from disk into project_files
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

      // Also sync root config files
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

    // ============ CANVAS ROUTES ============
    
    // Get canvas for project — resilient: auto-creates if missing, soft auth
    if (route.match(/^\/projects\/[^/]+\/canvas$/) && method === 'GET') {
      const projectId = path[1]

      // Soft auth: try cookie auth, but don't hard-fail — canvas reads are project-scoped
      const authUser = await getAuthUser(request)
      if (!authUser) {
        // Check if any Supabase auth cookies are present (user is likely authenticated but session expired temporarily)
        const { cookies: cookiesFn } = await import('next/headers')
        const cookieStore = await cookiesFn()
        const hasSbCookies = cookieStore.getAll().some(c => c.name.includes('sb-'))
        if (!hasSbCookies) {
          return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
        }
        console.log('[Canvas GET] Auth cookie present but session expired — allowing read for project', projectId)
      }

      let canvas = await db.projectCanvas.findByProjectId(projectId)
      
      // Auto-create default canvas if none exists
      if (!canvas) {
        try {
          canvas = await db.projectCanvas.create({
            project_id: projectId,
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
          console.log('[Canvas GET] Auto-created empty canvas for project', projectId)
        } catch (createErr) {
          // Another request may have created it concurrently
          canvas = await db.projectCanvas.findByProjectId(projectId)
          if (!canvas) {
            return handleCORS(NextResponse.json({ error: 'Canvas creation failed' }, { status: 500 }))
          }
        }
      }
      
      return handleCORS(NextResponse.json(canvas))
    }

    // Update canvas
    if (route.match(/^\/projects\/[^/]+\/canvas$/) && method === 'PUT') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const body = await request.json()
      const { canvas_content, change_summary } = body
      
      await db.projectCanvas.update(projectId, canvas_content)
      
      // Log canvas event if change_summary provided
      if (change_summary) {
        await db.canvasEvents.create({
          project_id: projectId,
          message_id: body.message_id || null,
          change_summary
        })
      }
      
      return handleCORS(NextResponse.json({ success: true }))
    }

    // ============ DESIGN PREFERENCES ROUTES ============

    // Get design preferences for project
    if (route.match(/^\/projects\/[^/]+\/design$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const project = await db.projects.findById(projectId)
      if (!project) {
        return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
      }

      const settings = project.settings || {}
      return handleCORS(NextResponse.json({
        design_prefs: settings.design_prefs || null
      }))
    }

    // Update design preferences for project
    if (route.match(/^\/projects\/[^/]+\/design$/) && method === 'PUT') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const body = await request.json()
      const project = await db.projects.findById(projectId)
      const currentSettings = project?.settings || {}
      await db.projects.update(projectId, {
        settings: { ...currentSettings, design_prefs: body }
      })

      return handleCORS(NextResponse.json({ success: true, design_prefs: body }))
    }

    // ============ DIFF / APPLY ROUTES ============

    // Apply approved diffs — creates snapshot, writes files, logs events
    if (route.match(/^\/projects\/[^/]+\/apply-diffs$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const body = await request.json()
      const { approvedFiles, planData, chatId } = body

      if (!approvedFiles || !Array.isArray(approvedFiles) || approvedFiles.length === 0) {
        return handleCORS(NextResponse.json({ error: 'No files to apply' }, { status: 400 }))
      }

      // DiffReviewGuard
      const guardErrors = []
      const normPath = (p) => (p || '').replace(/^\.\//, '').replace(/^\//, '')

      // Load server-side pending diff state
      let pendingMessage = null
      if (chatId) {
        const chatMessages = await db.messages.findByChatId(chatId)
        pendingMessage = chatMessages.reverse().find(m =>
          m.metadata?.diffStatus === 'pending' && m.metadata?.diffFiles?.length > 0
        )
      }

      if (!pendingMessage) {
        guardErrors.push('No pending diff review found for this chat')
      }

      if (pendingMessage && pendingMessage.metadata?.diffStatus !== 'pending') {
        guardErrors.push(`diffStatus is "${pendingMessage.metadata?.diffStatus}", expected "pending"`)
      }

      const serverDiffFiles = pendingMessage?.metadata?.diffFiles || []
      if (pendingMessage && serverDiffFiles.length === 0) {
        guardErrors.push('Server-side metadata.diffFiles is empty')
      }

      // Normalize all paths
      for (const diff of approvedFiles) {
        diff.path = normPath(diff.path)
      }
      const serverPaths = new Set(serverDiffFiles.map(f => normPath(f.path)))
      const approvedPaths = new Set(approvedFiles.map(f => f.path))

      // Exact set match
      if (serverDiffFiles.length > 0) {
        if (approvedFiles.length !== serverDiffFiles.length) {
          guardErrors.push(`Diff set size mismatch: approved ${approvedFiles.length} vs server ${serverDiffFiles.length}`)
        }
        for (const p of approvedPaths) {
          if (!serverPaths.has(p)) guardErrors.push(`"${p}": not in server-side pending diff set`)
        }
        for (const p of serverPaths) {
          if (!approvedPaths.has(p)) guardErrors.push(`"${p}": in server-side pending set but not in approved files`)
        }
      }

      // Plan hash match
      if (planData && pendingMessage?.metadata?.planData) {
        const { hashPlan: hp } = await import('@/lib/ai/plan-validator.js')
        const clientHash = hp(planData)
        const serverHash = hp(pendingMessage.metadata.planData)
        if (clientHash !== serverHash) {
          guardErrors.push('Plan hash does not match pending diff review context')
        }
      }

      // planId match
      if (planData?.planId && pendingMessage?.metadata?.planId) {
        if (planData.planId !== pendingMessage.metadata.planId) {
          guardErrors.push('STALE_PLAN_OR_DIFF_ID: planId mismatch')
        }
      }

      // diffId match
      if (body.diffId && pendingMessage?.metadata?.diffId) {
        if (body.diffId !== pendingMessage.metadata.diffId) {
          guardErrors.push('STALE_PLAN_OR_DIFF_ID: diffId mismatch')
        }
      }

      // Load existing files with normalized paths
      const existingFiles = await db.projectFiles.findByProjectId(projectId)
      const existingByPath = new Map(existingFiles.map(f => [normPath(f.path), f]))

      for (const diff of approvedFiles) {
        // Illegal create
        if (diff.action === 'create' && existingByPath.has(diff.path)) {
          guardErrors.push(`"${diff.path}": illegal create — file already exists`)
        }
        // No-op update
        if (diff.action === 'update' && diff.newContent != null) {
          const existing = existingByPath.get(diff.path)
          if (existing && existing.content === diff.newContent) {
            guardErrors.push(`"${diff.path}": no-op update — content identical to current file`)
          }
        }
      }

      if (guardErrors.length > 0) {
        const { logPlanEvent } = await import('@/lib/ai/changelog.js')
        const { hashPlan } = await import('@/lib/ai/plan-validator.js')
        logPlanEvent({
          projectId,
          chatId: chatId || null,
          userId: null,
          userTask: planData?.summary || 'apply-diffs',
          taskMode: 'diff_review_rejected',
          validatorResult: { valid: false, errors: guardErrors, warnings: [], mode: 'diff_review_rejected' },
          planHash: planData ? hashPlan(planData) : null,
          rejectionReasons: guardErrors,
          planSummary: planData?.summary || null,
          fileActions: approvedFiles.map(d => ({ action: d.action, path: d.path })),
        }).catch(e => console.warn('[changelog] diff_review_rejected logPlanEvent failed:', e.message))

        return handleCORS(NextResponse.json({
          success: false,
          error: 'DiffReviewGuard rejected',
          rejection_reasons: guardErrors,
        }, { status: 422 }))
      }

      const aiService = new AIService(body.provider || 'openai')
      const results = await aiService.applyDiffs(projectId, chatId, authUser.id, approvedFiles, planData)

      // safeApplyDiffs handles diffStatus transition internally now;
      // only fall back to manual update if it didn't transition
      if (pendingMessage && !results.diffStatusTransitioned) {
        try {
          await db.messages.update(pendingMessage.id, {
            metadata: { ...pendingMessage.metadata, diffStatus: 'applied' }
          })
        } catch {}
      }

      // Auto-save successful prompt as pattern (fire-and-forget)
      import('@/lib/self_builder/change_log').then(async ({ logChange }) => {
        let chatType = 'builder'
        if (chatId) {
          try {
            const chat = await db.chats.findById(chatId)
            if (chat?.title?.startsWith(SELF_EDIT_PREFIX)) chatType = 'self_edit'
          } catch {}
        }
        logChange({
          projectId,
          chatId: chatId || null,
          userId: authUser.id,
          userTask: planData?.summary || '',
          taskMode: 'apply',
          result: results.rolledBack ? 'rolled_back' : 'applied',
          filePaths: [...(results.written || []), ...(results.deleted || [])],
          fileActions: [
            ...(results.written || []).map(p => ({ path: p, action: 'write' })),
            ...(results.deleted || []).map(p => ({ path: p, action: 'delete' })),
          ],
          chatType,
        })
      }).catch(e => console.warn('[changelog] apply logChange failed:', e.message))

      // Build continuation info if plan has next_steps
      const nextStep = (!results.rolledBack && planData?.next_steps?.length > 0) ? planData.next_steps[0] : null
      const remainingSteps = (!results.rolledBack && planData?.next_steps?.length > 1) ? planData.next_steps.slice(1) : []

      return handleCORS(NextResponse.json({
        success: !results.rolledBack,
        snapshot: results.snapshot ? { id: results.snapshot.id, name: results.snapshot.name } : null,
        written: results.written,
        deleted: results.deleted,
        skipped: results.skipped,
        errors: results.errors,
        rolledBack: results.rolledBack || false,
        continuation: nextStep ? { nextStep, remainingSteps, originalTask: planData?.summary || '' } : null,
      }))
    }


    // ============ FILE UPLOAD ROUTES ============

    // ============ IMAGE GENERATION ROUTES ============

    // Generate image
    if (route.match(/^\/projects\/[^/]+\/generate-image$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      try {
        const { ImageService } = await import('@/lib/ai/image-service')
        const body = await request.json()
        const { prompt, mode, spriteOpts, size, chatId, variation } = body

        if (!prompt && !spriteOpts) {
          return handleCORS(NextResponse.json({ error: 'Prompt required' }, { status: 400 }))
        }

        const imageService = new ImageService()

        // Stream progress events via SSE
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            let closed = false
            const send = (event, data) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
              } catch { closed = true }
            }

            try {
              const generator = imageService.generateWithProgress({
                projectId,
                prompt: prompt || '',
                mode: mode || 'image',
                spriteOpts,
                size,
                userId: authUser.id,
                chatId,
                variation: variation || undefined,
              })

              for await (const evt of generator) {
                if (evt.type === 'stage') {
                  send('image_stage', { stage: evt.stage, progress: evt.progress, label: evt.label })
                } else if (evt.type === 'complete') {
                  const asset = evt.asset || {}
                  send('image_complete', {
                    asset: {
                      id: asset.id || null,
                      path: asset.path || null,
                      filename: asset.filename || null,
                      prompt: asset.prompt || null,
                      mode: asset.mode || null,
                      size: asset.size || null,
                      revisedPrompt: asset.revisedPrompt || null,
                      duration: asset.duration || null,
                      createdAt: asset.createdAt || null,
                      variationType: asset.variationType || null,
                      sourceAssetId: asset.sourceAssetId || null,
                      sourceAssetPath: asset.sourceAssetPath || null,
                      stateName: asset.stateName || null,
                      characterName: asset.characterName || null,
                    },
                    progress: 100,
                  })
                }
              }
            } catch (err) {
              console.error('[ImageGen] Error:', err)
              send('image_error', {
                error: err.message || 'Image generation failed',
                error_type: err.error_type || 'generation_error',
              })
            }

            if (!closed) controller.close()
          }
        })

        const sseResponse = new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*',
            'Access-Control-Allow-Credentials': 'true',
          }
        })
        return sseResponse
      } catch (err) {
        console.error('[ImageGen] Error:', err)
        return handleCORS(NextResponse.json({
          error: err.message || 'Image generation failed',
          error_type: err.error_type || 'generation_error'
        }, { status: 500 }))
      }
    }

    // Get project assets (generated images + uploaded images)
    if (route.match(/^\/projects\/[^/]+\/assets$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const files = await db.projectFiles.findByProjectId(projectId)
      const assets = files
        .filter(f => f.path?.startsWith('_generated/') || (f.path?.startsWith('_uploads/') && f.file_type === 'image'))
        .map(f => {
          // Extract clean filename: remove prefix directory
          const rawName = f.path.replace(/^_(?:generated|uploads)\//, '')
          // For generated: safeName_timestamp.png → extract readable name
          const cleanName = rawName.replace(/_\d{13}\.png$/, '.png').replace(/_/g, ' ')
          return {
            id: f.id,
            path: f.path,
            filename: cleanName || rawName,
            type: f.path.startsWith('_generated/') ? 'generated' : 'uploaded',
            file_type: f.file_type,
            created_at: f.created_at,
            category: f.path.includes('sprite') ? 'sprite' :
              f.path.includes('icon') ? 'icon' :
              f.path.includes('background') || f.path.includes('bg') ? 'background' :
              f.path.includes('ui') ? 'ui' : 'image',
          }
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      return handleCORS(NextResponse.json(assets))
    }

    // Get asset relationships
    if (route.match(/^\/projects\/[^/]+\/asset-relationships$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      try {
        const file = await db.projectFiles.findByPath(projectId, '_meta/asset_relationships.json')
        const data = file?.content ? JSON.parse(file.content) : { relationships: [], characters: {} }
        return handleCORS(NextResponse.json(data))
      } catch {
        return handleCORS(NextResponse.json({ relationships: [], characters: {} }))
      }
    }

    // ── Prompt Library API ──
    if (route.match(/^\/projects\/[^/]+\/prompt-library$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { getPromptLibrary } = await import('@/lib/ai/prompt-library')
      const data = await getPromptLibrary(projectId)
      return handleCORS(NextResponse.json(data))
    }

    if (route.match(/^\/projects\/[^/]+\/prompt-library$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const body = await request.json()
      const { savePromptToLibrary } = await import('@/lib/ai/prompt-library')
      const entry = await savePromptToLibrary(projectId, body)
      return handleCORS(NextResponse.json(entry))
    }

    if (route.match(/^\/projects\/[^/]+\/prompt-library\/[^/]+$/) && method === 'DELETE') {
      const projectId = path[1]
      const promptId = path[3]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { deletePromptFromLibrary } = await import('@/lib/ai/prompt-library')
      await deletePromptFromLibrary(projectId, promptId)
      return handleCORS(NextResponse.json({ success: true }))
    }

    // ── Learning / Adaptive Memory API ──
    if (route.match(/^\/projects\/[^/]+\/learning$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { getLearningEvents } = await import('@/lib/ai/adaptive-learning')
      const data = await getLearningEvents(projectId)
      return handleCORS(NextResponse.json(data))
    }

    if (route.match(/^\/projects\/[^/]+\/learning\/rules\/[^/]+$/) && method === 'PATCH') {
      const projectId = path[1]
      const ruleId = path[4]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const body = await request.json()
      const { updateRule } = await import('@/lib/ai/adaptive-learning')
      await updateRule(projectId, ruleId, body)
      return handleCORS(NextResponse.json({ success: true }))
    }

    if (route.match(/^\/projects\/[^/]+\/learning\/rules\/[^/]+$/) && method === 'DELETE') {
      const projectId = path[1]
      const ruleId = path[4]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { deleteRule } = await import('@/lib/ai/adaptive-learning')
      await deleteRule(projectId, ruleId)
      return handleCORS(NextResponse.json({ success: true }))
    }

    if (route.match(/^\/projects\/[^/]+\/learning\/reset$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { resetProjectMemory } = await import('@/lib/ai/adaptive-learning')
      await resetProjectMemory(projectId)
      return handleCORS(NextResponse.json({ success: true }))
    }

    if (route.match(/^\/projects\/[^/]+\/learning\/reset-all$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { resetAllMemory } = await import('@/lib/ai/adaptive-learning')
      await resetAllMemory(projectId)
      return handleCORS(NextResponse.json({ success: true }))
    }

    // ── User Preferences API ──
    if (route.match(/^\/projects\/[^/]+\/user-preferences$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { getUserPreferences } = await import('@/lib/ai/adaptive-learning')
      const prefs = await getUserPreferences(projectId)
      return handleCORS(NextResponse.json(prefs))
    }

    if (route.match(/^\/projects\/[^/]+\/user-preferences$/) && method === 'PATCH') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const body = await request.json()
      const { updateUserPreferences } = await import('@/lib/ai/adaptive-learning')
      const updated = await updateUserPreferences(projectId, body)
      return handleCORS(NextResponse.json(updated))
    }

    // ── Project Preferences API ──
    if (route.match(/^\/projects\/[^/]+\/project-preferences$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const { getProjectPreferences } = await import('@/lib/ai/adaptive-learning')
      const prefs = await getProjectPreferences(projectId)
      return handleCORS(NextResponse.json(prefs))
    }

    if (route.match(/^\/projects\/[^/]+\/project-preferences$/) && method === 'PATCH') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      const body = await request.json()
      const { updateProjectPreferences } = await import('@/lib/ai/adaptive-learning')
      const prefs = await updateProjectPreferences(projectId, body)
      return handleCORS(NextResponse.json(prefs))
    }



    // Get asset content (for viewing/downloading)
    if (route.match(/^\/projects\/[^/]+\/asset-content$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const url = new URL(request.url)
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        return handleCORS(NextResponse.json({ error: 'Path required' }, { status: 400 }))
      }

      const file = await db.projectFiles.findByPath(projectId, filePath)
      if (!file) {
        return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
      }

      return handleCORS(NextResponse.json({ content: file.content, path: file.path }))
    }

    // Upload files to a project (for chat attachments)
    if (route.match(/^\/projects\/[^/]+\/upload$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      try {
        const body = await request.json()
        const { files, chatId } = body

        if (!files || !Array.isArray(files) || files.length === 0) {
          return handleCORS(NextResponse.json({ error: 'No files provided' }, { status: 400 }))
        }

        const ALLOWED_EXTENSIONS = ['txt','md','json','csv','html','css','js','jsx','ts','tsx','py','sql','pdf','png','jpg','jpeg','webp','svg']
        const TEXT_EXTENSIONS = ['txt','md','json','csv','html','css','js','jsx','ts','tsx','py','sql']
        const IMAGE_EXTENSIONS = ['png','jpg','jpeg','webp','svg']
        const MAX_TEXT_SIZE = 512 * 1024  // 500KB
        const MAX_IMAGE_SIZE = 5 * 1024 * 1024  // 5MB
        const MAX_PDF_SIZE = 10 * 1024 * 1024  // 10MB

        const results = []

        for (const file of files) {
          const ext = file.filename.split('.').pop()?.toLowerCase()
          if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
            results.push({ filename: file.filename, error: `Unsupported file type: .${ext}` })
            continue
          }

          // Validate size
          const dataSize = file.data ? Buffer.from(file.data.split(',').pop() || file.data, 'base64').length : (file.content?.length || 0)
          const maxSize = ext === 'pdf' ? MAX_PDF_SIZE : IMAGE_EXTENSIONS.includes(ext) ? MAX_IMAGE_SIZE : MAX_TEXT_SIZE
          if (dataSize > maxSize) {
            results.push({ filename: file.filename, error: `File too large (${(dataSize / 1024 / 1024).toFixed(1)}MB, max ${(maxSize / 1024 / 1024).toFixed(0)}MB)` })
            continue
          }

          const isText = TEXT_EXTENSIONS.includes(ext)
          const isImage = IMAGE_EXTENSIONS.includes(ext)
          const isPdf = ext === 'pdf'

          const storagePath = `_uploads/${Date.now()}_${file.filename}`
          let textContent = null
          let extractedText = null

          if (isText && file.content) {
            textContent = file.content
          } else if (isText && file.data) {
            // Decode base64 text
            const buff = Buffer.from(file.data.split(',').pop() || file.data, 'base64')
            textContent = buff.toString('utf-8')
          }

          if (isPdf && file.data) {
            // Simple PDF text extraction attempt
            try {
              const buff = Buffer.from(file.data.split(',').pop() || file.data, 'base64')
              const text = buff.toString('utf-8')
              // Extract readable text between stream markers
              const matches = text.match(/\(([^)]+)\)/g)
              if (matches) {
                extractedText = matches.map(m => m.slice(1, -1)).join(' ').slice(0, 50000)
              }
              if (!extractedText || extractedText.length < 20) {
                extractedText = '[PDF text extraction limited — binary PDF content]'
              }
            } catch {
              extractedText = '[PDF text could not be extracted]'
            }
          }

          // Store in project_files
          const fileType = isImage ? 'image' : isPdf ? 'document' : 'code'
          const storeContent = isText ? textContent : (isImage ? file.data : (extractedText || file.data))

          const saved = await db.projectFiles.upsert(projectId, storagePath, storeContent || '', fileType)

          const attachment = {
            id: saved.id,
            filename: file.filename,
            path: storagePath,
            mime_type: file.mime_type || 'application/octet-stream',
            size: dataSize,
            file_category: isText ? 'text' : isImage ? 'image' : isPdf ? 'pdf' : 'binary',
            content: isText ? textContent : null,
            extracted_text: extractedText,
            preview_data: isImage ? file.data : null,
            has_content: !!textContent,
            uploaded_by: authUser.id,
            created_at: new Date().toISOString(),
          }

          results.push({ ...attachment, success: true })
        }

        return handleCORS(NextResponse.json({ uploads: results }))
      } catch (err) {
        console.error('[Upload] Error:', err)
        return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
      }
    }

    // Get attachments for a project
    if (route.match(/^\/projects\/[^/]+\/attachments$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const files = await db.projectFiles.findByProjectId(projectId)
      const uploads = files.filter(f => f.path?.startsWith('_uploads/'))
      return handleCORS(NextResponse.json(uploads.map(f => ({
        id: f.id,
        filename: f.path.replace(/^_uploads\/\d+_/, ''),
        path: f.path,
        file_type: f.file_type,
        size: f.content?.length || 0,
        created_at: f.created_at,
      }))))
    }

    // Get attachment content by path
    if (route.match(/^\/projects\/[^/]+\/attachment-content$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const url = new URL(request.url)
      const filePath = url.searchParams.get('path')
      if (!filePath || !filePath.startsWith('_uploads/')) {
        return handleCORS(NextResponse.json({ error: 'Invalid path' }, { status: 400 }))
      }

      const file = await db.projectFiles.findByPath(projectId, filePath)
      if (!file) {
        return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
      }

      return handleCORS(NextResponse.json({
        id: file.id,
        path: file.path,
        content: file.content,
        file_type: file.file_type,
      }))
    }

    // ============ SNAPSHOT ROUTES ============
    
    // Get snapshots for project
    if (route.match(/^\/projects\/[^/]+\/snapshots$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const snapshots = await db.snapshots.findByProjectId(projectId)
      return handleCORS(NextResponse.json(snapshots))
    }

    // Create snapshot
    if (route.match(/^\/projects\/[^/]+\/snapshots$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const body = await request.json()
      const { name } = body
      
      if (!name) {
        return handleCORS(NextResponse.json({ error: 'Snapshot name required' }, { status: 400 }))
      }
      
      // Get all files for project
      const files = await db.projectFiles.findByProjectId(projectId)
      
      // Get canvas
      const canvas = await db.projectCanvas.findByProjectId(projectId)
      
      const snapshot = await db.snapshots.create({
        project_id: projectId,
        name,
        files_snapshot: files,
        canvas_snapshot: canvas?.canvas_content || null,
        metadata: {
          file_count: files.length,
          created_by: authUser.email
        }
      })
      
      return handleCORS(NextResponse.json(snapshot, { status: 201 }))
    }

    // Restore snapshot
    if (route.match(/^\/snapshots\/[^/]+\/restore$/) && method === 'POST') {
      const snapshotId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const snapshot = await db.snapshots.findById(snapshotId)
      if (!snapshot) {
        return handleCORS(NextResponse.json({ error: 'Snapshot not found' }, { status: 404 }))
      }
      
      const projectId = snapshot.project_id
      
      // Delete current files
      await db.projectFiles.deleteByProjectId(projectId)
      
      // Restore files from snapshot
      if (snapshot.files_snapshot && snapshot.files_snapshot.length > 0) {
        const restoredFiles = snapshot.files_snapshot.map(f => ({
          project_id: projectId,
          path: f.path,
          content: f.content,
          file_type: f.file_type,
          version: 1,
          restored_from: snapshotId
        }))
        await db.projectFiles.bulkInsert(restoredFiles)
      }
      
      // Restore canvas if present
      if (snapshot.canvas_snapshot) {
        await db.projectCanvas.update(projectId, snapshot.canvas_snapshot)
      }
      
      return handleCORS(NextResponse.json({ 
        success: true, 
        restored_files: snapshot.files_snapshot?.length || 0 
      }))
    }

    // ============ EXPORT ROUTES ============
    
    // Get exports for project
    if (route.match(/^\/projects\/[^/]+\/exports$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const exports = await db.exports.findByProjectId(projectId)
      return handleCORS(NextResponse.json(exports))
    }

    // Create export
    if (route.match(/^\/projects\/[^/]+\/exports$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const body = await request.json()
      const { export_type } = body
      
      const validTypes = ['web', 'pwa', 'ios', 'android', 'zip', 'manifest']
      if (!validTypes.includes(export_type)) {
        return handleCORS(NextResponse.json({ error: 'Invalid export type' }, { status: 400 }))
      }
      
      // Get project data
      const project = await db.projects.findById(projectId)
      const files = await db.projectFiles.findByProjectId(projectId)
      const canvas = await db.projectCanvas.findByProjectId(projectId)
      const chats = await db.chats.findByProjectId(projectId)
      const snapshots = await db.snapshots.findByProjectId(projectId)
      
      let artifactData = null
      
      // Generate export based on type
      if (export_type === 'manifest') {
        artifactData = {
          version: '1.0.0',
          format: 'mymergent-project',
          project: {
            id: project.id,
            name: project.name,
            description: project.description,
            type: project.type,
            settings: project.settings,
            created_at: project.created_at,
            updated_at: project.updated_at
          },
          files: files,
          canvas: canvas?.canvas_content || null,
          chats: chats.map(c => ({ id: c.id, title: c.title, created_at: c.created_at })),
          snapshots: snapshots.map(s => ({ id: s.id, name: s.name, created_at: s.created_at })),
          exported_at: new Date().toISOString(),
          exported_by: authUser.email
        }
      } else if (export_type === 'zip') {
        // Create ZIP with all project files
        const zip = new JSZip()
        
        // Add manifest
        const manifest = {
          version: '1.0.0',
          format: 'mymergent-project',
          project: {
            id: project.id,
            name: project.name,
            description: project.description,
            type: project.type,
            settings: project.settings
          },
          exported_at: new Date().toISOString()
        }
        zip.file('mymergent-manifest.json', JSON.stringify(manifest, null, 2))
        
        // Add project files
        const srcFolder = zip.folder('src')
        files.forEach(file => {
          srcFolder.file(file.path, file.content || '')
        })
        
        // Add canvas
        if (canvas?.canvas_content) {
          zip.file('canvas.json', JSON.stringify(canvas.canvas_content, null, 2))
        }
        
        // Generate ZIP
        const zipContent = await zip.generateAsync({ type: 'base64' })
        artifactData = { 
          zip_base64: zipContent, 
          filename: `${project.name.replace(/[^a-z0-9]/gi, '_')}.zip` 
        }
      }
      
      const exportRecord = await db.exports.create({
        project_id: projectId,
        export_type,
        status: artifactData ? 'completed' : 'pending',
        artifact_data: artifactData,
        metadata: {
          file_count: files.length,
          exported_by: authUser.email
        }
      })
      
      return handleCORS(NextResponse.json(exportRecord, { status: 201 }))
    }

    // ============ IMPORT ROUTES ============
    
    // Import project from manifest
    if (route === '/projects/import' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }
      
      const body = await request.json()
      const { manifest } = body
      
      if (!manifest || manifest.format !== 'mymergent-project') {
        return handleCORS(NextResponse.json({ error: 'Invalid project manifest' }, { status: 400 }))
      }
      
      // Create project
      const project = await db.projects.create({
        user_id: dbUser.id,
        name: manifest.project.name + ' (Imported)',
        description: manifest.project.description,
        type: manifest.project.type,
        settings: manifest.project.settings || {},
        imported_from: manifest.project.id,
        imported_at: new Date().toISOString()
      })
      
      // Import files
      if (manifest.files && manifest.files.length > 0) {
        const importedFiles = manifest.files.map(f => ({
          project_id: project.id,
          path: f.path,
          content: f.content || '',
          file_type: f.file_type || 'text',
          version: 1,
          imported: true
        }))
        await db.projectFiles.bulkInsert(importedFiles)
      }
      
      // Import canvas
      await db.projectCanvas.create({
        project_id: project.id,
        canvas_content: manifest.canvas || {
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
      
      return handleCORS(NextResponse.json({
        project,
        imported_files: manifest.files?.length || 0
      }, { status: 201 }))
    }

    // ============ SEARCH ROUTES ============
    
    // Global search
    if (route === '/search' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }
      
      const body = await request.json()
      const { query, project_id, content_types } = body
      
      if (!query || query.length < 2) {
        return handleCORS(NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 }))
      }
      
      const results = {
        projects: [],
        chats: [],
        messages: [],
        files: []
      }
      
      // Get user's projects for filtering
      const userProjects = await db.projects.findByUserId(dbUser.id)
      const projectIds = project_id ? [project_id] : userProjects.map(p => p.id)
      
      if (projectIds.length === 0) {
        return handleCORS(NextResponse.json(results))
      }
      
      const { getSupabaseAdmin } = await import('@/lib/supabase/db')
      const supabase = getSupabaseAdmin()
      
      // Search projects
      if (!content_types || content_types.includes('projects')) {
        const { data } = await supabase
          .from('projects')
          .select('*')
          .eq('user_id', dbUser.id)
          .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
          .limit(20)
        results.projects = data || []
      }
      
      // Search chats
      if (!content_types || content_types.includes('chats')) {
        const { data } = await supabase
          .from('chats')
          .select('*')
          .in('project_id', projectIds)
          .ilike('title', `%${query}%`)
          .limit(20)
        results.chats = data || []
      }
      
      // Search messages
      if (!content_types || content_types.includes('messages')) {
        const { data } = await supabase
          .from('messages')
          .select('*')
          .in('project_id', projectIds)
          .ilike('content', `%${query}%`)
          .limit(50)
        results.messages = data || []
      }
      
      // Search files
      if (!content_types || content_types.includes('files')) {
        const { data } = await supabase
          .from('project_files')
          .select('id, project_id, path, file_type, version, updated_at')
          .in('project_id', projectIds)
          .or(`path.ilike.%${query}%,content.ilike.%${query}%`)
          .limit(30)
        results.files = data || []
      }
      
      // Build project_map for UI (id → {id, name}) from all user projects
      const projectMap = {}
      for (const p of userProjects) {
        projectMap[p.id] = { id: p.id, name: p.name }
      }
      results.project_map = projectMap
      
      return handleCORS(NextResponse.json(results))
    }

    // ============ DEPLOYMENT ROUTES ============
    
    // Get deployments for project
    if (route.match(/^\/projects\/[^/]+\/deployments$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const deployments = await db.deployments.findByProjectId(projectId)
      return handleCORS(NextResponse.json(deployments))
    }

    // Create deployment (placeholder)
    if (route.match(/^\/projects\/[^/]+\/deployments$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const body = await request.json()
      const { platform = 'vercel' } = body
      
      const deployment = await db.deployments.create({
        project_id: projectId,
        platform,
        status: 'pending',
        metadata: {
          created_by: authUser.email,
          note: 'Deployment integration will be implemented in next phase'
        }
      })
      
      return handleCORS(NextResponse.json(deployment, { status: 201 }))
    }

    // ============ GENERATION LOGS ROUTES ============
    
    // Get generation runs for project
    if (route.match(/^\/projects\/[^/]+\/generations$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const runs = await db.generationRuns.findByProjectId(projectId)
      return handleCORS(NextResponse.json(runs))
    }

    // Get file change events for project
    if (route.match(/^\/projects\/[^/]+\/file-events$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const events = await db.fileChangeEvents.findByProjectId(projectId)
      return handleCORS(NextResponse.json(events))
    }

    // GET /api/projects/:id/memory — project memory entries
    if (route.match(/^\/projects\/[^/]+\/memory$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const entries = await db.projectMemory.findByProjectId(projectId)
      return handleCORS(NextResponse.json(entries))
    }

    // POST /api/projects/:id/memory — create memory entry
    if (route.match(/^\/projects\/[^/]+\/memory$/) && method === 'POST') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const body = await request.json()
      const { key, value } = body
      if (!key) {
        return handleCORS(NextResponse.json({ error: 'Missing key' }, { status: 400 }))
      }
      try {
        const entry = await db.projectMemory.create({
          project_id: projectId,
          key,
          value: value || '',
        })
        return handleCORS(NextResponse.json(entry, { status: 201 }))
      } catch (err) {
        return handleCORS(NextResponse.json({ error: 'Failed to save memory', details: err.message }, { status: 500 }))
      }
    }

    // DELETE /api/projects/:id/memory/:memoryId
    if (route.match(/^\/projects\/[^/]+\/memory\/[^/]+$/) && method === 'DELETE') {
      const memoryId = path[3]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      await db.projectMemory.deleteById(memoryId)
      return handleCORS(NextResponse.json({ success: true }))
    }

    // PUT /api/projects/:id/memory/:memoryId — update memory entry
    if (route.match(/^\/projects\/[^/]+\/memory\/[^/]+$/) && method === 'PUT') {
      const memoryId = path[3]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const body = await request.json()
      const updated = await db.projectMemory.updateById(memoryId, {
        key: body.key,
        value: body.value,
      })
      return handleCORS(NextResponse.json(updated))
    }

    // GET /api/projects/:id/builder-status — self-builder status from changelog
    if (route.match(/^\/projects\/[^/]+\/builder-status$/) && method === 'GET') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const logs = await db.changelog.findByProject(projectId, 50)
      const total = logs.length
      const applied = logs.filter(l => l.validator_result?.result === 'applied').length
      const rolledBack = logs.filter(l => l.validator_result?.result === 'rolled_back').length
      const discarded = logs.filter(l => l.validator_result?.result === 'discarded').length
      const selfEdits = logs.filter(l => l.validator_result?.chat_type === 'self_edit').length
      const lastBuild = logs[0]?.created_at || null
      return handleCORS(NextResponse.json({ total, applied, rolledBack, discarded, selfEdits, lastBuild }))
    }

    // ========== MONITORED ACTIVITY ==========
    // GET /api/admin/monitored — monitored-user prompts/actions (owner only)
    if (route === '/admin/monitored' && method === 'GET') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const currentUser = await checkAllowlist(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'view_monitored')) {
        return handleCORS(NextResponse.json({ error: 'Owner access required' }, { status: 403 }))
      }

      const supabase = getSupabaseAdmin()
      const allUsers = await db.users.findAll()
      const userMap = new Map(allUsers.map(u => [u.id, u]))

      // Find all child_monitored user IDs
      let monitoredEmails = new Set()
      try {
        const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
        for (const au of (authUsers || [])) {
          if (au.user_metadata?.app_role === 'child_monitored') monitoredEmails.add(au.email)
        }
      } catch {}

      const monitoredUserIds = new Set()
      for (const [id, u] of userMap) {
        if (monitoredEmails.has(u.email)) monitoredUserIds.add(id)
      }

      // Fetch changelog entries from monitored users
      const { data: changelog } = await supabase
        .from('changelog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)

      const feed = []
      for (const entry of (changelog || [])) {
        if (!monitoredUserIds.has(entry.user_id)) continue
        const u = userMap.get(entry.user_id)
        feed.push({
          id: entry.id,
          timestamp: entry.created_at,
          actor: u?.email || 'unknown',
          role: 'child_monitored',
          action_type: entry.task_mode || 'prompt',
          prompt: entry.user_task || '',
          target: entry.plan_summary || '',
          project_id: entry.project_id,
          chat_id: entry.chat_id || null,
        })
      }

      return handleCORS(NextResponse.json(feed.slice(0, 100)))
    }

    // ========== ACTIVITY LOG ==========
    // GET /api/admin/activity — unified activity feed for admin/owner
    if (route === '/admin/activity' && method === 'GET') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const currentUser = await checkAllowlist(authUser.email)
      if (!currentUser || !hasPermission(getUserRole(currentUser), 'view_admin')) {
        return handleCORS(NextResponse.json({ error: 'Admin access required' }, { status: 403 }))
      }

      // Fetch from multiple sources and merge into unified feed
      const supabase = getSupabaseAdmin()
      const allUsers = await db.users.findAll()
      const userMap = new Map(allUsers.map(u => [u.id, u]))

      // Source 1: changelog entries (plan executions, diffs, discards, role changes, self-edit)
      const { data: changelog } = await supabase
        .from('changelog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      // Source 2: file change events (file creates, updates, deletes)
      const { data: fileEvents } = await supabase
        .from('file_change_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      // Enrich auth metadata for admin roles
      let metaMap = new Map()
      try {
        const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
        for (const au of (authUsers || [])) {
          if (au.user_metadata?.app_role) metaMap.set(au.email, au.user_metadata.app_role)
        }
      } catch {}

      function resolveActor(userId) {
        const u = userMap.get(userId)
        if (!u) return { email: 'system', role: 'system' }
        const metaRole = metaMap.get(u.email)
        const dbRole = u.role === 'owner' ? 'owner' : (metaRole === 'admin' || metaRole === 'child_monitored' ? metaRole : 'member')
        return { email: u.email, role: dbRole }
      }

      const feed = []

      // Process changelog
      for (const entry of (changelog || [])) {
        const actor = resolveActor(entry.user_id)
        const mode = entry.task_mode || 'plan'
        let actionType = mode
        let target = entry.plan_summary || entry.user_task || ''
        if (target.length > 120) target = target.slice(0, 120) + '…'

        feed.push({
          id: entry.id,
          timestamp: entry.created_at,
          actor: actor.email,
          role: actor.role,
          action_type: actionType,
          target,
          source: 'changelog',
          project_id: entry.project_id,
          rejected: (entry.rejection_reasons || []).length > 0,
        })
      }

      // Process file events
      for (const evt of (fileEvents || [])) {
        feed.push({
          id: evt.id,
          timestamp: evt.created_at,
          actor: 'system',
          role: 'system',
          action_type: `file_${evt.action}`,
          target: evt.file_path || '',
          source: 'file_events',
          project_id: evt.project_id,
          rejected: false,
        })
      }

      // Sort by timestamp descending
      feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

      return handleCORS(NextResponse.json(feed.slice(0, 100)))
    }

    // ============ CREDITS SYSTEM ============

    if (route === '/credits' && method === 'GET') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      let dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        const balance = await creditsDb.getBalance(dbUser.id)
        return handleCORS(NextResponse.json({
          ...balance,
          costs: CREDIT_COSTS,
          packages: CREDIT_PACKAGES,
        }))
      } catch (err) {
        console.error('[Credits] Get balance error:', err)
        return handleCORS(NextResponse.json({ error: 'Failed to get credits' }, { status: 500 }))
      }
    }

    if (route === '/credits/use' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      let dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        const body = await request.json()
        const { action_type } = body

        if (!action_type || !CREDIT_COSTS[action_type]) {
          return handleCORS(NextResponse.json({
            error: `Invalid action_type. Valid types: ${Object.keys(CREDIT_COSTS).join(', ')}`,
          }, { status: 400 }))
        }

        const result = await creditsDb.deductCredits(dbUser.id, action_type)

        if (result.error) {
          return handleCORS(NextResponse.json(result, { status: 402 }))
        }

        return handleCORS(NextResponse.json(result))
      } catch (err) {
        console.error('[Credits] Use error:', err)
        return handleCORS(NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 }))
      }
    }

    if (route === '/credits/add' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      let dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        const body = await request.json()
        const { amount } = body

        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
          return handleCORS(NextResponse.json({ error: 'Invalid amount' }, { status: 400 }))
        }

        const result = await creditsDb.addCredits(dbUser.id, parseFloat(amount))
        return handleCORS(NextResponse.json(result))
      } catch (err) {
        console.error('[Credits] Add error:', err)
        return handleCORS(NextResponse.json({ error: 'Failed to add credits' }, { status: 500 }))
      }
    }

    // ============ GITHUB IMPORT (PAT-based) ============

    if (route === '/import/github' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      let dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        const body = await request.json()
        const { pat, repo, branch = 'main' } = body

        if (!pat || !repo) {
          return handleCORS(NextResponse.json({ error: 'Personal Access Token and repository (owner/repo) are required' }, { status: 400 }))
        }

        const repoMatch = repo.match(/^([^/]+)\/([^/]+)$/)
        if (!repoMatch) {
          return handleCORS(NextResponse.json({ error: 'Repository must be in format owner/repo' }, { status: 400 }))
        }

        const [, owner, repoName] = repoMatch
        const ghHeaders = { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Emanator-Import' }

        // 1. Get latest commit
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${branch}`, { headers: ghHeaders })
        if (!commitRes.ok) {
          const errData = await commitRes.json().catch(() => ({}))
          if (commitRes.status === 401) return handleCORS(NextResponse.json({ error: 'Invalid Personal Access Token' }, { status: 401 }))
          if (commitRes.status === 404) return handleCORS(NextResponse.json({ error: `Repository or branch not found: ${owner}/${repoName}@${branch}` }, { status: 404 }))
          return handleCORS(NextResponse.json({ error: errData.message || 'Failed to access GitHub repository' }, { status: commitRes.status }))
        }
        const commitData = await commitRes.json()
        const commitSha = commitData.sha
        const treeSha = commitData.commit.tree.sha

        // 2. Get full tree recursively
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees/${treeSha}?recursive=1`, { headers: ghHeaders })
        if (!treeRes.ok) {
          return handleCORS(NextResponse.json({ error: 'Failed to fetch repository tree' }, { status: 500 }))
        }
        const treeData = await treeRes.json()

        if (treeData.truncated) {
          console.warn('[GitHub Import] Tree was truncated — very large repo')
        }

        const SKIP_PATTERNS = ['node_modules/', '.git/', '.DS_Store', '__MACOSX/', 'dist/', 'build/', '.next/', '.cache/', '.turbo/', 'coverage/', '.env']
        const MAX_FILE_SIZE = 512 * 1024
        const TEXT_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'scss', 'less', 'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'svg', 'sh', 'bash', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'php', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'sql', 'prisma', 'env', 'example', 'gitignore', 'npmrc', 'editorconfig', 'eslintrc', 'prettierrc', 'dockerignore', 'Dockerfile', 'Makefile', 'lock', 'map'])

        // Filter blobs (files only, skip large + ignored)
        const blobs = treeData.tree.filter(item => {
          if (item.type !== 'blob') return false
          if (SKIP_PATTERNS.some(p => item.path.includes(p))) return false
          if (item.size > MAX_FILE_SIZE) return false
          return true
        })

        if (blobs.length === 0) {
          return handleCORS(NextResponse.json({ error: 'No supported files found in repository after filtering' }, { status: 400 }))
        }

        // 3. Fetch file contents in batches
        const extractedFiles = []
        let packageJson = null
        let entryFile = null
        let framework = 'unknown'
        let detectedLanguage = 'javascript'
        const BATCH_SIZE = 15

        for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
          const batch = blobs.slice(i, i + BATCH_SIZE)
          const batchResults = await Promise.all(batch.map(async (blob) => {
            try {
              const ext = blob.path.split('.').pop()?.toLowerCase() || ''
              const isText = TEXT_EXTENSIONS.has(ext) || blob.path.includes('.')  === false

              if (!isText) {
                return { path: blob.path, content: '[binary file — not extracted]', file_type: 'binary' }
              }

              const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs/${blob.sha}`, { headers: ghHeaders })
              if (!blobRes.ok) return null

              const blobData = await blobRes.json()
              let content
              if (blobData.encoding === 'base64') {
                content = Buffer.from(blobData.content, 'base64').toString('utf-8')
              } else {
                content = blobData.content
              }

              const fileType = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext) ? 'image'
                : ['woff', 'woff2', 'ttf', 'eot'].includes(ext) ? 'font' : 'text'

              return { path: blob.path, content, file_type: fileType }
            } catch {
              return null
            }
          }))

          for (const result of batchResults) {
            if (!result) continue
            extractedFiles.push(result)

            if (result.path === 'package.json') {
              try { packageJson = JSON.parse(result.content) } catch {}
            }

            if (!entryFile) {
              if (['index.html', 'index.js', 'index.tsx', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.tsx'].includes(result.path)) {
                entryFile = result.path
              } else if (['app/page.js', 'app/page.tsx', 'pages/index.js', 'pages/index.tsx', 'src/App.jsx', 'src/App.tsx'].includes(result.path)) {
                entryFile = result.path
              }
            }

            const ext = result.path.split('.').pop()?.toLowerCase()
            if (ext === 'ts' || ext === 'tsx') detectedLanguage = 'typescript'
          }
        }

        if (extractedFiles.length === 0) {
          return handleCORS(NextResponse.json({ error: 'No files could be fetched from repository' }, { status: 400 }))
        }

        // 4. Framework detection (reuse ZIP logic)
        if (packageJson) {
          const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
          if (deps['next']) framework = 'nextjs'
          else if (deps['react']) framework = 'react'
          else if (deps['vue']) framework = 'vue'
          else if (deps['svelte'] || deps['@sveltejs/kit']) framework = 'svelte'
          else if (deps['express'] || deps['fastify'] || deps['koa']) framework = 'node'
          else framework = 'node'
        } else if (extractedFiles.some(f => f.path === 'index.html')) {
          framework = 'static'
        }

        // 5. Create project
        const projectName = packageJson?.name || repoName
        const project = await db.projects.create({
          user_id: dbUser.id,
          name: projectName,
          description: packageJson?.description || `Imported from github.com/${owner}/${repoName}`,
          type: 'app',
          settings: {
            imported: true,
            import_source: 'github',
            repo_url: `${owner}/${repoName}`,
            branch,
            last_commit_sha: commitSha,
            framework,
            entry_file: entryFile,
            detected_language: detectedLanguage,
            file_count: extractedFiles.length,
            imported_at: new Date().toISOString(),
          }
        })

        // 6. Create canvas
        await db.projectCanvas.create({
          project_id: project.id,
          canvas_content: {
            project_overview: `Imported from github.com/${owner}/${repoName} (${framework})`,
            project_goals: [],
            key_decisions: [],
            architecture_notes: [`Framework: ${framework}`, `Entry: ${entryFile || 'unknown'}`, `Language: ${detectedLanguage}`, `Branch: ${branch}`, `Commit: ${commitSha.slice(0, 8)}`],
            master_prompts: [],
            working_prompts: [],
            failed_prompts: [],
            successful_patterns: [],
            feature_requirements: [],
            technical_specs: packageJson ? [`Dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}`] : [],
            constraints: [],
            open_tasks: [],
            completed_tasks: []
          }
        })

        // 7. Create initial chat
        const initialChat = await db.chats.create({
          project_id: project.id,
          title: 'New Conversation'
        })

        // 8. Store files
        const fileBatch = extractedFiles.map(f => ({
          project_id: project.id,
          path: f.path,
          content: f.content,
          file_type: f.file_type,
          version: 1,
        }))

        if (fileBatch.length > 0) {
          await db.projectFiles.bulkInsert(fileBatch)
        }

        return handleCORS(NextResponse.json({
          success: true,
          project,
          initialChat,
          metadata: {
            framework,
            entry_file: entryFile,
            detected_language: detectedLanguage,
            file_count: extractedFiles.length,
            project_name: projectName,
            repo_url: `${owner}/${repoName}`,
            branch,
            commit_sha: commitSha,
          }
        }, { status: 201 }))

      } catch (err) {
        console.error('[GitHub Import] Error:', err)
        return handleCORS(NextResponse.json({ error: `GitHub import failed: ${err.message}` }, { status: 500 }))
      }
    }

    // ============ GITHUB SYNC (Pull Latest) ============

    if (route === '/import/github/sync' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      let dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        const body = await request.json()
        const { project_id, pat } = body

        if (!project_id || !pat) {
          return handleCORS(NextResponse.json({ error: 'project_id and pat are required' }, { status: 400 }))
        }

        const project = await db.projects.findById(project_id)
        if (!project) {
          return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
        }

        if (project.user_id !== dbUser.id) {
          return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
        }

        const settings = project.settings || {}
        if (settings.import_source !== 'github' || !settings.repo_url) {
          return handleCORS(NextResponse.json({ error: 'This project was not imported from GitHub' }, { status: 400 }))
        }

        const repoUrl = settings.repo_url
        const branch = settings.branch || 'main'
        const storedSha = settings.last_commit_sha

        const ghHeaders = { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Emanator-Import' }

        // Get latest commit
        const commitRes = await fetch(`https://api.github.com/repos/${repoUrl}/commits/${branch}`, { headers: ghHeaders })
        if (!commitRes.ok) {
          const errData = await commitRes.json().catch(() => ({}))
          return handleCORS(NextResponse.json({ error: errData.message || 'Failed to fetch latest commit' }, { status: commitRes.status }))
        }
        const commitData = await commitRes.json()
        const latestSha = commitData.sha

        if (latestSha === storedSha) {
          return handleCORS(NextResponse.json({ success: true, updated: false, message: 'Already up to date', commit_sha: latestSha }))
        }

        // Fetch full tree
        const treeSha = commitData.commit.tree.sha
        const treeRes = await fetch(`https://api.github.com/repos/${repoUrl}/git/trees/${treeSha}?recursive=1`, { headers: ghHeaders })
        if (!treeRes.ok) {
          return handleCORS(NextResponse.json({ error: 'Failed to fetch repository tree' }, { status: 500 }))
        }
        const treeData = await treeRes.json()

        const SKIP_PATTERNS = ['node_modules/', '.git/', '.DS_Store', '__MACOSX/', 'dist/', 'build/', '.next/', '.cache/', '.turbo/', 'coverage/', '.env']
        const MAX_FILE_SIZE = 512 * 1024

        const blobs = treeData.tree.filter(item => {
          if (item.type !== 'blob') return false
          if (SKIP_PATTERNS.some(p => item.path.includes(p))) return false
          if (item.size > MAX_FILE_SIZE) return false
          return true
        })

        // Fetch and upsert files
        let updatedCount = 0
        let createdCount = 0
        const BATCH_SIZE = 15

        for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
          const batch = blobs.slice(i, i + BATCH_SIZE)
          await Promise.all(batch.map(async (blob) => {
            try {
              const blobRes = await fetch(`https://api.github.com/repos/${repoUrl}/git/blobs/${blob.sha}`, { headers: ghHeaders })
              if (!blobRes.ok) return

              const blobData = await blobRes.json()
              let content
              if (blobData.encoding === 'base64') {
                content = Buffer.from(blobData.content, 'base64').toString('utf-8')
              } else {
                content = blobData.content
              }

              const ext = blob.path.split('.').pop()?.toLowerCase() || 'text'
              const fileType = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext) ? 'image'
                : ['woff', 'woff2', 'ttf', 'eot'].includes(ext) ? 'font' : 'text'

              const result = await db.projectFiles.upsert(project_id, blob.path, content, fileType)
              if (result.action === 'updated') updatedCount++
              else if (result.action === 'created') createdCount++
            } catch {}
          }))
        }

        // Update project settings with new commit SHA
        await db.projects.update(project_id, {
          settings: {
            ...settings,
            last_commit_sha: latestSha,
            last_synced_at: new Date().toISOString(),
            file_count: blobs.length,
          }
        })

        return handleCORS(NextResponse.json({
          success: true,
          updated: true,
          message: `Synced to ${latestSha.slice(0, 8)}: ${createdCount} new, ${updatedCount} updated files`,
          commit_sha: latestSha,
          previous_sha: storedSha,
          files_created: createdCount,
          files_updated: updatedCount,
        }))

      } catch (err) {
        console.error('[GitHub Sync] Error:', err)
        return handleCORS(NextResponse.json({ error: `Sync failed: ${err.message}` }, { status: 500 }))
      }
    }

    // ============ PROJECT IMPORT (ZIP UPLOAD) ============

    if (route === '/import/upload' && method === 'POST') {
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      let dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      try {
        const formData = await request.formData()
        const file = formData.get('file')

        if (!file || typeof file === 'string') {
          return handleCORS(NextResponse.json({ error: 'No file uploaded' }, { status: 400 }))
        }

        const fileName = file.name || 'upload.zip'
        if (!fileName.endsWith('.zip')) {
          return handleCORS(NextResponse.json({ error: 'Only .zip files are supported' }, { status: 400 }))
        }

        const buffer = Buffer.from(await file.arrayBuffer())

        if (buffer.length === 0) {
          return handleCORS(NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 }))
        }

        // Parse ZIP
        let zip
        try {
          zip = await JSZip.loadAsync(buffer)
        } catch (e) {
          return handleCORS(NextResponse.json({ error: 'Invalid or corrupted zip file' }, { status: 400 }))
        }

        const fileEntries = Object.keys(zip.files).filter(name => !zip.files[name].dir)

        if (fileEntries.length === 0) {
          return handleCORS(NextResponse.json({ error: 'Zip file is empty — no files found' }, { status: 400 }))
        }

        // Detect common root prefix (e.g., "my-project/src/..." → strip "my-project/")
        let commonPrefix = ''
        if (fileEntries.length > 1) {
          const parts = fileEntries[0].split('/')
          if (parts.length > 1) {
            const candidate = parts[0] + '/'
            const allMatch = fileEntries.every(f => f.startsWith(candidate))
            if (allMatch) commonPrefix = candidate
          }
        }

        // Extract files and detect framework
        const extractedFiles = []
        let packageJson = null
        let entryFile = null
        let framework = 'unknown'
        let detectedLanguage = 'javascript'
        const MAX_FILE_SIZE = 512 * 1024 // 512KB per file
        const SKIP_PATTERNS = ['node_modules/', '.git/', '.DS_Store', '__MACOSX/', 'dist/', 'build/', '.next/']

        for (const filePath of fileEntries) {
          // Skip system/build files
          if (SKIP_PATTERNS.some(p => filePath.includes(p))) continue

          const relativePath = commonPrefix ? filePath.slice(commonPrefix.length) : filePath
          if (!relativePath) continue

          const zipFile = zip.files[filePath]
          let content
          try {
            const raw = await zipFile.async('uint8array')
            if (raw.length > MAX_FILE_SIZE) {
              content = `[file too large: ${(raw.length / 1024).toFixed(0)}KB]`
            } else {
              content = new TextDecoder('utf-8', { fatal: false }).decode(raw)
            }
          } catch {
            content = '[binary file — not extracted]'
          }

          // Detect file type
          const ext = relativePath.split('.').pop()?.toLowerCase() || 'text'
          const fileType = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext) ? 'image'
            : ['woff', 'woff2', 'ttf', 'eot'].includes(ext) ? 'font'
            : 'text'

          extractedFiles.push({ path: relativePath, content, file_type: fileType })

          // Parse package.json for project name and framework detection
          if (relativePath === 'package.json') {
            try {
              packageJson = JSON.parse(content)
            } catch {}
          }

          // Detect entry points
          if (!entryFile) {
            if (['index.html', 'index.js', 'index.tsx', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.tsx'].includes(relativePath)) {
              entryFile = relativePath
            } else if (relativePath === 'app/page.js' || relativePath === 'app/page.tsx' || relativePath === 'pages/index.js' || relativePath === 'pages/index.tsx' || relativePath === 'src/App.jsx' || relativePath === 'src/App.tsx') {
              entryFile = relativePath
            }
          }

          // Detect TypeScript
          if (ext === 'ts' || ext === 'tsx') detectedLanguage = 'typescript'
        }

        if (extractedFiles.length === 0) {
          return handleCORS(NextResponse.json({ error: 'No supported files found in zip after filtering' }, { status: 400 }))
        }

        // Framework detection
        if (packageJson) {
          const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
          if (deps['next']) framework = 'nextjs'
          else if (deps['react']) framework = 'react'
          else if (deps['vue']) framework = 'vue'
          else if (deps['svelte'] || deps['@sveltejs/kit']) framework = 'svelte'
          else if (deps['express'] || deps['fastify'] || deps['koa']) framework = 'node'
          else framework = 'node'
        } else if (extractedFiles.some(f => f.path === 'index.html')) {
          framework = 'static'
        }

        // Derive project name
        const projectName = packageJson?.name
          || fileName.replace('.zip', '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

        // Create project
        const project = await db.projects.create({
          user_id: dbUser.id,
          name: projectName,
          description: packageJson?.description || `Imported from ${fileName}`,
          type: 'app',
          settings: {
            imported: true,
            import_source: 'zip',
            import_filename: fileName,
            framework,
            entry_file: entryFile,
            detected_language: detectedLanguage,
            file_count: extractedFiles.length,
            imported_at: new Date().toISOString(),
          }
        })

        // Create canvas
        await db.projectCanvas.create({
          project_id: project.id,
          canvas_content: {
            project_overview: `Imported from ${fileName} (${framework})`,
            project_goals: [],
            key_decisions: [],
            architecture_notes: [`Framework: ${framework}`, `Entry: ${entryFile || 'unknown'}`, `Language: ${detectedLanguage}`],
            master_prompts: [],
            working_prompts: [],
            failed_prompts: [],
            successful_patterns: [],
            feature_requirements: [],
            technical_specs: packageJson ? [`Dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}`] : [],
            constraints: [],
            open_tasks: [],
            completed_tasks: []
          }
        })

        // Create initial chat
        const initialChat = await db.chats.create({
          project_id: project.id,
          title: 'New Conversation'
        })

        // Store all extracted files
        const fileBatch = extractedFiles.map(f => ({
          project_id: project.id,
          path: f.path,
          content: f.content,
          file_type: f.file_type,
          version: 1,
        }))

        if (fileBatch.length > 0) {
          await db.projectFiles.bulkInsert(fileBatch)
        }

        return handleCORS(NextResponse.json({
          success: true,
          project,
          initialChat,
          metadata: {
            framework,
            entry_file: entryFile,
            detected_language: detectedLanguage,
            file_count: extractedFiles.length,
            project_name: projectName,
          }
        }, { status: 201 }))

      } catch (err) {
        console.error('[Import] Error:', err)
        return handleCORS(NextResponse.json({ error: `Import failed: ${err.message}` }, { status: 500 }))
      }
    }

    // Route not found
    return handleCORS(NextResponse.json(
      { error: `Route ${route} not found` }, 
      { status: 404 }
    ))

  } catch (error) {
    console.error('API Error:', error)
    return handleCORS(NextResponse.json(
      { error: 'Internal server error', details: error.message }, 
      { status: 500 }
    ))
  }
}

// Export all HTTP methods
export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
