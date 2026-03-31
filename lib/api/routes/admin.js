import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { getUserRole, hasPermission } from '@/lib/constants'

export async function handle(route, method, path, request) {
  // GET /admin/monitored — monitored-user prompts/actions (owner only)
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

  // GET /admin/activity — unified activity feed for admin/owner
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
      if (target.length > 120) target = target.slice(0, 120) + '\u2026'

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

  return null
}
