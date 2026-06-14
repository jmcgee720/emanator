// ──────────────────────────────────────────────────────────────────────
// GET /api/previews/[projectId]/diagnose
// ──────────────────────────────────────────────────────────────────────
// One-shot deep diagnostic for a project's preview machine. Designed
// to be called by the `preview_diagnostics` AI tool so the Auroraly
// chat (both core & project-scoped) can see the same evidence a
// human operator would gather manually:
//
//   • Machine: state, image SHA, image-staleness, config-staleness
//   • Runner /status: running, processAlive, portListening, httpReady,
//     compileLogReady, isCRA, error, buildSha
//   • Public HTTP probe: GET /, status, content-type, body preview
//   • WebSocket probe: HTTP/1.1 Upgrade success/502
//   • Verdict + concrete suggestedFix string (LLM pattern-matches on it)
//
// This is what the AI used to NOT have — it could edit files and Hard
// Reset but had no visibility into runtime state. Now it can read the
// verdict and either fix code, restart the machine, or stop guessing.
// ──────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import {
  findMachineForProject,
  publicDevUrl,
  machineControlUrl,
  resolveDeployedImage,
  isMachineImageStale,
  isMachineConfigStale,
} from '@/lib/fly/machines.js'

const PROBE_TIMEOUT_MS = 8000

function projectRunnerSecret(projectId) {
  // Mirror the derivation in notify-preview.js / start route / runner.
  const seed = process.env.RUNNER_SECRET_SEED || process.env.NEXTAUTH_SECRET || 'auroraly-preview-runner-seed'
  let h = 0
  const s = `${seed}:${projectId}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return `runner-${projectId}-${(h >>> 0).toString(36)}`
}

async function probe(url, headers = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    const text = await res.text().catch(() => '')
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length') || String(text.length),
      server: res.headers.get('server'),
      via: res.headers.get('via'),
      bodyPreview: text.slice(0, 500),
    }
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timeout' : err.message }
  } finally {
    clearTimeout(t)
  }
}

async function probeWebSocketUpgrade(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return {
      status: res.status,
      server: res.headers.get('server'),
      via: res.headers.get('via'),
      verdict: res.status === 101 ? 'ws-ok'
        : res.status === 502 ? 'ws-blocked-at-fly-edge'
        : `ws-rejected-${res.status}`,
    }
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timeout' : err.message, verdict: 'ws-probe-failed' }
  }
}

function makeVerdict(report) {
  // The order of these branches matters — each one is a stronger /
  // more actionable signal than the next, so we surface the most
  // diagnostically useful first.
  const r = report
  if (!r.machine) {
    return ['no-machine', 'Project has no preview machine. The user must click "Start Preview" — that triggers POST /api/previews/[projectId]/start which provisions one.']
  }
  if (r.machine.state !== 'started') {
    return [`machine-${r.machine.state}`, `Machine is in state '${r.machine.state}'. Hard Reset (destroys + recreates) or POST /api/previews/[projectId]/start.`]
  }
  if (r.machine.imageStale) {
    return ['stale-runner-image', `Machine is on image ${r.machine.image} but latest deploy is ${r.machine.deployedImage}. Hard Reset so it picks up the new runner code. The orchestrator should auto-recycle on next /start — if it doesn't, the FLY_API_TOKEN env var in Vercel is likely banned and needs rotation.`]
  }
  if (r.machine.configStale) {
    return ['stale-machine-config', `Machine config is missing required env vars OR has the deprecated ['tls','http'] handler on port 443 (blocks Vite HMR WSS → infinite reload loop → blank screen). Hard Reset will recreate it with the fresh ['tls'] handler.`]
  }
  const s = r.runner?.status
  if (!s) {
    return ['runner-unreachable', `Runner control plane on :8443 didn't return /status (HTTP ${r.runner?.statusHttp}, error: ${r.runner?.statusError}). The runner process may have crashed. Hard Reset.`]
  }
  if (s.installing) {
    return ['still-installing', `npm install is still running (${s.logCount || 0} log lines so far). Wait 1–3 minutes and probe again. Cold-start install for CRA can take 5+ minutes.`]
  }
  if (s.error) {
    return ['dev-server-error', `Runner reports error: ${s.error}. Call get_preview_logs to see the underlying npm install / dev server failure.`]
  }
  if (!s.running) {
    return ['dev-server-not-running', `Gates: processAlive=${s.processAlive}, portListening=${s.portListening}, httpReady=${s.httpReady}, compileLogReady=${s.compileLogReady}. The first false gate identifies the bug. Call get_preview_logs for details.`]
  }
  if (r.websocket?.verdict === 'ws-blocked-at-fly-edge') {
    return ['ws-blocked-at-fly-edge', `Vite HMR WebSocket Upgrade is 502'ing at Fly's edge — Vite then enters an infinite "server connection lost. Polling for restart..." reload loop and the iframe goes blank. Machine config probably still has the deprecated ['tls','http'] handler on port 443. Hard Reset will recreate it with the fixed ['tls'] handler.`]
  }
  if (!r.publicHttp?.ok) {
    return [`public-url-${r.publicHttp?.status || 'failed'}`, `Public preview URL returned HTTP ${r.publicHttp?.status} (server: ${r.publicHttp?.server}, body: ${(r.publicHttp?.bodyPreview || '').slice(0, 200)}). The dev server isn't responding to the iframe's request.`]
  }
  return ['healthy', `Server-side is healthy. Public URL returns ${r.publicHttp.status}, runner.running=true, WebSocket upgrade ${r.websocket.verdict}. If the user sees a blank screen the bug is in the project's RUNTIME React/JS code — call get_browser_console (or ask the user for the browser DevTools console error). The platform cannot fix runtime errors in user source; that requires editing the source code.`]
}

