// ──────────────────────────────────────────────────────────────────────
// Fly Machines REST client — per-project app aware
// ──────────────────────────────────────────────────────────────────────
// As of the One-App-Per-Project refactor, every project has its own
// dedicated Fly App (see ./apps.js). Every function in this module is
// scoped to such an app. Machines returned from listMachines /
// findMachineForProject are annotated with `_appName` so callers can
// stop/start/destroy them without juggling the app context.
//
// Backwards-compat: we still read FLY_PREVIEW_APP_NAME from the env to
// (a) resolve the canonical "latest deployed runner image" (we deploy
// the runner to that single shared app via `flyctl deploy`), and (b)
// support lazy migration — findMachineForProject also looks in the
// legacy shared app, so projects that haven't yet been migrated still
// see their old machine on the next start and we can destroy it then.
// ──────────────────────────────────────────────────────────────────────

import { ensurePreviewApp, previewAppName } from './apps.js'

const FLY_API_BASE = 'https://api.machines.dev/v1'

function getEnv() {
  const token = process.env.FLY_API_TOKEN
  const region = process.env.FLY_REGION || 'iad'
  const templateApp = process.env.FLY_PREVIEW_APP_NAME || ''
  if (!token) throw new Error('FLY_API_TOKEN missing — preview infra not configured')
  return { token, region, templateApp }
}

