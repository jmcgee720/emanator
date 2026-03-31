import { NextResponse } from 'next/server'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { AIService } from '@/lib/ai/service'
import { ProviderError } from '@/lib/ai/errors'
import { SELF_EDIT_PREFIX, getChatType, getUserRole, hasPermission, VALID_ROLES, ROLES, isMonitored } from '@/lib/constants'
import { handleStreamMessage } from '@/lib/api/stream-handler'
import JSZip from 'jszip'

// Shared helpers
import { handleCORS, getAuthUser, checkAllowlist, initializeOwner } from '@/lib/api/helpers'

// Phase 1 route modules
import * as publicRoutes from '@/lib/api/routes/public'
import * as authRoutes from '@/lib/api/routes/auth'
import * as adminRoutes from '@/lib/api/routes/admin'
import * as exportsRoutes from '@/lib/api/routes/exports'
import * as creditsRoutes from '@/lib/api/routes/credits'
import * as searchRoutes from '@/lib/api/routes/search'
import * as growthRoutes from '@/lib/api/routes/growth'
import * as personasRoutes from '@/lib/api/routes/personas'
import * as importsRoutes from '@/lib/api/routes/imports'
import * as deploymentsRoutes from '@/lib/api/routes/deployments'
import * as snapshotsRoutes from '@/lib/api/routes/snapshots'
import * as generationsRoutes from '@/lib/api/routes/generations'
import * as memoryRoutes from '@/lib/api/routes/memory'
import * as builderStatusRoutes from '@/lib/api/routes/builder-status'
import * as promptLibraryRoutes from '@/lib/api/routes/prompt-library'
import * as learningRoutes from '@/lib/api/routes/learning'

// Allow larger body for file uploads (50MB)
export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } }
}

