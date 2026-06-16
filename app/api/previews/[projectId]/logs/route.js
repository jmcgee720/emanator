// GET /api/previews/:projectId/logs — proxies the runner's SSE log stream.
//
// Bulletproofed: any error (Fly API failure, fetch crash on a freshly-created
// app whose DNS isn't propagated yet, runner :8080 not bound) is surfaced as
// a single SSE diagnostic event instead of a Next.js 500. A 500 here makes
// the frontend's "Starting your preview..." overlay hang forever; an SSE
// event lets it render the actual problem to the user.

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

// Build an SSE stream that emits one diagnostic line then closes.
// We use this for every "non-streaming" outcome — missing machine, Fly
// API hiccup, fetch failure to a not-yet-DNS-propagated app — so the
// client always sees a clean SSE response (no Next.js 500 page).
function sseDiagnostic(line, stream = 'orchestrator') {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(
        `data: ${JSON.stringify({ ts: Date.now(), stream, line })}\n\n`
      ))
      controller.close()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
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

  // ─── 1) Find the machine — tolerate Fly API hiccups ────────────────
  let machine
  try {
    machine = await findMachineForProject(projectId)
  } catch (err) {
    return sseDiagnostic(`[orchestrator] could not query Fly for project state: ${err.message}`)
  }

  if (!machine || machine.state !== 'started') {
    return sseDiagnostic('[orchestrator] machine not running — start a preview first')
  }

  // ─── 2) Resolve runner URL — tolerate machines missing _appName ────
  let ctrlUrl, ctrlHeaders
  try {
    const ctrl = machineControlUrl(machine)
    ctrlUrl = ctrl.url
    ctrlHeaders = ctrl.headers || {}
  } catch (err) {
    return sseDiagnostic(`[orchestrator] machine ${machine.id} is missing app routing context: ${err.message}. Click Hard Reset to provision a fresh machine.`)
  }

  // ─── 3) Connect to the runner — tolerate DNS-not-yet-propagated ────
  //    A newly-created Fly App can take a few seconds before <app>.fly.dev
  //    resolves and the :8443 service comes online. Before this fix, any
  //    fetch error here propagated as a Next.js 500, which made the
  //    frontend's "Starting your preview..." overlay hang forever.
  let upstream
  try {
    upstream = await fetch(`${ctrlUrl}/logs`, {
      method: 'GET',
      headers: {
        'X-Auroraly-Secret': projectRunnerSecret(projectId),
        ...ctrlHeaders,
      },
    })
  } catch (err) {
    return sseDiagnostic(`[orchestrator] runner not reachable yet (${err.message}). Retrying...`)
  }

  if (!upstream.ok || !upstream.body) {
    return sseDiagnostic(`[orchestrator] runner /logs returned HTTP ${upstream.status}. The runner process may still be booting — try again in a few seconds.`)
  }

  // ─── 4) Happy path — proxy the SSE stream through. ─────────────────
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
