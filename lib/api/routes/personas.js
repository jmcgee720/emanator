import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'

export async function handle(route, method, path, request) {
  if (route === '/personas/create' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    try {
      const body = await request.json()
      if (!body.name || !body.name.trim()) {
        return handleCORS(NextResponse.json({ error: 'name is required' }, { status: 400 }))
      }
      const { personaDb } = await import('@/lib/growth/service')
      const persona = await personaDb.createPersona(dbUser.id, body)
      return handleCORS(NextResponse.json({ persona }, { status: 201 }))
    } catch (err) {
      console.error('[Persona] Create error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to create persona' }, { status: 500 }))
    }
  }

  if (route === '/personas' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    try {
      const { personaDb } = await import('@/lib/growth/service')
      const personas = await personaDb.getPersonas(dbUser.id)
      return handleCORS(NextResponse.json({ personas }))
    } catch (err) {
      console.error('[Persona] List error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to list personas' }, { status: 500 }))
    }
  }

  if (route.match(/^\/personas\/[^/]+$/) && method === 'DELETE') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    const personaId = route.split('/').pop()
    try {
      const { personaDb } = await import('@/lib/growth/service')
      const deleted = await personaDb.deletePersona(personaId, dbUser.id)
      if (!deleted) return handleCORS(NextResponse.json({ error: 'Persona not found' }, { status: 404 }))
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      console.error('[Persona] Delete error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to delete persona' }, { status: 500 }))
    }
  }

  return null
}
