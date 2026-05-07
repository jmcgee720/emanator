// ──────────────────────────────────────────────────────────────────────
// Auroraly Preview Runner — per-machine service
// ──────────────────────────────────────────────────────────────────────
// Runs INSIDE a Fly Machine. Hosts exactly one user project at a time.
// The Auroraly orchestrator (running on Vercel) talks to this service
// over HTTPS via Fly's machine-private 6PN network — externally only
// the user's dev server (:3000) is exposed via the wildcard subdomain.
//
// API surface (internal :8080, all auth'd via shared X-Auroraly-Secret):
//   POST /sync     { files: [{path, content}] }     → write into /project
//   POST /start    {}                                → spawn `npm run dev`
//   POST /stop     {}                                → SIGTERM the dev server
//   GET  /status                                     → { running, port, pid }
//   GET  /logs     (SSE)                             → stream stdout/stderr
//   GET  /health                                     → liveness probe
//
// The runner does NOT do any CRA→Vite translation, postcss rewriting,
// CSS bubbling, etc. Those were WebContainer-era hacks. A real Node
// runtime + native esbuild + sharp + everything-just-works means user
// projects run as-is.
// ──────────────────────────────────────────────────────────────────────

import express from 'express'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'

const RUNNER_PORT = parseInt(process.env.RUNNER_PORT || '8080', 10)
const USER_DEV_PORT = parseInt(process.env.USER_DEV_PORT || '3000', 10)
const PROJECT_DIR = '/project'
const SHARED_SECRET = process.env.RUNNER_SHARED_SECRET || ''
const MAX_LOG_LINES = 2000

const logs = []          // ring buffer of {ts, stream, line}
const logEvents = new EventEmitter()
let devProc = null
let installProc = null
let installPromise = null
let lastInstallHash = null

const app = express()
app.use(express.json({ limit: '50mb' })) // user trees can be big

// ─── auth middleware ─────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  if (!SHARED_SECRET) return next() // dev mode
  if (req.get('X-Auroraly-Secret') !== SHARED_SECRET) {
    return res.status(401).json({ error: 'bad secret' })
  }
  next()
})

// ─── helpers ─────────────────────────────────────────────────────────
function appendLog(stream, chunk) {
  const text = chunk.toString()
  for (const line of text.split('\n')) {
    if (!line) continue
    const entry = { ts: Date.now(), stream, line }
    logs.push(entry)
    if (logs.length > MAX_LOG_LINES) logs.shift()
    logEvents.emit('line', entry)
  }
}

