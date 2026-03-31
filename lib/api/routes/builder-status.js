import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  if (route.match(/^\/projects\/[^/]+\/builder-status$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const logs = await db.changelog.findByProject(projectId, 50)
    const total = logs.length
    const applied = logs.filter(l => l.validator_result?.result === 'applied').length
    const rolledBack = logs.filter(l => l.validator_result?.result === 'rolled_back').length
    const discarded = logs.filter(l => l.validator_result?.result === 'discarded').length
    const selfEdits = logs.filter(l => l.validator_result?.chat_type === 'self_edit').length
    const lastBuild = logs[0]?.created_at || null
    return handleCORS(NextResponse.json({ total, applied, rolledBack, discarded, selfEdits, lastBuild }))
  }

  return null
}
