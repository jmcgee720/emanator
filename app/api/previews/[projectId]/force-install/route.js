// POST /api/previews/:projectId/force-install
//
// Surgical Tailwind recovery for a running preview machine. Kills the
// dev server, installs tailwindcss + postcss + autoprefixer into
// /project/node_modules on the Fly machine, respawns the dev server.
// Way faster than destroy → recreate → full npm install — useful when
// the only thing missing is the Tailwind trio (a known cold-start
// install-skip failure mode).
//
// Idempotent: safe to call repeatedly. The runner /force-install bails
// out cleanly if the trio is already on disk.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { findMachineForProject, machineControlUrl } from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

export async function POST(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const projectId = params.projectId
  const project = await db.projects.findById(projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  }

  const machine = await findMachineForProject(projectId)
  if (!machine || machine.state !== 'started') {
    return handleCORS(NextResponse.json({
      error: 'preview machine is not running — click Start Preview first',
    }, { status: 409 }))
  }

  try {
    const { url, headers } = machineControlUrl(machine)
    const upstream = await fetch(`${url}/force-install`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auroraly-Secret': projectRunnerSecret(projectId),
        ...headers,
      },
      body: '{}',
    })
    const text = await upstream.text()
    let body
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    if (!upstream.ok) {
      return handleCORS(NextResponse.json({
        error: typeof body === 'string' ? body : (body?.error || 'force-install failed'),
      }, { status: upstream.status }))
    }
    return handleCORS(NextResponse.json({
      ok: true,
      message: 'Tailwind trio installed on the preview machine. Wait ~15s for the dev server to respawn, then refresh the iframe.',
      runner: body,
    }))
  } catch (err) {
    return handleCORS(NextResponse.json({ error: err?.message || 'force-install failed' }, { status: 500 }))
  }
}