async function flyFetch(path, init = {}) {
  const { token } = getEnv()
  const res = await fetch(`${FLY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = typeof body === 'string' ? body : (body?.error || JSON.stringify(body))
    throw new Error(`fly ${init.method || 'GET'} ${path} → ${res.status}: ${msg}`)
  }
  return body
}

// ─── machine lookup ──────────────────────────────────────────────────
async function listMachinesInApp(appName) {
  try {
    const machines = await flyFetch(`/apps/${appName}/machines`)
    if (!Array.isArray(machines)) return []
    return machines.map(m => ({ ...m, _appName: appName }))
  } catch (err) {
    // App might not exist yet (404). Return empty rather than throw —
    // findMachineForProject will treat "no machines" as "fresh provision".
    if (String(err.message || '').includes('→ 404')) return []
    throw err
  }
}

/**
 * Find the machine for a project. Looks first in the project's dedicated
 * Fly app; falls back to the legacy shared app (for lazy migration) if
 * not found. Returned machine always has `_appName` set so downstream
 * destroy/stop/start calls know where to route.
 *
 * If the result is in the legacy shared app, `_isLegacy = true` and
 * callers should DESTROY the machine (not reuse it) — the next create
 * will provision a fresh machine in the dedicated app.
 */
export async function findMachineForProject(projectId) {
  const dedicated = previewAppName(projectId)
  const dedicatedMachines = await listMachinesInApp(dedicated)
  const found = dedicatedMachines.find(
    m => m?.config?.metadata?.auroraly_project_id === projectId
  )
  if (found) return found

  // Lazy migration: check legacy shared app.
  const { templateApp } = getEnv()
  if (templateApp && templateApp !== dedicated) {
    const legacyMachines = await listMachinesInApp(templateApp).catch(() => [])
    const legacyFound = legacyMachines.find(
      m => m?.config?.metadata?.auroraly_project_id === projectId
    )
    if (legacyFound) {
      return { ...legacyFound, _isLegacy: true }
    }
  }
  return null
}

const REQUIRED_RUNTIME_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PREVIEW_BASE_DOMAIN']
export function isMachineConfigStale(machine) {
  const env = machine?.config?.env || {}
  for (const key of REQUIRED_RUNTIME_ENV) {
    if (!env[key]) return true
  }
  const services = machine?.config?.services || []
  for (const svc of services) {
    if (svc?.internal_port !== 3000) continue
    for (const p of svc?.ports || []) {
      if (p?.port === 443) {
        const handlers = p?.handlers || []
        if (handlers.includes('http')) return true
      }
    }
  }
  return false
}

export function isMachineImageStale(machine, deployedImage) {
  const current = machine?.config?.image
  if (!current || !deployedImage) return false
  return current !== deployedImage
}

export async function destroyMachine(machine) {
  const appName = typeof machine === 'object' ? machine?._appName : null
  const machineId = typeof machine === 'object' ? machine?.id : machine
  if (!appName) throw new Error('destroyMachine: pass the full machine object (need _appName)')
  if (!machineId) throw new Error('destroyMachine: machine.id missing')
  return flyFetch(`/apps/${appName}/machines/${machineId}?force=true`, { method: 'DELETE' })
}

export async function updateMachineEnv(machine, additionalEnv) {
  if (!machine?._appName) throw new Error('updateMachineEnv: machine._appName required')
  const newEnv = { ...(machine?.config?.env || {}), ...additionalEnv }
  const updateBody = { config: { ...machine.config, env: newEnv } }
  return flyFetch(`/apps/${machine._appName}/machines/${machine.id}`, {
    method: 'POST',
    body: JSON.stringify(updateBody),
  })
}

export function freshMachineEnv(projectId, sharedSecret) {
  return {
    RUNNER_SHARED_SECRET: sharedSecret,
    AURORALY_PROJECT_ID: projectId,
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    SUPABASE_BUCKET: 'project-files',
    PREVIEW_BASE_DOMAIN: process.env.PREVIEW_BASE_DOMAIN || 'preview.auroraly.co',
  }
}

// ─── resolve current deployed image ──────────────────────────────────
// The runner is `flyctl deploy`'d into ONE template app (FLY_PREVIEW_APP_NAME).
// Per-project apps don't have their own deploy pipeline — they just borrow
// the image from the template. So image resolution ALWAYS reads from the
// template app, regardless of which project we're creating a machine for.
export async function resolveDeployedImage() {
  const { templateApp } = getEnv()
  if (!templateApp) {
    throw new Error('FLY_PREVIEW_APP_NAME missing — needed to resolve the runner image')
  }
  // 1) Releases API — authoritative, always points at the freshest deploy.
  try {
    const releases = await flyFetch(`/apps/${templateApp}/releases`)
    const list = Array.isArray(releases) ? releases : (releases?.releases || [])
    const sorted = [...list].sort((a, b) => (b?.version || 0) - (a?.version || 0))
    const latest = sorted.find(r => r?.image_ref?.repository)
    if (latest?.image_ref) {
      const r = latest.image_ref
      return `${r.registry}/${r.repository}:${r.tag}`
    }
  } catch { /* fall through */ }

  // 2) Fall back to a template/system machine inside the template app.
  const tmplMachines = await listMachinesInApp(templateApp)
  const template = tmplMachines.find(
    m => m?.config?.image && !(m?.config?.metadata?.auroraly_project_id)
  )
  if (template) return template.config.image
  const anyImage = tmplMachines.find(m => m?.config?.image)
  if (anyImage) return anyImage.config.image

  throw new Error(`no deployed image found in template app ${templateApp} — run \`fly deploy\` first`)
}

