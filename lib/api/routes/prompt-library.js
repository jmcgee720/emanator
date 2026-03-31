import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'

export async function handle(route, method, path, request) {
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

  return null
}