export async function GET(_req, ctx) {
  const params = await ctx.params
  const projectId = params.projectId
  const t0 = Date.now()

  // 1) Machine lookup
  let machine = null
  let machineError = null
  try { machine = await findMachineForProject(projectId) }
  catch (err) { machineError = err.message }

  // 2) Latest deployed image (best-effort)
  let deployedImage = null
  try { deployedImage = await resolveDeployedImage() } catch {}

  const report = {
    projectId,
    timestamp: new Date().toISOString(),
    machine: machine ? {
      id: machine.id,
      state: machine.state,
      image: machine.config?.image,
      deployedImage,
      imageStale: isMachineImageStale(machine, deployedImage),
      configStale: isMachineConfigStale(machine),
      createdAt: machine.created_at,
      region: machine.region,
    } : null,
    machineLookupError: machineError,
    runner: null,
    publicHttp: null,
    websocket: null,
    verdict: null,
    suggestedFix: null,
    elapsedMs: 0,
  }

  // 3) If we have a started machine, gather runtime evidence
  if (machine && machine.state === 'started') {
    const ctrlUrl = machineControlUrl(machine.id)
    const ctrlBase = typeof ctrlUrl === 'string' ? ctrlUrl : ctrlUrl.url
    const ctrlHeaders = typeof ctrlUrl === 'string' ? {} : (ctrlUrl.headers || {})
    const headers = {
      'Fly-Force-Instance-Id': machine.id,
      'X-Auroraly-Secret': projectRunnerSecret(projectId),
      ...ctrlHeaders,
    }
    const [statusProbe, versionProbe, publicProbe] = await Promise.all([
      probe(`${ctrlBase}/status`, headers),
      probe(`${ctrlBase}/version`, headers),
      probe(publicDevUrl(projectId, machine.id)),
    ])
    let statusData = null
    try { statusData = statusProbe.bodyPreview ? JSON.parse(statusProbe.bodyPreview) : null } catch {}
    let versionData = null
    try { versionData = versionProbe.bodyPreview ? JSON.parse(versionProbe.bodyPreview) : null } catch {}
    report.runner = {
      statusHttp: statusProbe.status,
      statusError: statusProbe.error,
      status: statusData,
      version: versionData,
    }
    report.publicHttp = publicProbe
    report.websocket = await probeWebSocketUpgrade(publicDevUrl(projectId, machine.id))
  }

  // 4) Synthesise a verdict the LLM can pattern-match on
  const [verdict, suggestedFix] = makeVerdict(report)
  report.verdict = verdict
  report.suggestedFix = suggestedFix
  report.elapsedMs = Date.now() - t0

  return NextResponse.json(report)
}