function pickDevCommand(pkg) {
  // Prefer dev > start > preview. Fall back to a no-op so we error loudly.
  const scripts = pkg?.scripts || {}
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const isVite = !!deps.vite || /\bvite\b/.test(scripts.dev || '')
  const isNext = !!deps.next || /\bnext\b/.test(scripts.dev || '')

  if (scripts.dev) {
    if (isVite) {
      // Vite v5+ host-check blocks our wildcard `<id>.preview.auroraly.co`.
      // We write a tiny override config that spreads any existing user
      // config and forces `server.allowedHosts: true` + bind 0.0.0.0,
      // then spawn `npx vite --config vite.config.runner.mjs`. We use
      // `npx --no-install` so it picks up the project-local Vite from
      // node_modules rather than fetching a different version.
      return ['npx', ['--no-install', 'vite', '--config', 'vite.config.runner.mjs', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    }
    if (isNext) {
      return ['npx', ['--no-install', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    }
    return ['npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
  }
  if (scripts.start) return ['npm', ['run', 'start']]
  if (scripts.preview) return ['npm', ['run', 'preview']]
  return null
}

/**
 * Detect Vite and write a runner-level config override that allows all
 * hosts (defeats Vite v5's host-check that returns 403 for our wildcard
 * preview subdomains). The override re-exports any existing user config.
 */
async function ensureViteHostOverride(pkg, cwd) {
  const dir = cwd || PROJECT_DIR
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  if (!deps.vite) return false
  const fs = await import('node:fs/promises')
  const candidates = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.cjs']
  let userConfigImport = null
  for (const c of candidates) {
    if (existsSync(join(dir, c))) { userConfigImport = `./${c}`; break }
  }
  // ESM file that imports the user's config (if any) and merges in the
  // server.allowedHosts override. `allowedHosts: true` = allow ALL hosts.
  const body = userConfigImport
    ? `import userConfig from '${userConfigImport}'
import { defineConfig } from 'vite'
const cfg = typeof userConfig === 'function' ? await userConfig({ command: 'serve', mode: 'development' }) : userConfig
export default defineConfig({
  ...cfg,
  server: {
    ...(cfg?.server || {}),
    host: '0.0.0.0',
    port: ${USER_DEV_PORT},
    strictPort: false,
    allowedHosts: true,
    hmr: { ...(cfg?.server?.hmr || {}), clientPort: 443, protocol: 'wss' },
  },
})
`
    : `import { defineConfig } from 'vite'
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: ${USER_DEV_PORT},
    strictPort: false,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
  },
})
`
  await fs.writeFile(join(dir, 'vite.config.runner.mjs'), body, 'utf8')
  appendLog('runner', `[runner] vite host-check override written (allowedHosts: true)`)
  return true
}

/**
 * Find the working directory that contains the project's package.json.
 *
 * Mangia-Mama, Dopples, and other Emergent imports often nest the actual
 * app under `frontend/`, `web/`, `client/`, `apps/web/`, etc. The runner
 * has to detect that and use it as the cwd for npm install + dev spawn.
 *
 * Strategy:
 *   1. If /project/package.json exists with a usable script → use root.
 *   2. Otherwise scan up to 3 levels deep for any package.json with a
 *      `dev`/`start`/`preview` script. Prefer common workspace names
 *      (frontend, web, client, app, apps/web, packages/web).
 *   3. Fallback: first package.json with ANY scripts.
 */
async function resolveProjectCwd() {
  const fs = await import('node:fs/promises')
  const PREFERRED = ['frontend', 'web', 'client', 'app', 'apps/web', 'packages/web']
  const isUsable = (pkg) => {
    const s = pkg?.scripts || {}
    return !!(s.dev || s.start || s.preview)
  }
  const readPkg = async (p) => {
    try { return JSON.parse(await fs.readFile(p, 'utf8')) }
    catch { return null }
  }
  // 1) Root
  const rootPkg = await readPkg(join(PROJECT_DIR, 'package.json'))
  if (rootPkg && isUsable(rootPkg)) return { cwd: PROJECT_DIR, pkg: rootPkg, nested: '' }

  // 2) Preferred workspace paths
  for (const sub of PREFERRED) {
    const full = join(PROJECT_DIR, sub)
    const pkg = await readPkg(join(full, 'package.json'))
    if (pkg && isUsable(pkg)) {
      appendLog('runner', `[runner] detected nested workspace at ${sub}/`)
      return { cwd: full, pkg, nested: sub }
    }
  }

  // 3) Generic walk up to depth 3
  const walk = async (dir, depth) => {
    if (depth > 3) return null
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return null }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const sub = join(dir, e.name)
      const pkg = await readPkg(join(sub, 'package.json'))
      if (pkg && isUsable(pkg)) return { cwd: sub, pkg, nested: sub.replace(PROJECT_DIR + '/', '') }
      const deeper = await walk(sub, depth + 1)
      if (deeper) return deeper
    }
    return null
  }
  const found = await walk(PROJECT_DIR, 1)
  if (found) {
    appendLog('runner', `[runner] detected nested workspace at ${found.nested}/ (deep scan)`)
    return found
  }

  // 4) Last resort: root pkg even if scripts are weak, or nothing.
  if (rootPkg) return { cwd: PROJECT_DIR, pkg: rootPkg, nested: '' }
  return null
}

async function runInstallIfNeeded(workCwd) {
  const cwd = workCwd || PROJECT_DIR
  // Cheap content hash so we don't reinstall on every /start.
  const lockPaths = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
  let key = ''
  for (const p of lockPaths) {
    const full = join(cwd, p)
    if (existsSync(full)) { key += p + ':' + (await (await import('node:fs/promises')).readFile(full, 'utf8')).slice(0, 4096) }
  }
  // Plus package.json for projects without locks.
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) { key += 'pkg:' + (await (await import('node:fs/promises')).readFile(pkgPath, 'utf8')) }
  if (key === lastInstallHash && existsSync(join(cwd, 'node_modules'))) {
    appendLog('runner', '[runner] node_modules cache hit — skipping npm install')
    return
  }
  appendLog('runner', `[runner] running npm install in ${cwd} (this may take 1-2 min on cold start)…`)
  await new Promise((res, rej) => {
    // --legacy-peer-deps bypasses ERESOLVE conflicts on imported CRA apps
    // (react-scripts@5 + react@18 routinely throws peerDep errors that
    // npm@10 treats as fatal without this flag).
    installProc = spawn('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', '--legacy-peer-deps'], {
      cwd,
      env: { ...process.env, CI: '1' },
    })
    installProc.stdout.on('data', d => appendLog('install', d))
    installProc.stderr.on('data', d => appendLog('install', d))
    installProc.on('exit', code => {
      installProc = null
      if (code === 0) { lastInstallHash = key; res() }
      else rej(new Error('npm install exited ' + code))
    })
    installProc.on('error', rej)
  })
}

// ─── routes ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, running: !!devProc, pid: devProc?.pid || null }))

app.get('/status', (_req, res) => {
  res.json({
    running: !!devProc,
    pid: devProc?.pid || null,
    port: USER_DEV_PORT,
    installing: !!installProc,
    logCount: logs.length,
  })
})

app.post('/sync', async (req, res) => {
  const files = req.body?.files
  if (!Array.isArray(files)) return res.status(400).json({ error: 'files[] required' })
  // Wipe existing project tree (but keep node_modules for warm restarts).
  if (existsSync(PROJECT_DIR)) {
    const fs = await import('node:fs/promises')
    for (const entry of await fs.readdir(PROJECT_DIR)) {
      if (entry === 'node_modules') continue
      await rm(join(PROJECT_DIR, entry), { recursive: true, force: true })
    }
  }
  await mkdir(PROJECT_DIR, { recursive: true })
  let written = 0
  for (const f of files) {
    if (!f.path) continue
    const target = resolve(PROJECT_DIR, f.path)
    if (!target.startsWith(PROJECT_DIR + '/') && target !== PROJECT_DIR) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, f.content ?? '', typeof f.content === 'string' ? 'utf8' : undefined)
    written++
  }
  appendLog('runner', `[runner] synced ${written} files`)
  res.json({ ok: true, written })
})