// ─── boot a fresh machine for a project ──────────────────────────────
export async function createMachineForProject(projectId, sharedSecret) {
  const { region } = getEnv()
  // Ensure the project's dedicated app exists before creating a machine in it.
  const appName = await ensurePreviewApp(projectId)
  const image = await resolveDeployedImage()
  const body = {
    region,
    config: {
      image,
      auto_destroy: false,
      restart: { policy: 'no' },
      env: {
        RUNNER_SHARED_SECRET: sharedSecret,
        AURORALY_PROJECT_ID: projectId,
        SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        SUPABASE_BUCKET: 'project-files',
        PREVIEW_BASE_DOMAIN: process.env.PREVIEW_BASE_DOMAIN || 'preview.auroraly.co',
      },
      services: [
        {
          ports: [
            { port: 80, handlers: ['http'], force_https: true },
            // ['tls'] only (no 'http' multiplex) — Fly's http handler
            // breaks WebSocket Upgrade with 502. Letting the runner's
            // Node server parse protocol is the standard recommendation.
            { port: 443, handlers: ['tls'] },
          ],
          protocol: 'tcp',
          internal_port: 3000,
          autostop: 'off',
          autostart: false,
        },
        {
          ports: [{ port: 8443, handlers: ['tls', 'http'] }],
          protocol: 'tcp',
          internal_port: 8080,
          autostop: 'off',
          autostart: false,
        },
      ],
      guest: { cpu_kind: 'shared', cpus: 2, memory_mb: 2048 },
      metadata: {
        auroraly_project_id: projectId,
        auroraly_kind: 'preview-runner',
      },
    },
  }
  const created = await flyFetch(`/apps/${appName}/machines`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { ...created, _appName: appName }
}

// ─── start/stop/wait ─────────────────────────────────────────────────
export async function startMachine(machine) {
  const appName = typeof machine === 'object' ? machine?._appName : null
  const machineId = typeof machine === 'object' ? machine?.id : machine
  if (!appName) throw new Error('startMachine: machine._appName required')
  return flyFetch(`/apps/${appName}/machines/${machineId}/start`, { method: 'POST' })
}

export async function stopMachine(machine) {
  const appName = typeof machine === 'object' ? machine?._appName : null
  const machineId = typeof machine === 'object' ? machine?.id : machine
  if (!appName) throw new Error('stopMachine: machine._appName required')
  return flyFetch(`/apps/${appName}/machines/${machineId}/stop`, { method: 'POST' })
}

export async function waitForMachineState(machine, state = 'started', timeoutMs = 60_000) {
  const appName = machine?._appName
  if (!appName) throw new Error('waitForMachineState: machine._appName required')
  const perCallSecs = Math.min(60, Math.max(1, Math.ceil(timeoutMs / 1000)))
  const totalSecs = Math.ceil(timeoutMs / 1000)
  const startedAt = Date.now()
  let last
  for (let elapsed = 0; elapsed < totalSecs; elapsed += perCallSecs) {
    const remaining = Math.min(perCallSecs, totalSecs - elapsed)
    const url = `/apps/${appName}/machines/${machine.id}/wait?state=${encodeURIComponent(state)}&timeout=${remaining}`
    try {
      last = await flyFetch(url)
      if (last?.ok) return last
    } catch (err) {
      if (!String(err.message || '').match(/408|timeout/i)) throw err
    }
    if (Date.now() - startedAt >= timeoutMs) break
  }
  return last || { ok: false, reason: 'wait timeout' }
}

// ─── public hostnames for the iframe ─────────────────────────────────
/**
 * The user-facing dev-server URL.
 *
 * Each project has its own dedicated Fly App, so `<app>.fly.dev`
 * routes deterministically to the (sole) machine inside that app.
 * No machineId suffix, no fly-replay, no edge ambiguity.
 *
 * The second arg is kept for call-site compatibility but ignored.
 */
export function publicDevUrl(projectId, _machineId) {
  return `https://${previewAppName(projectId)}.fly.dev`
}

/**
 * The orchestrator's control-plane URL into a project's machine.
 *
 * Routes via `<app>.fly.dev/__runner__` on STANDARD :443 so we avoid
 * any non-standard-port edge cases (Vercel egress, intermediate
 * proxies, IPv6-only routes that don't expose :8443). The runner's
 * :3000-bound pass-through proxy strips the `/__runner__` prefix and
 * forwards to the Express control plane on :8080 internal.
 *
 * Each app has only one machine, so no Fly-Force-Instance-Id needed.
 */
export function machineControlUrl(machine) {
  // Accept either a machine object (preferred) or a bare id (legacy).
  if (typeof machine === 'object' && machine?._appName) {
    return { url: `https://${machine._appName}.fly.dev/__runner__`, headers: {} }
  }
  // Bare-id fallback — only safe when the caller is sure about which
  // app. Used by diagnose route until we plumb the machine object there.
  throw new Error('machineControlUrl: pass the full machine object (need _appName)')
}
