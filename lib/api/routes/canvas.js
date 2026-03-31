import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  if (route.match(/^\/projects\/[^/]+\/canvas$/) && method === 'GET') {
    const projectId = path[1]

    const authUser = await getAuthUser(request)
    if (!authUser) {
      const { cookies: cookiesFn } = await import('next/headers')
      const cookieStore = await cookiesFn()
      const hasSbCookies = cookieStore.getAll().some(c => c.name.includes('sb-'))
      if (!hasSbCookies) {
        return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      }
      console.log('[Canvas GET] Auth cookie present but session expired \u2014 allowing read for project', projectId)
    }

    let canvas = await db.projectCanvas.findByProjectId(projectId)
    
    if (!canvas) {
      try {
        canvas = await db.projectCanvas.create({
          project_id: projectId,
          canvas_content: {
            project_overview: '',
            project_goals: [],
            key_decisions: [],
            architecture_notes: [],
            master_prompts: [],
            working_prompts: [],
            failed_prompts: [],
            successful_patterns: [],
            feature_requirements: [],
            technical_specs: [],
            constraints: [],
            open_tasks: [],
            completed_tasks: []
          }
        })
        console.log('[Canvas GET] Auto-created empty canvas for project', projectId)
      } catch (createErr) {
        canvas = await db.projectCanvas.findByProjectId(projectId)
        if (!canvas) {
          return handleCORS(NextResponse.json({ error: 'Canvas creation failed' }, { status: 500 }))
        }
      }
    }
    
    return handleCORS(NextResponse.json(canvas))
  }

  if (route.match(/^\/projects\/[^/]+\/canvas$/) && method === 'PUT') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const body = await request.json()
    const { canvas_content, change_summary } = body
    
    await db.projectCanvas.update(projectId, canvas_content)
    
    if (change_summary) {
      await db.canvasEvents.create({
        project_id: projectId,
        message_id: body.message_id || null,
        change_summary
      })
    }
    
    return handleCORS(NextResponse.json({ success: true }))
  }

  return null
}
