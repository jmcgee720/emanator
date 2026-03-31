import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
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

  return null
}
