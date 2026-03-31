import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
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

  return null
}
