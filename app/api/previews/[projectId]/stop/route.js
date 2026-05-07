// POST /api/previews/:projectId/stop — graceful dev-server kill + machine stop
import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { findMachineForProject, stopMachine, machineControlUrl } from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'

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

  try {
    const machine = await findMachineForProject(projectId)
    if (!machine) return handleCORS(NextResponse.json({ ok: true, alreadyStopped: true }))

    // Best-effort SIGTERM the user's dev server first so it can clean up.
    if (machine.state === 'started') {
      const { url, headers } = machineControlUrl(machine.id)
      try {
        await fetch(`${url}/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auroraly-Secret': projectRunnerSecret(projectId),
            ...headers,
          },
          body: '{}',
        })
      } catch { /* runner already gone — fine */ }
    }
    // Then ask Fly to stop the machine itself (frees the billable slot).
    await stopMachine(machine.id).catch(() => {})
    return handleCORS(NextResponse.json({ ok: true, machineId: machine.id }))
  } catch (err) {
    return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
