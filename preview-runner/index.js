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
  // ESM file that imports the user's config (if any) and merges in
  // `server.allowedHosts: true` so Vite's v5 host-check accepts our
  // wildcard preview subdomains. HMR over wss:443 because Fly's edge
  // upgrades to TLS even when the internal port is plain HTTP.
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
  const fs = await import('node:fs/promises')
  const pkgPath = join(cwd, 'package.json')

  // Drop in .npmrc with legacy-peer-deps=true. React 18 + many libraries
  // routinely break npm@10's strict peer-dep resolution; legacy-peer-deps
  // is the same flag npm itself recommends. Idempotent.
  try {
    const npmrcPath = join(cwd, '.npmrc')
    const desired = 'legacy-peer-deps=true\nfund=false\naudit=false\n'
    const existing = existsSync(npmrcPath) ? await fs.readFile(npmrcPath, 'utf8') : ''
    if (!/legacy-peer-deps\s*=\s*true/.test(existing)) {
      await fs.writeFile(npmrcPath, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + desired, 'utf8')
      appendLog('runner', '[runner] wrote .npmrc with legacy-peer-deps=true')
    }
  } catch {}

  // Cheap content hash so we don't reinstall on every /start. The hash
  // includes the full package.json + all lockfiles; any change → reinstall.
  const lockPaths = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
  let key = ''
  for (const p of lockPaths) {
    const full = join(cwd, p)
    if (existsSync(full)) { key += p + ':' + (await fs.readFile(full, 'utf8')).slice(0, 4096) }
  }
  if (existsSync(pkgPath)) { key += 'pkg:' + (await fs.readFile(pkgPath, 'utf8')) }
  if (key === lastInstallHash && existsSync(join(cwd, 'node_modules'))) {
    appendLog('runner', '[runner] node_modules cache hit — skipping npm install')
    return
  }

  appendLog('runner', `[runner] running npm install in ${cwd} (this may take 1-2 min on cold start)…`)
  await new Promise((res, rej) => {
    installProc = spawn('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'], {
      cwd,
      // Force NODE_ENV=development so npm installs `devDependencies`.
      // Fly auto-sets NODE_ENV=production on Node containers, which
      // makes npm silently skip devDeps even when --production is not
      // passed. Without this override we'd see `next` install fine but
      // tailwindcss/postcss/autoprefixer go missing → PostCSS chain
      // dies at boot with `require.resolve('tailwindcss')` throwing.
      env: { ...process.env, CI: '1', NODE_ENV: 'development' },
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

  // ─── Tailwind safety-net ──────────────────────────────────────────
  // npm install --legacy-peer-deps occasionally completes with exit 0
  // while silently dropping a transient dep — we have repro'd this with
  // tailwindcss specifically on cold-starts. Without this recovery, the
  // dev server boots but PostCSS fails to resolve `tailwindcss` →
  // `globals.css` parses raw → "Unexpected character '@'" build error.
  //
  // We detect by file probe (cheap) instead of `npm ls` (slow + flaky)
  // and recover with a direct, non-saving install of just the trio.
  // Idempotent: the next /start sees the modules + matching hash and
  // skips this branch entirely.
  try {
    const pkgRaw = existsSync(pkgPath) ? await fs.readFile(pkgPath, 'utf8') : ''
    const pkgJson = pkgRaw ? JSON.parse(pkgRaw) : {}
    const wantsTailwind = !!(pkgJson.devDependencies?.tailwindcss || pkgJson.dependencies?.tailwindcss)
    if (wantsTailwind) {
      const tailwindOnDisk = existsSync(join(cwd, 'node_modules', 'tailwindcss', 'package.json'))
      const postcssOnDisk = existsSync(join(cwd, 'node_modules', 'postcss', 'package.json'))
      const autoprefixerOnDisk = existsSync(join(cwd, 'node_modules', 'autoprefixer', 'package.json'))
      if (!tailwindOnDisk || !postcssOnDisk || !autoprefixerOnDisk) {
        const missing = [
          tailwindOnDisk ? null : 'tailwindcss',
          postcssOnDisk ? null : 'postcss',
          autoprefixerOnDisk ? null : 'autoprefixer',
        ].filter(Boolean)
        appendLog('runner', `[runner] Tailwind safety-net: ${missing.join(', ')} listed in package.json but missing from node_modules — running recovery install`)
        const recoverArgs = ['install', '--no-save', '--no-audit', '--no-fund', '--legacy-peer-deps',
          'tailwindcss@^3.4.10', 'postcss@^8.4.41', 'autoprefixer@^10.4.20']
        await new Promise((res2, rej2) => {
          const proc = spawn('npm', recoverArgs, { cwd, env: { ...process.env, CI: '1', NODE_ENV: 'development' } })
          proc.stdout.on('data', d => appendLog('install', d))
          proc.stderr.on('data', d => appendLog('install', d))
          proc.on('exit', code => {
            if (code === 0) res2()
            else rej2(new Error('tailwind safety-net install exited ' + code))
          })
          proc.on('error', rej2)
        })
        appendLog('runner', '[runner] Tailwind safety-net: recovery install complete')
      }
    }
  } catch (err) {
    appendLog('runner', `[runner] Tailwind safety-net skipped (${err.message})`)
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
  // Direct Supabase pull. Vercel just calls us with { projectId } and we
  // fetch all files in parallel using the env-injected service-role key.
  //
  // Architecture (Feb 2026 rewrite): every text file lives inline in the
  // `content` column. Storage is used ONLY for `_assets/*` binary rows
  // (image data URIs from image-extractor). That eliminates the whole
  // class of "Storage download timed out → file silently dropped from
  // the synced project" bugs that plagued the previous design.
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
  appendLog('runner', `[sync] listed ${allRows.length} rows in ${Date.now() - t0}ms`)

  // 2) Content-aware sync: instead of wiping the project tree and
  //    rewriting all files (which bumps mtime on every file and triggers
  //    a chokidar storm → Next.js HMR + full server restart on next.config.js
  //    touches), we now diff DB content against disk and only write files
  //    that actually changed. Files present on disk but absent from the DB
  //    set get removed. node_modules + .next are always preserved.
  //
  //    Before this fix, every sync would write all 73 files with fresh
  //    mtimes. Next.js's watcher saw the bundle as wholesale modified,
  //    restarted the dev server, and the iframe's CSS request would land
  //    on a restart window → 500 from the server → page rendered with no
  //    stylesheet → user saw plain text with default browser styles.
  if (!existsSync(PROJECT_DIR)) {
    await mkdir(PROJECT_DIR, { recursive: true })
  }
  const dbPaths = new Set(allRows.filter((r) => r.path).map((r) => r.path))
  // Walk the existing tree and gather disk paths (excluding the
  // preserved node_modules / .next / .npmrc-style runner files).
  const PRESERVE = new Set(['node_modules', '.next', '.npmrc'])
  async function collectDiskPaths(dir, rel = '') {
    const out = []
    const fs = await import('node:fs/promises')
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name
      if (rel === '' && PRESERVE.has(ent.name)) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        const nested = await collectDiskPaths(full, relPath)
        out.push(...nested)
      } else {
        out.push(relPath)
      }
    }
    return out
  }
  const diskPaths = await collectDiskPaths(PROJECT_DIR)
  // Remove files that exist on disk but no longer in the DB.
  let removed = 0
  for (const p of diskPaths) {
    if (!dbPaths.has(p)) {
      await rm(join(PROJECT_DIR, p), { force: true })
      removed++
    }
  }

  // 3) Write all files to disk. Text files come from the `content` column
  //    directly — single source of truth, no flaky middleman. Asset rows
  //    (_assets/*) still come from Storage; on Storage failure we ABORT
  //    the whole sync rather than silently skipping a file.
  let written = 0
  let decodedAssets = 0
  let storageDownloads = 0
  const failures = []
  const limit = 8
  let cursor = 0
  async function workOne() {
    while (cursor < allRows.length) {
      const idx = cursor++
      const row = allRows[idx]
      if (!row.path) continue

      let body = typeof row.content === 'string' ? row.content : ''

      // Fallback to Storage ONLY for legacy rows (post-rewrite, all text
      // files have content set). If a Storage download fails we record
      // it for the response so the orchestrator can surface a real error
      // instead of pretending sync succeeded with a half-empty project.
      if (!body && row.storage_path) {
        const dl = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(row.storage_path)}`, { headers })
        if (!dl.ok) {
          const msg = `${row.path}: storage ${dl.status}`
          failures.push(msg)
          appendLog('runner', `[sync] FAIL ${msg}`)
          continue
        }
        body = await dl.text()
        storageDownloads++
      }

      const target = resolve(PROJECT_DIR, row.path)
      if (!target.startsWith(PROJECT_DIR + '/') && target !== PROJECT_DIR) continue
      await mkdir(dirname(target), { recursive: true })

      // Decode `data:<mime>;base64,<...>` URIs back to binary so binary
      // assets (sprites, audio) load correctly. This is intentional for
      // legitimate _assets rows and a no-op for source files.
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

      // ── Content-aware write ──
      // Skip the write if the file on disk already has identical bytes.
      // Critical for stability: writeFile() bumps the mtime even when
      // content is unchanged, which would trigger Next.js's chokidar
      // watcher to restart the dev server during every sync. Skipping
      // identical writes turns N-file syncs into O(changed) work and
      // keeps the dev server stable across rapid chat-driven file edits.
      try {
        const fs = await import('node:fs/promises')
        const existing = await fs.readFile(target).catch(() => null)
        if (existing !== null) {
          const same = encoding === 'utf8'
            ? existing.toString('utf8') === content
            : Buffer.isBuffer(content) && existing.equals(content)
          if (same) {
            // Identical — leave mtime alone, no Next.js restart.
            continue
          }
        }
      } catch { /* fall through to write */ }

      await writeFile(target, content, encoding)
      written++
    }
  }
  await Promise.all(Array.from({ length: limit }, workOne))

  const ms = Date.now() - t0
  const skipped = allRows.length - written - failures.length
  appendLog('runner', `[sync] wrote ${written} changed, skipped ${skipped} identical, removed ${removed} stale (${decodedAssets} binary, ${storageDownloads} storage, ${failures.length} failures) in ${ms}ms`)

  // Loud failure: if ANY required file is missing, return a non-OK status
  // so the orchestrator stops the boot and surfaces a real error to the
  // user instead of letting Next.js crash with "Cannot find module" on a
  // file that just never made it to disk.
  if (failures.length > 0) {
    return res.status(502).json({
      error: 'sync incomplete',
      failures,
      written,
      total: allRows.length,
    })
  }
  res.json({ ok: true, written, decodedAssets, storageDownloads, ms })
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

    // Compute the public preview URL so Next.js / framework apps can
    // generate correct absolute URLs (for <Link> hover, OG tags, etc).
    const projectId = process.env.AURORALY_PROJECT_ID || 'unknown'
    const baseDomain = process.env.PREVIEW_BASE_DOMAIN || 'preview.auroraly.co'
    const previewUrl = `https://${projectId}.${baseDomain}`

    appendLog('runner', `[runner] spawning ${cmd[0]} ${cmd[1].join(' ')} in ${nested || '/project'}`)
    appendLog('runner', `[runner] injecting preview URL env vars: ${previewUrl}`)
    devProc = spawn(cmd[0], cmd[1], {
      cwd,
      env: {
        ...process.env,
        // CRITICAL: force NODE_ENV=development for the dev server.
        // The image (Dockerfile) sets NODE_ENV=production so the
        // RUNNER itself runs in prod mode for its own deps, but the
        // user's Next.js dev server MUST run in development mode or
        // its dev-mode CSS pipeline (PostCSS → tailwindcss expansion)
        // never gets attached. Next.js sees a non-standard NODE_ENV,
        // logs a warning, falls back to next-flight-css-loader alone,
        // and webpack chokes on `@tailwind` directives.
        NODE_ENV: 'development',
        PORT: String(USER_DEV_PORT),
        HOST: '0.0.0.0',
        BROWSER: 'none',
        FORCE_COLOR: '0',
        // CRA tries to open a browser by default — kill that. The host
        // check defeats our wildcard subdomain → disable it.
        DANGEROUSLY_DISABLE_HOST_CHECK: 'true',
        WDS_SOCKET_PORT: '443',
        // Inject the preview URL so Next.js / framework apps know their
        // public domain and generate correct absolute URLs.
        NEXT_PUBLIC_SITE_URL: previewUrl,
        NEXTAUTH_URL: previewUrl,
        VERCEL_URL: `${projectId}.${baseDomain}`,
        // Also set generic PUBLIC_URL for CRA / Vite apps
        PUBLIC_URL: previewUrl,
        VITE_PUBLIC_URL: previewUrl,
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

// POST /force-install — surgical recovery when a project's dev server
// is up but Tailwind (or its trio) isn't actually on disk. Kills the
// dev server, force-installs tailwindcss@3/postcss@8/autoprefixer@10
// into /project/node_modules, then respawns. Used by the orchestrator's
// /api/previews/:id/force-install endpoint as a no-reset recovery path
// — way faster than destroy → recreate → npm install everything.
app.post('/force-install', async (_req, res) => {
  try {
    const resolved = await resolveProjectCwd()
    if (!resolved) return res.status(500).json({ error: 'no usable project cwd' })
    const { cwd } = resolved

    // Kill any running dev server before mutating node_modules — Next.js
    // caches require() resolutions in-process and won't pick up the new
    // tailwindcss otherwise.
    if (devProc) {
      try { devProc.kill('SIGTERM') } catch {}
      await new Promise(r => setTimeout(r, 500))
      try { devProc?.kill('SIGKILL') } catch {}
      devProc = null
    }

    appendLog('runner', '[force-install] installing tailwindcss/postcss/autoprefixer (no-save)…')
    await new Promise((resolveInstall, rejectInstall) => {
      const proc = spawn('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--legacy-peer-deps',
        'tailwindcss@^3.4.10', 'postcss@^8.4.41', 'autoprefixer@^10.4.20'], {
        cwd,
        env: { ...process.env, CI: '1', NODE_ENV: 'development' },
      })
      proc.stdout.on('data', d => appendLog('install', d))
      proc.stderr.on('data', d => appendLog('install', d))
      proc.on('exit', code => {
        if (code === 0) resolveInstall()
        else rejectInstall(new Error('force-install exited ' + code))
      })
      proc.on('error', rejectInstall)
    })
    appendLog('runner', '[force-install] done — respawning dev server')

    // Reset the install-hash cache so a subsequent /start doesn't decide
    // node_modules is "fresh" and skip its own sanity check.
    lastInstallHash = ''

    // Respawn the dev server in the background.
    bootDevServerInBackground().catch(err => appendLog('runner', `[force-install] respawn crashed: ${err.message}`))

    res.json({ ok: true, message: 'tailwind trio installed, dev server respawning' })
  } catch (err) {
    appendLog('runner', `[force-install] FAIL: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
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
  appendLog('runner', `[runner v5.clean] listening on :${RUNNER_PORT} (user dev → :${USER_DEV_PORT})`)
  appendLog('runner', `[runner v5.clean] single-source-of-truth files (DB content), loud-fail sync, no config injection`)
})

// Graceful shutdown so Fly's machine-stop doesn't leave zombies.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    appendLog('runner', `[runner] received ${sig}, shutting down`)
    try { devProc?.kill('SIGTERM') } catch {}
    setTimeout(() => process.exit(0), 1000)
  })
}