// Phase 1 module dispatch order (CRITICAL: preserve evaluation order)
const phase1Modules = [
  publicRoutes,
  authRoutes,
  adminRoutes,
  exportsRoutes,       // MUST run before inline projects (handles /projects/import)
  creditsRoutes,
  searchRoutes,
  growthRoutes,
  personasRoutes,
  importsRoutes,
  deploymentsRoutes,
  snapshotsRoutes,
  generationsRoutes,
  memoryRoutes,
  builderStatusRoutes,
  promptLibraryRoutes,
  learningRoutes,
]

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

    // ── Phase 1: Dispatch to extracted modules ──
    for (const mod of phase1Modules) {
      const result = await mod.handle(route, method, path, request)
      if (result) return result
    }

    // ============ ADMIN ROUTES (Phase 2 — inline) ============
    
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
          user_task: `Role changed for user ${userId}: \u2192 ${effectiveRole}`,
          task_mode: 'role_change',
          plan_summary: `Role \u2192 ${effectiveRole}`,
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

    // ============ PROJECT ROUTES (Phase 2 — inline) ============
    
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

    // ============ SANDBOX / WORKSPACE CLONE (Phase 2 — inline) ============

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
          const lines = (sbx.content || '').split('\n').length
          changes.push({ path: p, status: 'create', lines_added: lines, lines_removed: 0 })
        } else if (src && !sbx) {
          const lines = (src.content || '').split('\n').length
          changes.push({ path: p, status: 'delete', lines_added: 0, lines_removed: lines })
        } else if (src && sbx && src.content !== sbx.content) {
          const srcLines = (src.content || '').split('\n')
          const sbxLines = (sbx.content || '').split('\n')
          const srcSet = new Set(srcLines)
          const sbxSet = new Set(sbxLines)
          let added = 0, removed = 0
          for (const l of sbxLines) { if (!srcSet.has(l)) added++ }
          for (const l of srcLines) { if (!sbxSet.has(l)) removed++ }
          changes.push({ path: p, status: 'update', lines_added: added, lines_removed: removed })
        }
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

      if (!settings.is_sandbox) {
        errors.push({ check: 'sandbox_status', message: 'Not a sandbox project' })
      } else if (settings.sandbox_status !== 'active') {
        errors.push({ check: 'sandbox_status', message: `Sandbox status is "${settings.sandbox_status}", expected "active"` })
      }
      checks.push({ name: 'sandbox_status', passed: errors.length === 0 })

      let diffs = []
      try {
        const body = await request.json()
        diffs = body.diffs || []
      } catch {}

      const hasDiffs = diffs.length > 0
      checks.push({ name: 'diff_exists', passed: hasDiffs })
      if (!hasDiffs) {
        errors.push({ check: 'diff_exists', message: 'No pending diffs to validate' })
      }

      let syntaxPassed = true
      for (const file of diffs) {
        const filePath = file.path || file.filename || ''
        const content = file.content || file.newContent || ''

        if (!content.trim()) {
          errors.push({ check: 'syntax', file: filePath, message: 'Empty file content' })
          syntaxPassed = false
          continue
        }

        if (filePath.endsWith('.json')) {
          try {
            JSON.parse(content)
          } catch (e) {
            errors.push({ check: 'syntax', file: filePath, message: `Invalid JSON: ${e.message}` })
            syntaxPassed = false
          }
          continue
        }

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

      let importsPassed = true
      const projectFiles = await db.projectFiles.findByProjectId(projectId)
      const existingPaths = new Set(projectFiles.map(f => f.path))
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
          if (!imp.startsWith('.') && !imp.startsWith('/') && !imp.startsWith('@/')) continue
          let resolved = imp
          if (imp.startsWith('@/')) {
            resolved = imp.replace('@/', '')
          } else if (imp.startsWith('./') || imp.startsWith('../')) {
            continue
          }
          const candidates = [resolved, `${resolved}.js`, `${resolved}.jsx`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.js`, `${resolved}/index.jsx`]
          const found = candidates.some(c => existingPaths.has(c))
          if (!found && !resolved.includes('node_modules')) {
            // Not an error, just a warning
          }
        }
      }
      checks.push({ name: 'imports', passed: importsPassed })

      const passed = errors.length === 0
      const timestamp = new Date().toISOString()
      const result = { passed, errors, checks, timestamp, files_tested: diffs.length }

      try {
        await db.projects.update(projectId, {
          settings: { ...settings, last_test_result: result }
        })
      } catch {}

      return handleCORS(NextResponse.json(result))
    }

    // Promote sandbox -> primary (owner only)
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

      if (!settings.is_sandbox) {
        return handleCORS(NextResponse.json({ error: 'Not a sandbox project' }, { status: 400 }))
      }

      if (settings.sandbox_status !== 'active') {
        return handleCORS(NextResponse.json({ error: `Sandbox status is "${settings.sandbox_status}", must be "active"` }, { status: 400 }))
      }

      const lastTest = settings.last_test_result
      if (!lastTest || !lastTest.passed) {
        return handleCORS(NextResponse.json({ error: 'Last test must pass before promotion. Run "Test Changes" first.' }, { status: 400 }))
      }

      const sandboxFiles = await db.projectFiles.findByProjectId(sandboxId)
      if (sandboxFiles.length === 0) {
        return handleCORS(NextResponse.json({ error: 'Sandbox has no files to promote' }, { status: 400 }))
      }

      const sourceId = settings.sandbox_source_id
      const source = await db.projects.findById(sourceId)
      if (!source) {
        return handleCORS(NextResponse.json({ error: 'Source project no longer exists' }, { status: 404 }))
      }

      const primaryFiles = await db.projectFiles.findByProjectId(sourceId)
      const primaryMap = new Map(primaryFiles.map(f => [f.path, f]))
      const sandboxPathSet = new Set(sandboxFiles.map(f => f.path))

      const snapshot = []
      for (const f of primaryFiles) {
        snapshot.push({ path: f.path, previous_content: f.content, existed_before: true })
      }
      for (const f of sandboxFiles) {
        if (!primaryMap.has(f.path)) {
          snapshot.push({ path: f.path, previous_content: null, existed_before: false })
        }
      }

      await db.projectFiles.deleteByProjectId(sourceId)

      const promoted = sandboxFiles.map(f => ({
        project_id: sourceId,
        path: f.path,
        content: f.content,
        file_type: f.file_type || 'text',
        version: (f.version || 1) + 1,
      }))
      await db.projectFiles.bulkInsert(promoted)

      const now = new Date().toISOString()
      await db.projects.update(sandboxId, {
        settings: { ...settings, sandbox_status: 'promoted', promoted_at: now }
      })

      db.changelog.create({
        project_id: sourceId,
        user_id: dbUser.id,
        user_task: `Sandbox promoted to primary: ${sandbox.name}`,
        task_mode: 'sandbox_promote',
        plan_summary: `Source sandbox: ${sandboxId} \u2192 Target: ${sourceId} | ${sandboxFiles.length} file(s)`,
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

    // Rollback a promoted sandbox
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

      await db.projectFiles.deleteByProjectId(sourceId)

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

      const now = new Date().toISOString()
      await db.projects.update(sandboxId, {
        settings: { ...settings, sandbox_status: 'rolled_back', rolled_back_at: now }
      })

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

    // ============ CHAT ROUTES (Phase 2 — inline) ============
    
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

      const titleLooksSelfEdit = title.startsWith(SELF_EDIT_PREFIX)
      if (titleLooksSelfEdit || is_self_edit) {
        if (!hasPermission(getUserRole(dbUser), 'self_edit')) {
          return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
        }
      }

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
      
      return handleCORS(NextResponse.json({ ...chat, chat_type: getChatType(chat) }, { status: 201 }))
    }

    // Get messages for chat
    if (route.match(/^\/chats\/[^/]+\/messages$/) && method === 'GET') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }

      const chat = await db.chats.findById(chatId)
      if (chat?.title?.startsWith(SELF_EDIT_PREFIX)) {
        const dbUser = await checkAllowlist(authUser.email)
        if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
          return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
        }
      }
      
      const messages = await db.messages.findByChatId(chatId)
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

    // Update message metadata
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


    // ============ STREAMING MESSAGE ENDPOINT (Phase 2 — inline) ============
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
      
      const chat = await db.chats.findById(chatId)
      if (!chat) {
        return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
      }
      
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser) {
        return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
      }

      if (isMonitored(getUserRole(dbUser)) && chat.title?.startsWith(SELF_EDIT_PREFIX)) {
        return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
      }

      if (chat.title?.startsWith(SELF_EDIT_PREFIX) && !hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
      }
      
      const userMessage = await db.messages.create({
        chat_id: chatId,
        project_id: chat.project_id,
        role,
        content,
        metadata
      })
      
      await db.chats.update(chatId, { updated_at: new Date().toISOString() })

      if (role === 'user' && isMonitored(getUserRole(dbUser))) {
        const promptSummary = content.length > 200 ? content.slice(0, 200) + '\u2026' : content
        db.changelog.create({
          project_id: chat.project_id,
          chat_id: chatId,
          user_id: dbUser.id,
          user_task: promptSummary,
          task_mode: 'monitored_prompt',
          plan_summary: `Monitored prompt in chat: ${chat.title || chatId}`,
        }).catch(e => console.warn('[changelog] monitored_prompt write failed:', e.message))
      }
      
      if (role === 'user') {
        try {
          const project = await db.projects.findById(chat.project_id)
          const providerName = metadata.provider || project?.settings?.provider || 'openai'
          const modelName = metadata.model || project?.settings?.model || null

          const aiService = new AIService(providerName, modelName)
          
          const aiResult = await aiService.processMessage({
            projectId: chat.project_id,
            chatId: chatId,
            userMessage: content,
            userId: dbUser.id,
            scope: metadata.scope || undefined
          })
          
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
          
          const userFacingContent = isProviderError
            ? aiError.user_message
            : `I encountered an error while processing your request. Please try again or rephrase your request.`
          
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
      
      await db.chats.delete(chatId)
      
      return handleCORS(NextResponse.json({ success: true }))
    }

    // Rename a chat
    if (route.match(/^\/chats\/[^/]+$/) && method === 'PATCH') {
      const chatId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      const body = await request.json()
      const title = (body.title || '').trim()
      if (!title) {
        return handleCORS(NextResponse.json({ error: 'Title required' }, { status: 400 }))
      }
      await db.chats.update(chatId, { title })
      return handleCORS(NextResponse.json({ success: true, title }))
    }

    // ============ SESSION FORKING (Phase 2 — inline) ============

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
        const sourceChat = await db.chats.findById(chatId)
        if (!sourceChat) {
          return handleCORS(NextResponse.json({ error: 'Source chat not found' }, { status: 404 }))
        }

        const messages = await db.messages.findByChatId(chatId)

        const aiService = new AIService()
        const compressed = aiService.compressContext(messages)
        const summaryText = compressed.length > 0 && compressed[0].role === 'system'
          ? compressed[0].content
          : `[Forked from chat "${sourceChat.title}" with ${messages.length} messages]`

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

        const forkedChat = await db.chats.create({
          project_id: sourceChat.project_id,
          title: `Fork of: ${sourceChat.title}`
        })

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

    // ============ PROJECT FILES ROUTES (Phase 2 — inline) ============
    
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

    // ============ CANVAS ROUTES (Phase 2 — inline) ============
    
    if (route.match(/^\/projects\/[^/]+\/canvas$/) && method === 'GET') {
      const projectId = path[1]

      const authUser = await getAuthUser(request)
      if (!authUser) {
        const { cookies: cookiesFn } = await import('next/headers')
        const cookieStore = await cookiesFn()
        const hasSbCookies = cookieStore.getAll().some(c => c.name.includes('sb-'))
        if (!hasSbCookies) {
          return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
        }
        console.log('[Canvas GET] Auth cookie present but session expired \u2014 allowing read for project', projectId)
      }

      let canvas = await db.projectCanvas.findByProjectId(projectId)
      
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
          canvas = await db.projectCanvas.findByProjectId(projectId)
          if (!canvas) {
            return handleCORS(NextResponse.json({ error: 'Canvas creation failed' }, { status: 500 }))
          }
        }
      }
      
      return handleCORS(NextResponse.json(canvas))
    }

    if (route.match(/^\/projects\/[^/]+\/canvas$/) && method === 'PUT') {
      const projectId = path[1]
      const authUser = await getAuthUser(request)
      if (!authUser) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      
      const body = await request.json()
      const { canvas_content, change_summary } = body
      
      await db.projectCanvas.update(projectId, canvas_content)
      
      if (change_summary) {
        await db.canvasEvents.create({
          project_id: projectId,
          message_id: body.message_id || null,
          change_summary
        })
      }
      
      return handleCORS(NextResponse.json({ success: true }))
    }

    // ============ DESIGN PREFERENCES (Phase 2 — inline) ============

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

    // ============ DIFF / APPLY (Phase 2 — inline) ============

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

      const guardErrors = []
      const normPath = (p) => (p || '').replace(/^\.\//, '').replace(/^\//, '')

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

      for (const diff of approvedFiles) {
        diff.path = normPath(diff.path)
      }
      const serverPaths = new Set(serverDiffFiles.map(f => normPath(f.path)))
      const approvedPaths = new Set(approvedFiles.map(f => f.path))

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

      if (planData && pendingMessage?.metadata?.planData) {
        const { hashPlan: hp } = await import('@/lib/ai/plan-validator.js')
        const clientHash = hp(planData)
        const serverHash = hp(pendingMessage.metadata.planData)
        if (clientHash !== serverHash) {
          guardErrors.push('Plan hash does not match pending diff review context')
        }
      }

      if (planData?.planId && pendingMessage?.metadata?.planId) {
        if (planData.planId !== pendingMessage.metadata.planId) {
          guardErrors.push('STALE_PLAN_OR_DIFF_ID: planId mismatch')
        }
      }

      if (body.diffId && pendingMessage?.metadata?.diffId) {
        if (body.diffId !== pendingMessage.metadata.diffId) {
          guardErrors.push('STALE_PLAN_OR_DIFF_ID: diffId mismatch')
        }
      }

      const existingFiles = await db.projectFiles.findByProjectId(projectId)
      const existingByPath = new Map(existingFiles.map(f => [normPath(f.path), f]))

      for (const diff of approvedFiles) {
        if (diff.action === 'create' && existingByPath.has(diff.path)) {
          guardErrors.push(`"${diff.path}": illegal create \u2014 file already exists`)
        }
        if (diff.action === 'update' && diff.newContent != null) {
          const existing = existingByPath.get(diff.path)
          if (existing && existing.content === diff.newContent) {
            guardErrors.push(`"${diff.path}": no-op update \u2014 content identical to current file`)
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

      if (pendingMessage && !results.diffStatusTransitioned) {
        try {
          await db.messages.update(pendingMessage.id, {
            metadata: { ...pendingMessage.metadata, diffStatus: 'applied' }
          })
        } catch {}
      }

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


    // ============ FILE UPLOAD ROUTES (Phase 2 — inline) ============

    // ============ IMAGE GENERATION (Phase 2 — inline) ============

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

    // Get project assets
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
          const rawName = f.path.replace(/^_(?:generated|uploads)\//, '')
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

    // Get asset content
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

    // Upload files to a project
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
        const MAX_TEXT_SIZE = 512 * 1024
        const MAX_IMAGE_SIZE = 5 * 1024 * 1024
        const MAX_PDF_SIZE = 10 * 1024 * 1024

        const results = []

        for (const file of files) {
          const ext = file.filename.split('.').pop()?.toLowerCase()
          if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
            results.push({ filename: file.filename, error: `Unsupported file type: .${ext}` })
            continue
          }

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
            const buff = Buffer.from(file.data.split(',').pop() || file.data, 'base64')
            textContent = buff.toString('utf-8')
          }

          if (isPdf && file.data) {
            try {
              const buff = Buffer.from(file.data.split(',').pop() || file.data, 'base64')
              const text = buff.toString('utf-8')
              const matches = text.match(/\(([^)]+)\)/g)
              if (matches) {
                extractedText = matches.map(m => m.slice(1, -1)).join(' ').slice(0, 50000)
              }
              if (!extractedText || extractedText.length < 20) {
                extractedText = '[PDF text extraction limited \u2014 binary PDF content]'
              }
            } catch {
              extractedText = '[PDF text could not be extracted]'
            }
          }

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
