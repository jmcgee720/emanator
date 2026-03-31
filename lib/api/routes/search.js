import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
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
    
    // Build project_map for UI (id -> {id, name}) from all user projects
    const projectMap = {}
    for (const p of userProjects) {
      projectMap[p.id] = { id: p.id, name: p.name }
    }
    results.project_map = projectMap
    
    return handleCORS(NextResponse.json(results))
  }

  return null
}
