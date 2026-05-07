// ──────────────────────────────────────────────────────────────────────
// POST   /api/previews/:projectId/start  → boot Fly machine, sync files,
//                                           kick npm install + dev server
// GET    /api/previews/:projectId/start  → poll current status (idempotent)
// ──────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import {
  findMachineForProject,
  createMachineForProject,
  startMachine,
  waitForMachineState,
  publicDevUrl,
  machineControlUrl,
} from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // npm install can take a while on cold start

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

/**
 * Per-project shared secret the orchestrator uses to talk to its
 * dedicated runner. Stored in the machine's env at create time and
 * cached server-side. Derived deterministically from project id +
 * server secret so we don't need a separate DB column.
 */
function projectRunnerSecret(projectId) {
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  // Cheap HMAC-ish: not cryptographically critical (machine env is
  // already private), just needs to be stable + un-guessable.
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

async function callRunner(machineId, path, init = {}) {
  const { url, headers } = machineControlUrl(machineId)
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Auroraly-Secret': init.secret,
      ...headers,
      ...(init.headers || {}),
    },
    body: init.body,
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new Error(`runner ${path} → ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  return body
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
    // 1) Find or create the machine for this project.
    const secret = projectRunnerSecret(projectId)
    let machine = await findMachineForProject(projectId)
    if (!machine) {
      machine = await createMachineForProject(projectId, secret)
    } else if (machine.state !== 'started') {
      await startMachine(machine.id)
    }

    // 2) Wait until the runner is reachable. Fly's wait endpoint is the
    //    cheapest signal; we still poll /health to confirm Express is up.
    await waitForMachineState(machine.id, 'started', 60_000).catch(() => {})
    let healthy = false
    for (let i = 0; i < 30; i++) {
      try {
        await callRunner(machine.id, '/health', { method: 'GET', secret })
        healthy = true
        break
      } catch { await new Promise(r => setTimeout(r, 1000)) }
    }
    if (!healthy) throw new Error('runner failed to become healthy within 30s')

    // 3) Sync the project files.
    const files = await db.projectFiles.findByProjectId(projectId)
    const payload = {
      files: files.map(f => ({ path: f.path, content: f.content || '' })),
    }
    await callRunner(machine.id, '/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
      secret,
    })

    // 4) Spawn the dev server (idempotent: returns immediately if running).
    await callRunner(machine.id, '/start', {
      method: 'POST',
      body: '{}',
      secret,
    })

    return handleCORS(NextResponse.json({
      ok: true,
      machineId: machine.id,
      state: 'starting',
      previewUrl: publicDevUrl(projectId),
    }))
  } catch (err) {
    console.error(`[/api/previews/${projectId}/start] failed:`, err)
    return handleCORS(NextResponse.json({ error: err.message || 'preview start failed' }, { status: 500 }))
  }
}

export async function GET(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const projectId = params.projectId
  try {
    const machine = await findMachineForProject(projectId)
    if (!machine) {
      return handleCORS(NextResponse.json({ ok: true, exists: false, state: 'idle' }))
    }
    let runnerStatus = null
    if (machine.state === 'started') {
      try {
        runnerStatus = await callRunner(machine.id, '/status', {
          method: 'GET',
          secret: projectRunnerSecret(projectId),
        })
      } catch { /* runner not ready yet */ }
    }
    return handleCORS(NextResponse.json({
      ok: true,
      exists: true,
      machineId: machine.id,
      state: machine.state,
      runner: runnerStatus,
      previewUrl: publicDevUrl(projectId),
    }))
  } catch (err) {
    return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
