// GET /api/previews/:projectId/logs — proxies the runner's SSE log stream.
//
// We don't buffer or transform — Vercel's edge supports streaming responses
// so the browser sees logs in real time as the dev server emits them.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { findMachineForProject, machineControlUrl } from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

function projectRunnerSecret(projectId) {
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

export async function GET(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return new Response('Unauthorized', { status: 401 })
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return new Response('Access denied', { status: 403 })

  const projectId = params.projectId
  const project = await db.projects.findById(projectId)
  if (!project) return new Response('Project not found', { status: 404 })
  if (project.user_id !== dbUser.id) return new Response('Forbidden', { status: 403 })

  const machine = await findMachineForProject(projectId)
  if (!machine || machine.state !== 'started') {
    // Send a single SSE event then close so the client UI shows
    // "machine not running" instead of hanging.
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ ts: Date.now(), stream: 'orchestrator', line: '[orchestrator] machine not running — start a preview first' })}\n\n`))
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  }

  const { url, headers } = machineControlUrl(machine.id)
  const upstream = await fetch(`${url}/logs`, {
    method: 'GET',
    headers: {
      'X-Auroraly-Secret': projectRunnerSecret(projectId),
      ...headers,
    },
  })
  if (!upstream.ok || !upstream.body) {
    return new Response(`runner /logs failed (${upstream.status})`, { status: 502 })
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
