import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { getUserRole, hasPermission, VALID_ROLES, ROLES } from '@/lib/constants'

export async function handle(route, method, path, request) {
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

  return null
}
