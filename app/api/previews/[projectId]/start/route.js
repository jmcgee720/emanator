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
  isMachineConfigStale,
  isMachineImageStale,
  resolveDeployedImage,
  destroyMachine,
  updateMachineEnv,
  freshMachineEnv,
} from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'
export const maxDuration = 800 // npm install + Fly boot can take a while on cold start (Vercel Fluid Compute max)

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

async function callRunner(machine, path, init = {}) {
  const { url, headers } = machineControlUrl(machine)
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
    //    Post-One-App-Per-Project: findMachineForProject looks in the
    //    project's dedicated Fly app first, falls back to the legacy
    //    shared app (with `_isLegacy = true`) for lazy migration.
    const secret = projectRunnerSecret(projectId)
    let machine = await findMachineForProject(projectId)
    let createdNew = false

    // Lazy migration: if we found a machine in the legacy shared app,
    // destroy it. The next-line "if (!machine)" block then provisions a
    // fresh machine in the project's dedicated app. One-time cost per
    // project; subsequent starts hit the dedicated app directly.
    if (machine?._isLegacy) {
      console.log(`[start] project ${projectId} has a legacy machine ${machine.id} in shared app ${machine._appName} — destroying for migration to dedicated app`)
      await destroyMachine(machine).catch((err) => {
        console.warn(`[start] legacy destroy failed (non-fatal): ${err.message}`)
      })
      machine = null
    }

    // Stale-image check: if a new runner image was deployed, the
    // existing machine still pins the old image. Destroy + recreate.
    try {
      if (machine) {
        try {
          const deployedImage = await resolveDeployedImage()
          if (isMachineImageStale(machine, deployedImage)) {
            console.log(`[start] machine ${machine.id} runs stale image ${machine.config?.image} (deployed: ${deployedImage}) — destroying to pick up new runner code`)
            await destroyMachine(machine).catch((err) => {
              console.warn(`[start] destroy of stale-image machine failed: ${err.message}`)
            })
            machine = null
          }
        } catch (imgErr) {
          console.warn(`[start] image-staleness check failed: ${imgErr.message} — leaving existing machine in place`)
        }
      }
      if (machine && isMachineConfigStale(machine)) {
        console.log(`[start] machine ${machine.id} for project ${projectId} has stale env — attempting in-place update`)
        try {
          await updateMachineEnv(machine, freshMachineEnv(projectId, secret))
          const settled = await waitForMachineState(machine, 'started', 30_000).catch(() => null)
          if (settled?.ok) {
            machine.state = settled.state || 'started'
            machine.config = { ...machine.config, env: { ...machine.config.env, ...freshMachineEnv(projectId, secret) } }
            console.log(`[start] in-place env update succeeded — preserving node_modules cache`)
          } else {
            throw new Error(`machine did not reach 'started' after env update (state=${settled?.state || 'unknown'})`)
          }
        } catch (err) {
          console.warn(`[start] in-place env update failed (${err.message}) — falling back to destroy/recreate`)
          await destroyMachine(machine).catch((destroyErr) => {
            console.warn(`[start] destroy failed: ${destroyErr.message}`)
          })
          machine = null
        }
      }
    } catch (staleCheckErr) {
      console.warn(`[start] stale-check itself threw: ${staleCheckErr.message} — proceeding with existing machine`)
    }
    if (!machine) {
      machine = await createMachineForProject(projectId, secret)
      createdNew = true
    } else if (machine.state !== 'started') {
      const transitional = ['stopping', 'starting', 'created']
      if (transitional.includes(machine.state)) {
        const target = machine.state === 'stopping' ? 'stopped' : 'started'
        const settled = await waitForMachineState(machine, target, 30_000).catch(() => null)
        if (settled?.ok && settled.state) machine.state = settled.state
      }
      if (machine.state === 'stopped') {
        await startMachine(machine)
      }
    }

    // 2) Wait briefly for the machine to be `started`.
    const waitRes = await waitForMachineState(machine, 'started', 30_000).catch(() => null)
    const machineStarted = waitRes?.ok || (machine.state === 'started' && !createdNew)

    if (!machineStarted) {
      // Machine still booting — frontend polls GET /start until ready.
      return handleCORS(NextResponse.json({
        ok: true,
        machineId: machine.id,
        state: 'booting-machine',
        previewUrl: publicDevUrl(projectId, machine.id),
      }))
    }

    // 3) Quick health-check — give the runner up to 15s to bind :8080.
    let healthy = false
    for (let i = 0; i < 15; i++) {
      try {
        await callRunner(machine, '/health', { method: 'GET', secret })
        healthy = true
        break
      } catch { await new Promise(r => setTimeout(r, 1000)) }
    }

    if (!healthy) {
      // Runner not up yet — frontend polls.
      return handleCORS(NextResponse.json({
        ok: true,
        machineId: machine.id,
        state: 'booting-runner',
        previewUrl: publicDevUrl(projectId, machine.id),
      }))
    }

    // 4) Sync project files. Use the runner's /sync-from-supabase fast
    //    path: Vercel sends only { projectId } and the runner pulls
    //    everything in parallel from Supabase using its own creds. The
    //    old /sync (body-heavy) path was timing out Vercel's 60s
    //    function ceiling on big projects (Mangia-Mama: 130 files,
    //    ~13MB JSON payload after binary asset resolution).
    try {
      await callRunner(machine, '/sync-from-supabase', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
        secret,
      })
    } catch (err) {
      // Older runner image without the new endpoint — fall back to the
      // legacy /sync path so we don't hard-fail during the rolling
      // deploy window.
      console.warn(`[start] /sync-from-supabase unavailable, falling back to /sync: ${err.message}`)
      const files = await db.projectFiles.findByProjectId(projectId)
      const payload = { files: files.map(f => ({ path: f.path, content: f.content || '' })) }
      await callRunner(machine, '/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
        secret,
      })
    }

    // 5) Kick the runner's /start. The runner returns IMMEDIATELY now —
    //    it spawns npm install + dev server in its own background task,
    //    so this call never blocks. Frontend polls GET /start (which hits
    //    runner /status) until runner.running === true.
    await callRunner(machine, '/start', {
      method: 'POST',
      body: '{}',
      secret,
    })

    return handleCORS(NextResponse.json({
      ok: true,
      machineId: machine.id,
      state: 'installing',
      previewUrl: publicDevUrl(projectId, machine.id),
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
    if (machine.state !== 'started') {
      // Still booting (or stopped) — frontend keeps polling.
      return handleCORS(NextResponse.json({
        ok: true,
        exists: true,
        machineId: machine.id,
        state: machine.state,
        runner: null,
        previewUrl: publicDevUrl(projectId, machine.id),
      }))
    }

    const secret = projectRunnerSecret(projectId)
    let runnerStatus = null
    try {
      runnerStatus = await callRunner(machine, '/status', { method: 'GET', secret })
    } catch { /* runner not bound yet */ }

    // If the runner is reachable but nothing is in progress, drive the
    // state machine forward: sync files + kick /start. This makes GET
    // idempotent — any poll can heal a stalled boot. Without this, a
    // POST that returned early (Vercel timeout) would leave the runner
    // forever idle on a 'started' machine.
    if (runnerStatus && !runnerStatus.running && !runnerStatus.installing && !runnerStatus.starting) {
      try {
        const files = await db.projectFiles.findByProjectId(projectId)
        await callRunner(machine, '/sync', {
          method: 'POST',
          body: JSON.stringify({ files: files.map(f => ({ path: f.path, content: f.content || '' })) }),
          secret,
        })
        await callRunner(machine, '/start', { method: 'POST', body: '{}', secret })
        // Re-poll status so the response reflects the freshly-kicked state.
        try { runnerStatus = await callRunner(machine, '/status', { method: 'GET', secret }) } catch {}
      } catch (err) {
        runnerStatus = { ...(runnerStatus || {}), error: err.message }
      }
    }

    return handleCORS(NextResponse.json({
      ok: true,
      exists: true,
      machineId: machine.id,
      state: machine.state,
      runner: runnerStatus,
      previewUrl: publicDevUrl(projectId, machine.id),
    }))
  } catch (err) {
    // Log the full stack trace to Vercel function logs so future
    // 500s show up with line numbers instead of just `err.message`.
    // The user-facing JSON still gets the short message.
    console.error('[start] route 500:', {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      cause: err?.cause,
    })
    return handleCORS(NextResponse.json({
      error: err?.message || 'start failed',
      errorType: err?.name || 'Error',
    }, { status: 500 }))
  }
}
