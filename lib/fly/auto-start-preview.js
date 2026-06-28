// ──────────────────────────────────────────────────────────────────────
// Auto-start preview for new projects
// ──────────────────────────────────────────────────────────────────────
// Service-level function that starts a preview machine without requiring
// HTTP auth. Called by the agent stream handler after detecting entry-
// point file writes in a project with no existing machine.

import {
  findMachineForProject,
  createMachineForProject,
  startMachine,
  waitForMachineState,
  publicDevUrl,
  machineControlUrl,
} from '@/lib/fly/machines.js'
import { ensurePreviewApp } from '@/lib/fly/apps.js'
import { db } from '@/lib/supabase/db'

/**
 * Per-project shared secret (same derivation as start/route.js)
 */
function projectRunnerSecret(projectId) {
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
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

/**
 * Auto-start a preview machine for a project that has no machine yet.
 * Returns { ok: true, machineId, previewUrl } on success, { ok: false, reason } on failure.
 * Never throws — all errors are surfaced as structured results.
 */
export async function autoStartPreview(projectId) {
  if (!projectId) return { ok: false, reason: 'no-project-id' }
  
  // If Fly isn't configured (local dev, test runs), no-op silently
  if (!process.env.FLY_API_TOKEN || !process.env.FLY_PREVIEW_APP_NAME) {
    return { ok: false, reason: 'fly-not-configured' }
  }
  
  try {
    // Check if a machine already exists
    const existing = await findMachineForProject(projectId)
    if (existing) {
      return { ok: false, reason: 'machine-already-exists', machineId: existing.id }
    }
    
    // Ensure the dedicated app exists with networking
    await ensurePreviewApp(projectId)
    
    // Create and start the machine
    const secret = projectRunnerSecret(projectId)
    const machine = await createMachineForProject(projectId, secret)
    
    // Wait for machine to reach 'started' state
    const waitRes = await waitForMachineState(machine, 'started', 30_000).catch(() => null)
    if (!waitRes?.ok) {
      return { ok: false, reason: 'machine-boot-timeout', machineId: machine.id }
    }
    
    // Wait for runner to bind :8080
    let healthy = false
    for (let i = 0; i < 15; i++) {
      try {
        await callRunner(machine, '/health', { method: 'GET', secret })
        healthy = true
        break
      } catch { await new Promise(r => setTimeout(r, 1000)) }
    }
    
    if (!healthy) {
      return { ok: false, reason: 'runner-not-healthy', machineId: machine.id }
    }
    
    // Sync project files
    try {
      await callRunner(machine, '/sync-from-supabase', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
        secret,
      })
    } catch (err) {
      // Fall back to legacy /sync if /sync-from-supabase is unavailable
      console.warn(`[auto-start] /sync-from-supabase unavailable, falling back to /sync: ${err.message}`)
      const files = await db.projectFiles.findByProjectId(projectId)
      const payload = { files: files.map(f => ({ path: f.path, content: f.content || '' })) }
      await callRunner(machine, '/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
        secret,
      })
    }
    
    // Kick the dev server
    await callRunner(machine, '/start', {
      method: 'POST',
      body: '{}',
      secret,
    })
    
    return {
      ok: true,
      machineId: machine.id,
      previewUrl: publicDevUrl(projectId, machine.id),
    }
  } catch (err) {
    console.error(`[auto-start] failed for project ${projectId}:`, err)
    return { ok: false, reason: err.message || 'unknown-error' }
  }
}
