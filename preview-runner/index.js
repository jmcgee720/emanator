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

/**
 * Pick the actual dev command to spawn. Returns [bin, args].
 *
 * Order of preference:
 *   1. scripts.dev / scripts.start / scripts.preview from package.json
 *      — but ONLY if the binary they reference actually exists in
 *      node_modules/.bin (some imported projects, like Mangia-Mama,
 *      reference `craco start` but never declared `@craco/craco` as a
 *      dep, so npm install succeeds and `npm run start` then dies with
 *      `craco: not found`).
 *   2. Framework-aware fallback based on dependencies:
 *      vite → npx vite, next → npx next dev, react-scripts → react-scripts start.
 */
function pickDevCommand(pkg, cwd) {
  const scripts = pkg?.scripts || {}
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const isVite = !!deps.vite || /\bvite\b/.test(scripts.dev || '')
  const isNext = !!deps.next
  const isCRA = !!deps['react-scripts']

  const binDir = cwd ? join(cwd, 'node_modules', '.bin') : null
  const binExists = (name) => !!binDir && existsSync(join(binDir, name))

  // Helper: does the given npm script reference only binaries that exist?
  // Pulls the FIRST word of the first command in the script (stripping
  // env-prefix shenanigans like `BROWSER=none craco start`).
  const scriptIsRunnable = (script) => {
    if (!script) return false
    const stripped = script.replace(/^(\s*[A-Z_][A-Z0-9_]*=\S+\s+)+/, '').trim()
    const firstWord = stripped.split(/\s+/)[0]
    if (!firstWord) return false
    // Built-in shell builtins / common system binaries → always runnable.
    if (/^(node|npm|npx|yarn|pnpm)$/.test(firstWord)) return true
    return binExists(firstWord)
  }

  if (scripts.dev) {
    if (isVite) {
      return ['npx', ['--no-install', 'vite', '--config', 'vite.config.runner.mjs', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    }
    if (isNext) {
      return ['npx', ['--no-install', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    }
    if (scriptIsRunnable(scripts.dev)) {
      return ['npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
    }
  }
  if (scripts.start) {
    if (scriptIsRunnable(scripts.start)) {
      return ['npm', ['run', 'start']]
    }
    // Script declared but binary missing — try framework fallback.
    appendLog('runner', `[runner] scripts.start (${scripts.start}) refers to a missing binary, falling back to framework default`)
  }
  if (scripts.preview && scriptIsRunnable(scripts.preview)) {
    return ['npm', ['run', 'preview']]
  }

  // ─── framework-aware fallback ──────────────────────────────────────
  // If the package looks like CRA / Vite / Next.js and the package's
  // own scripts are broken (missing dep), spawn the canonical binary
  // directly. This rescues projects with stale "start": "craco start"
  // scripts where craco was never declared.
  if (isVite && binExists('vite')) {
    return ['npx', ['--no-install', 'vite', '--config', 'vite.config.runner.mjs', '--host', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
  }
  if (isNext && binExists('next')) {
    return ['npx', ['--no-install', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(USER_DEV_PORT)]]
  }
  if (isCRA && binExists('react-scripts')) {
    return ['npx', ['--no-install', 'react-scripts', 'start']]
  }
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
  // We also set Cross-Origin-Resource-Policy + Cross-Origin-Embedder-Policy
  // headers so the auroraly.co dashboard (which sets COEP=credentialless
  // for WebContainers) can embed this iframe without Firefox's "security
  // configuration doesn't match" block.
  const COEP_HEADERS = `      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      // also send a permissive frame-ancestors so we're embeddable.
      'Content-Security-Policy': "frame-ancestors *",`
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
    headers: {
      ...(cfg?.server?.headers || {}),
${COEP_HEADERS}
    },
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
    headers: {
${COEP_HEADERS}
    },
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

  // Patch missing craco — Emergent-shaped imports (Mangia-Mama et al)
  // ship `craco.config.js` + `scripts.start = "craco start"` but never
  // declare `@craco/craco` as a dependency. Detect that pattern and
  // install craco as a sidecar so the project's webpack alias config
  // (`@/` → `src/`) actually applies and JSX imports compile.
  //
  // Without this fix the runner's own framework-fallback would spawn
  // `react-scripts start` directly — which compiles but FAILS on every
  // `import "@/components/..."` because vanilla CRA doesn't honor the
  // jsconfig.json paths for webpack resolution.
  try {
    const fs = await import('node:fs/promises')
    const cracoCfg = join(cwd, 'craco.config.js')
    const pkgRaw = await fs.readFile(pkgPath, 'utf8').catch(() => null)
    if (pkgRaw && existsSync(cracoCfg)) {
      const pkg = JSON.parse(pkgRaw)
      const usesCraco = /\bcraco\b/.test(pkg.scripts?.start || '') || /\bcraco\b/.test(pkg.scripts?.dev || '')
      const cracoBin = join(cwd, 'node_modules', '.bin', 'craco')
      if (usesCraco && !existsSync(cracoBin)) {
        appendLog('runner', '[runner] craco.config.js present + craco scripted but @craco/craco not installed — adding sidecar dep so @/-aliases resolve')
        await new Promise((res, rej) => {
          const p = spawn('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--legacy-peer-deps', '@craco/craco'], { cwd, env: { ...process.env, CI: '1' } })
          p.stdout.on('data', d => appendLog('install', d))
          p.stderr.on('data', d => appendLog('install', d))
          p.on('exit', code => code === 0 ? res() : rej(new Error('craco sidecar install exited ' + code)))
          p.on('error', rej)
        }).catch((err) => {
          // Best-effort — if it fails, the runner's react-scripts fallback
          // still kicks in. The user gets a worse rendering (alias errors)
          // but not a hard "preview won't start" failure.
          appendLog('runner', `[runner] craco sidecar install failed: ${err.message} — falling back to vanilla react-scripts`)
        })
      }
    }
  } catch (err) {
    appendLog('runner', `[runner] craco-detection skipped: ${err.message}`)
  }
}

// ─── routes ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, running: !!devProc, pid: devProc?.pid || null }))

app.get('/status', (_req, res) => {
  res.json({
    running: !!devProc,
    pid: devProc?.pid || null,
    port: USER_DEV_PORT,
    installing: !!installProc,
    starting: startInFlight,
    error: lastStartError,
    logCount: logs.length,
  })
})

app.post('/sync-from-supabase', async (req, res) => {
  // Direct Supabase pull — bypasses Vercel's 60s function timeout.
  // Vercel just calls us with { projectId, runnerSecret }; we fetch all
  // files (table rows + storage_path bodies) in parallel using our own
  // env-injected service-role key. Replaces the body-heavy /sync flow
  // for projects > ~50 files or with binary assets.
  const projectId = req.body?.projectId || process.env.AURORALY_PROJECT_ID
  if (!projectId) return res.status(400).json({ error: 'projectId required' })
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_BUCKET || 'project-files'
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase env vars not set on this Fly machine' })
  }
  const t0 = Date.now()

  // 1) List rows. Page through to handle projects >1000 files.
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  const allRows = []
  for (let offset = 0; ; offset += 1000) {
    const url = `${supabaseUrl}/rest/v1/project_files?project_id=eq.${projectId}&select=path,content,storage_path&order=path.asc&offset=${offset}&limit=1000`
    const r = await fetch(url, { headers })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      return res.status(502).json({ error: `Supabase REST returned ${r.status}: ${txt.slice(0, 200)}` })
    }
    const batch = await r.json()
    allRows.push(...batch)
    if (batch.length < 1000) break
  }
  appendLog('runner', `[sync-from-supabase] listed ${allRows.length} rows in ${Date.now() - t0}ms`)

  // 2) Wipe existing project tree (keep node_modules for warm restarts).
  if (existsSync(PROJECT_DIR)) {
    const fs = await import('node:fs/promises')
    for (const entry of await fs.readdir(PROJECT_DIR)) {
      if (entry === 'node_modules') continue
      await rm(join(PROJECT_DIR, entry), { recursive: true, force: true })
    }
  }
  await mkdir(PROJECT_DIR, { recursive: true })

  // 3) Resolve content (parallel storage downloads) and write to disk.
  let written = 0
  let decodedAssets = 0
  let storageDownloads = 0
  const limit = 12 // parallel storage downloads
  let cursor = 0
  async function workOne() {
    while (cursor < allRows.length) {
      const idx = cursor++
      const row = allRows[idx]
      if (!row.path) continue
      let body = row.content || ''
      if (!body && row.storage_path) {
        const dl = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(row.storage_path)}`, { headers })
        if (!dl.ok) {
          appendLog('runner', `[sync-from-supabase] download failed for ${row.path}: ${dl.status}`)
          continue
        }
        body = await dl.text()
        storageDownloads++
      }
      const target = resolve(PROJECT_DIR, row.path)
      if (!target.startsWith(PROJECT_DIR + '/') && target !== PROJECT_DIR) continue
      await mkdir(dirname(target), { recursive: true })

      // Decode data: URIs back to binary (same logic as /sync).
      let content = body
      let encoding = 'utf8'
      const m = typeof content === 'string'
        ? content.match(/^data:[a-zA-Z0-9+\-./]+;base64,(.+)$/s)
        : null
      if (m) {
        content = Buffer.from(m[1], 'base64')
        encoding = undefined
        decodedAssets++
      }
      await writeFile(target, content, encoding)
      written++
    }
  }
  await Promise.all(Array.from({ length: limit }, workOne))

  const ms = Date.now() - t0
  appendLog('runner', `[sync-from-supabase] wrote ${written} files (${decodedAssets} binary, ${storageDownloads} storage downloads) in ${ms}ms`)
  res.json({ ok: true, written, decodedAssets, storageDownloads, ms })
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
  let decodedAssets = 0
  for (const f of files) {
    if (!f.path) continue
    const target = resolve(PROJECT_DIR, f.path)
    if (!target.startsWith(PROJECT_DIR + '/') && target !== PROJECT_DIR) continue
    await mkdir(dirname(target), { recursive: true })

    // Files whose content is a `data:image/...;base64,...` URI need to
    // be decoded back to BINARY before writing. Auroraly stores binary
    // assets (PNG/JPG/SVG/GIF/etc) as data URIs in project_files.content
    // — when imported projects ship sprites/audio files this way, Phaser
    // (or any browser request) would otherwise download the literal
    // text 'data:image/png;base64,iVBOR...' and fail to parse as image.
    let content = f.content ?? ''
    let encoding = typeof content === 'string' ? 'utf8' : undefined
    if (typeof content === 'string') {
      const m = content.match(/^data:[a-zA-Z0-9+\-./]+;base64,(.+)$/s)
      if (m) {
        content = Buffer.from(m[1], 'base64')
        encoding = undefined
        decodedAssets++
      }
    }
    await writeFile(target, content, encoding)
    written++
  }
  appendLog('runner', `[runner] synced ${written} files (${decodedAssets} binary assets decoded from data URIs)`)
  res.json({ ok: true, written, decodedAssets })
})

// Track the last error from a background install/spawn so /status can surface it.
let lastStartError = null
let startInFlight = false

async function bootDevServerInBackground() {
  if (startInFlight || devProc) return
  startInFlight = true
  lastStartError = null
  try {
    const resolved = await resolveProjectCwd()
    if (!resolved) {
      lastStartError = 'no package.json with a dev/start script found anywhere in /project'
      appendLog('runner', `[runner] start failed: ${lastStartError}`)
      return
    }
    const { cwd, pkg, nested } = resolved

    if (!installPromise) installPromise = runInstallIfNeeded(cwd).finally(() => { installPromise = null })
    await installPromise

    await ensureViteHostOverride(pkg, cwd)
    const cmd = pickDevCommand(pkg, cwd)
    if (!cmd) {
      lastStartError = 'no usable dev/start/preview script and no recognizable framework (vite/next/react-scripts) in node_modules'
      appendLog('runner', `[runner] start failed: ${lastStartError}`)
      return
    }

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
      if (code !== 0 && code !== null) lastStartError = `dev server exited ${code}`
      devProc = null
    })
    devProc.on('error', err => {
      lastStartError = `dev spawn error: ${err.message}`
      appendLog('runner', `[runner] ${lastStartError}`)
    })
  } catch (err) {
    lastStartError = err.message || String(err)
    appendLog('runner', `[runner] start failed: ${lastStartError}`)
  } finally {
    startInFlight = false
  }
}

// /start returns IMMEDIATELY with state=installing. The actual install
// + dev-server spawn runs in the background (npm install for CRA can
// take 3+ minutes, and Vercel's serverless functions cap at 60s — so
// we never want the orchestrator's HTTP call to wait synchronously).
// The orchestrator + frontend poll /status to know when it's ready.
app.post('/start', (req, res) => {
  if (devProc) return res.json({ ok: true, alreadyRunning: true, pid: devProc.pid, port: USER_DEV_PORT })
  if (startInFlight) return res.json({ ok: true, state: 'installing', port: USER_DEV_PORT })
  // Fire-and-forget — but don't crash the runner on unhandled rejection.
  bootDevServerInBackground().catch(err => appendLog('runner', `[runner] background boot crashed: ${err.message}`))
  res.json({ ok: true, state: 'installing', port: USER_DEV_PORT })
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
