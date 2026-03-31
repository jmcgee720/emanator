import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
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

  return null
}