app.post('/start', async (req, res) => {
  if (devProc) return res.json({ ok: true, alreadyRunning: true, pid: devProc.pid, port: USER_DEV_PORT })
  try {
    // Resolve the actual project cwd FIRST — Mangia-Mama and similar
    // imports nest the app under frontend/, web/, etc. We need the right
    // dir for both `npm install` AND the dev spawn.
    const resolved = await resolveProjectCwd()
    if (!resolved) {
      return res.status(400).json({ error: 'no package.json with a dev/start script found anywhere in /project' })
    }
    const { cwd, pkg, nested } = resolved

    if (!installPromise) installPromise = runInstallIfNeeded(cwd).finally(() => { installPromise = null })
    await installPromise

    await ensureViteHostOverride(pkg, cwd)
    const cmd = pickDevCommand(pkg)
    if (!cmd) return res.status(400).json({ error: 'no dev/start/preview script in package.json' })

    appendLog('runner', `[runner] spawning ${cmd[0]} ${cmd[1].join(' ')} in ${nested || '/project'}`)
    devProc = spawn(cmd[0], cmd[1], {
      cwd,
      env: {
        ...process.env,
        PORT: String(USER_DEV_PORT),
        HOST: '0.0.0.0',
        BROWSER: 'none',
        FORCE_COLOR: '0',
        // CRA tries to open a browser by default — kill that. The host
        // check defeats our wildcard subdomain → disable it.
        DANGEROUSLY_DISABLE_HOST_CHECK: 'true',
        WDS_SOCKET_PORT: '443',
      },
    })
    devProc.stdout.on('data', d => appendLog('dev', d))
    devProc.stderr.on('data', d => appendLog('dev', d))
    devProc.on('exit', (code, signal) => {
      appendLog('runner', `[runner] dev server exited code=${code} signal=${signal}`)
      devProc = null
    })
    devProc.on('error', err => appendLog('runner', `[runner] dev spawn error: ${err.message}`))
    res.json({ ok: true, pid: devProc.pid, port: USER_DEV_PORT })
  } catch (err) {
    appendLog('runner', `[runner] start failed: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

app.post('/stop', async (_req, res) => {
  if (!devProc) return res.json({ ok: true, alreadyStopped: true })
  const pid = devProc.pid
  try { devProc.kill('SIGTERM') } catch {}
  setTimeout(() => { try { devProc?.kill('SIGKILL') } catch {} }, 5000)
  res.json({ ok: true, pid })
})

app.get('/logs', (req, res) => {
  // SSE stream. Replays the buffer first, then tails live.
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const send = entry => res.write(`data: ${JSON.stringify(entry)}\n\n`)
  for (const e of logs) send(e)
  const onLine = e => send(e)
  logEvents.on('line', onLine)
  req.on('close', () => logEvents.off('line', onLine))
})

app.listen(RUNNER_PORT, '0.0.0.0', () => {
  appendLog('runner', `[runner] listening on :${RUNNER_PORT} (user dev → :${USER_DEV_PORT})`)
})

// Graceful shutdown so Fly's machine-stop doesn't leave zombies.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    appendLog('runner', `[runner] received ${sig}, shutting down`)
    try { devProc?.kill('SIGTERM') } catch {}
    setTimeout(() => process.exit(0), 1000)
  })
}
