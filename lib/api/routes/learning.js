import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'

export async function handle(route, method, path, request) {
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

  return null
}
