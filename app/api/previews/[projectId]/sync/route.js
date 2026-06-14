// ──────────────────────────────────────────────────────────────────────
// POST  /api/previews/:projectId/sync
//
// Trigger a hot file-sync from Supabase → Fly machine WITHOUT restarting
// the dev server. Called after the AI completes a turn that wrote new
// files to the project. The runner pulls fresh files into /project; the
// user's dev server (Vite/CRA/Next) detects the file mtime changes and
// triggers its own HMR. For static-site projects (npx serve), the
// dashboard bumps the iframe key on success to force a hard reload.
//
// This is the "auto-refresh after AI edit" path. Skipped automatically
// when no machine is provisioned yet (no preview = nothing to refresh).
// ──────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser } from '@/lib/api/helpers'
import { findMachineForProject, machineControlUrl } from '@/lib/fly/machines'

export const dynamic = 'force-dynamic'
// 30s is plenty: /sync-from-supabase usually completes in 300-600ms.
// Heavy projects (Mangia-Mama, ~130 files) top out around 1.5s.
export const maxDuration = 30

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

function projectRunnerSecret(projectId) {
  // Must match start/route.js exactly — the runner only accepts requests
  // with this exact secret in the X-Auroraly-Secret header.
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

export async function POST(request, context) {
  const params = await context.params
  const { projectId } = params

  // Auth: dashboard sends the bearer token. We don't need to fetch the
  // project — only the machine lookup is required, and that's keyed by
  // projectId which is in the URL.
  const auth = await getAuthUser(request)
  if (!auth?.user) {
    return handleCORS(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
  }

  let machine = null
  try {
    machine = await findMachineForProject(projectId)
  } catch (err) {
    return handleCORS(NextResponse.json({ error: `machine lookup failed: ${err.message}` }, { status: 500 }))
  }

  if (!machine) {
    // No preview ever started for this project. The dashboard will see
    // this and skip the iframe reload (there's nothing to reload).
    return handleCORS(NextResponse.json({ ok: true, skipped: 'no-machine' }))
  }

  if (machine.state !== 'started') {
    // Machine is stopped/destroyed. Don't try to wake it — that's
    // /start's job. Auto-refresh-on-edit only refreshes machines that
    // are already running.
    return handleCORS(NextResponse.json({ ok: true, skipped: `machine-${machine.state}` }))
  }

  const secret = projectRunnerSecret(projectId)
  const { url, headers } = machineControlUrl(machine)
  const t0 = Date.now()
  try {
    const res = await fetch(`${url}/sync-from-supabase`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Auroraly-Secret': secret },
      body: JSON.stringify({ projectId }),
    })
    const elapsed = Date.now() - t0
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return handleCORS(NextResponse.json({
        ok: false,
        error: `runner sync failed: HTTP ${res.status}`,
        snippet: text.slice(0, 200),
        elapsed,
      }, { status: 502 }))
    }
    const body = await res.json().catch(() => ({}))
    return handleCORS(NextResponse.json({ ok: true, elapsed, written: body.written, total: body.total }))
  } catch (err) {
    return handleCORS(NextResponse.json({
      ok: false,
      error: `runner unreachable: ${err.message}`,
      elapsed: Date.now() - t0,
    }, { status: 502 }))
  }
}
