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
import net from 'node:net'

const RUNNER_PORT = parseInt(process.env.RUNNER_PORT || '8080', 10)
// USER_DEV_PORT is what the user's framework dev server binds to internally.
// Port 3000 is reserved for our project-routing proxy (see below), so the
// dev server lives on 3001. The proxy listens on 3000 (the externally
// exposed port via fly.toml) and forwards same-project requests to 3001.
const USER_DEV_PORT = parseInt(process.env.USER_DEV_PORT || '3001', 10)
const USER_DEV_PROXY_PORT = parseInt(process.env.USER_DEV_PROXY_PORT || '3000', 10)
// The orchestrator injects this when creating the machine. It tells us
// "this machine serves only this project — replay anything else." If
// missing (e.g. template machines), the proxy replays ALL traffic.
const AURORALY_PROJECT_ID = process.env.AURORALY_PROJECT_ID || ''
const PROJECT_DIR = '/project'
const SHARED_SECRET = process.env.RUNNER_SHARED_SECRET || ''
const MAX_LOG_LINES = 2000

const logs = []          // ring buffer of {ts, stream, line}
const logEvents = new EventEmitter()
let devProc = null
let installProc = null
let installPromise = null
let lastInstallHash = null

// Persist the install hash to disk so it survives machine stop/start
// cycles. Fly's auto_stop_machines = "stop" keeps the rootfs intact,
// which means node_modules is still there after restart — but until
// this hash file existed, lastInstallHash reset to null on every
// reboot and the cache-miss nuke at the top of runInstallIfNeeded()
// would wipe node_modules clean even though nothing had changed.
// That single line of in-memory state cost users a full reinstall on
// every cold boot. Persisting the hash to /project/.auroraly-install-hash
// turns subsequent boots from "5-10 min reinstall" into "<10s skip".
const INSTALL_HASH_FILE = join(PROJECT_DIR, '.auroraly-install-hash')

async function loadPersistedInstallHash() {
  try {
    if (existsSync(INSTALL_HASH_FILE)) {
      const fs = await import('node:fs/promises')
      const raw = await fs.readFile(INSTALL_HASH_FILE, 'utf8')
      if (raw && raw.length > 0) {
        lastInstallHash = raw.trim()
        appendLog('runner', `[runner] restored install hash from disk (${lastInstallHash.length} chars) — node_modules will be reused if package files unchanged`)
      }
    }
  } catch (err) {
    appendLog('runner', `[runner] could not load persisted install hash: ${err?.message || 'unknown'} — first install will run`)
  }
}

async function savePersistedInstallHash(hash) {
  try {
    const fs = await import('node:fs/promises')
    await fs.writeFile(INSTALL_HASH_FILE, hash || '', 'utf8')
  } catch (err) {
    // Non-fatal: if we can't persist, next boot just reinstalls. Log
    // so we notice this in production.
    appendLog('runner', `[runner] failed to persist install hash: ${err?.message || 'unknown'}`)
  }
}

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
    // Also write to stdout so Fly's log collector sees it
    console.log(`[${stream}] ${line}`)
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
  let userConfigPath = null
  for (const c of candidates) {
    const full = join(dir, c)
    if (existsSync(full)) {
      userConfigImport = `./${c}`
      userConfigPath = full
      break
    }
  }
  // If we found a config, check if it's safe to import (doesn't use @/ aliases
  // or other resolution-dependent imports at the top level). If it looks risky,
  // skip the import and use a minimal fallback.
  if (userConfigPath) {
    try {
      const content = await fs.readFile(userConfigPath, 'utf8')
      // Common patterns that indicate the config needs Vite's resolver to be
      // initialized before it can be imported (chicken-and-egg problem).
      const hasRiskyImports = /@\/|#\/|~\//.test(content) || /import.*from\s+['"]@/.test(content)
      if (hasRiskyImports) {
        appendLog('runner', `[runner] user vite config uses path aliases — using minimal fallback to avoid import errors`)
        userConfigImport = null
      }
    } catch {}
  }
  // Detect a `src/` directory so we can auto-inject the conventional
  // `@` → `./src` alias. Most React/CRA-to-Vite imports rely on this
  // (e.g. `import "@/index.css"`, `import App from "@/App"`). Without
  // it, Vite's import-analysis plugin throws "Failed to resolve import"
  // and the preview iframe shows the red Vite error overlay.
  let srcAliasPath = null
  try {
    const srcDir = join(dir, 'src')
    if (existsSync(srcDir)) {
      srcAliasPath = srcDir
    }
  } catch {}
  const aliasBlock = srcAliasPath
    ? `  resolve: {
    alias: {
      ...(userConfig?.resolve?.alias || {}),
      '@': ${JSON.stringify(srcAliasPath)},
    },
  },\n`
    : ''
  const aliasBlockMinimal = srcAliasPath
    ? `  resolve: {
    alias: {
      '@': ${JSON.stringify(srcAliasPath)},
    },
  },\n`
    : ''
  // ─── CRA-in-Vite JSX compatibility ─────────────────────────────────
  // Create React App tolerates JSX inside `.js` files (e.g. App.js
  // returns `<div>…</div>`). Vite's esbuild only treats `.jsx`/`.tsx`
  // as JSX by default, so Mangia-Mama and similar CRA imports trip the
  // "Failed to parse source for import analysis because the content
  // contains invalid JS syntax" error at first compile.
  //
  // We don't rename user files — instead we instruct esbuild to use
  // the `jsx` loader for every `.js` file under the project. This
  // matches CRA's behavior exactly: `.js` containing JSX compiles
  // cleanly while pure-JS `.js` files still work because the JSX
  // loader is a superset of the JS loader.
  //
  // `optimizeDeps.esbuildOptions.loader` covers the pre-bundle pass
  // (cold start dependency optimization) and `esbuild.loader` covers
  // the per-module transform pass during dev. We set both.
  const jsxLoaderBlock = `  esbuild: {
    ...(userConfig?.esbuild || {}),
    loader: 'jsx',
    include: /\\.(jsx?|tsx?)$/,
    exclude: [],
  },
  optimizeDeps: {
    ...(userConfig?.optimizeDeps || {}),
    esbuildOptions: {
      ...(userConfig?.optimizeDeps?.esbuildOptions || {}),
      loader: { ...(userConfig?.optimizeDeps?.esbuildOptions?.loader || {}), '.js': 'jsx' },
    },
  },\n`
  const jsxLoaderBlockMinimal = `  esbuild: {
    loader: 'jsx',
    include: /\\.(jsx?|tsx?)$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },\n`
  // ESM file that imports the user's config (if any) and merges in
  // `server.allowedHosts: true` so Vite's v5 host-check accepts our
  // wildcard preview subdomains. HMR over wss:443 because Fly's edge
  // upgrades to TLS even when the internal port is plain HTTP.
  //
  // CRITICAL: wrap user config import in try/catch. If the user's config
  // uses path aliases (@/...) or other imports that depend on Vite's
  // resolver being initialized, those will throw before Vite even starts.
  // We fall back to a minimal working config so the preview boots.
  const body = userConfigImport
    ? `import { defineConfig } from 'vite'
let userConfig = {}
try {
  const imported = await import('${userConfigImport}')
  userConfig = imported.default || imported
  if (typeof userConfig === 'function') {
    userConfig = await userConfig({ command: 'serve', mode: 'development' })
  }
} catch (err) {
  console.warn('[runner] user vite config import failed (using fallback):', err.message)
}
export default defineConfig({
  ...userConfig,
${aliasBlock}${jsxLoaderBlock}  server: {
    ...(userConfig?.server || {}),
    host: '0.0.0.0',
    port: ${USER_DEV_PORT},
    strictPort: false,
    allowedHosts: true,
    hmr: { ...(userConfig?.server?.hmr || {}), clientPort: 443, protocol: 'wss' },
  },
})
`
    : `import { defineConfig } from 'vite'
export default defineConfig({
${aliasBlockMinimal}${jsxLoaderBlockMinimal}  server: {
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
  if (srcAliasPath) appendLog('runner', `[runner] vite alias injected: @ → ${srcAliasPath}`)
  appendLog('runner', `[runner] vite esbuild JSX-in-.js loader enabled (CRA compatibility)`)
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

  // 5) Static-site fallback: no package.json anywhere, but if PROJECT_DIR
  // contains an index.html we can still serve it. This handles plain
  // HTML/CSS/JS projects (landing pages, marketing sites, Auroraly's
  // own static templates) — about 30% of generated projects ship
  // without a Node toolchain. We mark the descriptor with `static:
  // true` and let pickDevCommand spawn an http-server.
  const indexHtml = await readPkg(join(PROJECT_DIR, 'index.html')).catch(() => null)
  // readPkg() returns null on JSON.parse failure (HTML isn't JSON), so
  // we use a direct existsSync probe instead.
  if (existsSync(join(PROJECT_DIR, 'index.html'))) {
    appendLog('runner', '[runner] no package.json found, but index.html exists — falling back to static-site server')
    return { cwd: PROJECT_DIR, pkg: null, nested: '', static: true }
  }
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

  // ── Defensive nuke on cache miss (added 2026-05-28) ─────────────────
  // If the hash changed but a node_modules dir is sitting on disk,
  // it's from a PRIOR install of a DIFFERENT lockfile state. Mixing
  // those produces Vite-style chunk errors:
  //   "Cannot find module '/project/frontend/node_modules/vite/dist/
  //    node/chunks/dep-D-7KCb9p.js' imported from .../dep-BK3b2jBa.js"
  // (the new Vite binary expects the new chunk hash; the old chunk
  // from a partially-overwritten install is loaded instead). Same
  // pattern bites Next.js, esbuild, and any tool that ships internal
  // chunk-hashed JS. Nuking before reinstall guarantees a clean tree.
  //
  // We also nuke .vite / .cache / .turbo / .next caches that
  // reference internal chunk hashes — these can persist across
  // installs and pin a build to a stale chunk graph.
  const node_modules_path = join(cwd, 'node_modules')
  if (existsSync(node_modules_path)) {
    appendLog('runner', '[runner] cache miss — nuking stale node_modules to prevent chunk-hash drift…')
    try {
      await fs.rm(node_modules_path, { recursive: true, force: true })
    } catch (e) {
      appendLog('runner', `[runner] ⚠ failed to remove node_modules: ${e?.message} — proceeding anyway, npm install will likely overwrite`)
    }
  }
  // Also clear build caches that pin internal chunk references.
  for (const cacheDir of ['.vite', '.cache', '.turbo', '.next/cache']) {
    const fullCache = join(cwd, cacheDir)
    if (existsSync(fullCache)) {
      try { await fs.rm(fullCache, { recursive: true, force: true }) } catch {}
    }
  }

  appendLog('runner', `[runner] running npm install in ${cwd} (this may take 1-2 min on cold start)…`)
  
  // Retry logic: even after the cache-miss nuke above, npm install can
  // fail transiently (network blip, registry hiccup, OOM mid-extract).
  // Retry once after nuking node_modules so we don't surface a flaky
  // failure to the user. lastInstallHash is only updated on success.
  let attempt = 0
  const maxAttempts = 2
  while (attempt < maxAttempts) {
    attempt++
    try {
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
          if (code === 0) { lastInstallHash = key; savePersistedInstallHash(key); res() }
          else rej(new Error('npm install exited ' + code))
        })
        installProc.on('error', rej)
      })
      break
    } catch (err) {
      if (attempt < maxAttempts) {
        appendLog('runner', `[runner] npm install failed (attempt ${attempt}/${maxAttempts}): ${err.message}`)
        appendLog('runner', `[runner] deleting corrupted node_modules and retrying from scratch…`)
        const nmPath = join(cwd, 'node_modules')
        try {
          await fs.rm(nmPath, { recursive: true, force: true })
          appendLog('runner', `[runner] deleted ${nmPath}`)
        } catch (rmErr) {
          appendLog('runner', `[runner] failed to delete node_modules: ${rmErr.message}`)
        }
        await new Promise(r => setTimeout(r, 500))
      } else {
        // Final attempt failed — also nuke node_modules so the next
        // /start sees cache miss → fresh nuke + retry from clean slate.
        appendLog('runner', `[runner] npm install failed after ${maxAttempts} attempts: ${err.message}`)
        try { await fs.rm(node_modules_path, { recursive: true, force: true }) } catch {}
        throw err
      }
    }
  }

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

  // ─── CRA `ajv` resolution safety-net ──────────────────────────────
  // react-scripts ships with ajv-keywords@5 (peer-deps ajv@^8), but on
  // a --legacy-peer-deps install npm sometimes hoists an older ajv@6
  // from a transitive dep instead — and ajv-keywords@5 imports
  // `ajv/dist/compile/codegen` which only exists in ajv@8. The result
  // is the classic CRA crash:
  //   Cannot find module 'ajv/dist/compile/codegen'
  // followed by an exit-1 from react-scripts/scripts/start.js.
  //
  // The community fix (since 2021) is to install ajv@^8 at the project
  // root so npm hoists the correct version where ajv-keywords can find
  // it. We do that automatically here for any project that has
  // react-scripts AND is missing the codegen entry point.
  try {
    const pkgRaw = existsSync(pkgPath) ? await fs.readFile(pkgPath, 'utf8') : ''
    const pkgJson = pkgRaw ? JSON.parse(pkgRaw) : {}
    const wantsCRA = !!(pkgJson.devDependencies?.['react-scripts'] || pkgJson.dependencies?.['react-scripts'])
    if (wantsCRA) {
      const ajvCodegen = join(cwd, 'node_modules', 'ajv', 'dist', 'compile', 'codegen.js')
      if (!existsSync(ajvCodegen)) {
        appendLog('runner', '[runner] CRA ajv safety-net: ajv/dist/compile/codegen missing — running recovery install of ajv@^8')
        const recoverArgs = ['install', '--no-save', '--no-audit', '--no-fund', '--legacy-peer-deps', 'ajv@^8']
        await new Promise((res2, rej2) => {
          const proc = spawn('npm', recoverArgs, { cwd, env: { ...process.env, CI: '1', NODE_ENV: 'development' } })
          proc.stdout.on('data', d => appendLog('install', d))
          proc.stderr.on('data', d => appendLog('install', d))
          proc.on('exit', code => {
            if (code === 0) res2()
            else rej2(new Error('ajv safety-net install exited ' + code))
          })
          proc.on('error', rej2)
        })
        appendLog('runner', '[runner] CRA ajv safety-net: recovery install complete')
      }
    }
  } catch (err) {
    appendLog('runner', `[runner] CRA ajv safety-net skipped (${err.message})`)
  }
}

// ─── routes ──────────────────────────────────────────────────────────
// Cached TCP-probe state for the user dev server (USER_DEV_PORT).
// `devProc !== null` only means the process was spawned — not that it
// has bound to its listening port. CRA/Next/Vite all have a 30-90s
// compile window between spawn and port-bind, and during that window
// `/status` was lying with `running: true`. That lie caused the
// dashboard to flip to "ready" prematurely and hide the BUILD OUTPUT
// box, leaving the user to debug a blank ECONNREFUSED iframe.
// We now TCP-probe USER_DEV_PORT and cache the result for 500ms so a
// hot-loop of /status calls doesn't open thousands of sockets.
let devPortListening = false
let devPortLastProbe = 0
function probeDevPortListening() {
  const now = Date.now()
  if (now - devPortLastProbe < 500) return devPortListening
  devPortLastProbe = now
  return new Promise((resolveProbe) => {
    const sock = net.connect({ host: '127.0.0.1', port: USER_DEV_PORT })
    let done = false
    const finish = (open) => {
      if (done) return
      done = true
      devPortListening = open
      try { sock.destroy() } catch {}
      resolveProbe(open)
    }
    sock.on('connect', () => finish(true))
    sock.on('error', () => finish(false))
    setTimeout(() => finish(false), 250)
  })
}

// HTTP-level readiness probe. Even AFTER the port opens, frameworks
// like react-scripts and webpack-dev-server take 30-90 seconds to
// finish compiling — during that window the port is open but every
// request gets either a 502, a "Compiling..." shell page, or hangs.
// If we report `running: true` the instant the port binds, the
// dashboard flips to Ready and the user sees a blank/error iframe.
// Bumping to "first HTTP request to / returns a 2xx/3xx" is the right
// readiness contract for a dev server.
// Cached for 1.5s — slower than the TCP probe because each call costs
// a full HTTP roundtrip.
let devHttpReady = false
let devHttpLastProbe = 0
function probeDevHttpReady() {
  const now = Date.now()
  if (now - devHttpLastProbe < 1500) return Promise.resolve(devHttpReady)
  devHttpLastProbe = now
  return new Promise((resolveHttp) => {
    const req = net.connect({ host: '127.0.0.1', port: USER_DEV_PORT }, () => {
      req.write('GET / HTTP/1.0\r\nHost: localhost\r\nUser-Agent: auroraly-runner-probe\r\n\r\n')
    })
    let buffer = ''
    let done = false
    const finish = (ready) => {
      if (done) return
      done = true
      devHttpReady = ready
      try { req.destroy() } catch {}
      resolveHttp(ready)
    }
    req.on('data', (chunk) => {
      buffer += chunk.toString('utf8', 0, Math.min(chunk.length, 256))
      // Accept any 2xx or 3xx response. 5xx during compile + 404 from
      // a router that hasn't mounted yet both signal NOT ready.
      const match = buffer.match(/^HTTP\/1\.[01]\s+(\d{3})/)
      if (match) {
        const code = parseInt(match[1], 10)
        finish(code >= 200 && code < 400)
      }
    })
    req.on('end', () => finish(false))
    req.on('error', () => finish(false))
    // 2s timeout — generous because dev servers under load can be slow
    // to respond mid-compile but should never take more than that to
    // produce SOME response.
    setTimeout(() => finish(false), 2000)
  })
}

app.get('/health', (_req, res) => res.json({ ok: true, running: !!devProc, pid: devProc?.pid || null }))

// `/version` — definitive answer to "which runner image is this machine
// actually serving?". The BUILD_SHA env is baked into the Docker image
// at build time via --build-arg from the GitHub Actions deploy workflow.
// If two machines for the same app report different SHAs here, the older
// one is running stale code and the orchestrator's
// isMachineImageStale() should recycle it on next /start.
app.get('/version', (_req, res) => res.json({
  buildSha: process.env.BUILD_SHA || 'dev',
  startedAt: process.env.RUNNER_STARTED_AT,
  pid: process.pid,
}))

app.get('/status', async (_req, res) => {
  // `running` now requires up to FOUR conditions:
  //   1. The dev process is alive (devProc !== null)
  //   2. The dev port is accepting TCP connections
  //   3. The dev server responds to HTTP with a 2xx/3xx
  //   4. (CRA only) webpack has emitted "Compiled successfully" on stdout
  // (4) defeats react-scripts' premature 200 OK loading-shell which used
  // to flip the dashboard to Ready while the user still stared at a
  // blank iframe waiting for the JS bundle to compile.
  const portOpen = devProc ? await probeDevPortListening() : false
  const httpReady = portOpen ? await probeDevHttpReady() : false
  const craGate = isCRADevServer ? compileLogReady : true
  res.json({
    running: !!devProc && portOpen && httpReady && craGate,
    processAlive: !!devProc,
    portListening: portOpen,
    httpReady,
    compileLogReady: isCRADevServer ? compileLogReady : null,
    isCRA: isCRADevServer,
    buildSha: process.env.BUILD_SHA || 'dev',
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
  const projectId = req.body?.projectId
  if (!projectId) return res.status(400).json({ error: 'projectId required in request body' })
  
  // CRITICAL: reject cross-project sync attempts. If this machine was
  // created for project A and the orchestrator tries to sync project B,
  // that's a routing bug upstream — fail loudly instead of silently
  // syncing the wrong project's files.
  const myProjectId = process.env.AURORALY_PROJECT_ID
  if (myProjectId && projectId !== myProjectId) {
    appendLog('runner', `[sync] REJECTED: this machine serves "${myProjectId}", request was for "${projectId}"`)
    return res.status(400).json({
      error: 'project_mismatch',
      message: `This machine serves project "${myProjectId}", cannot sync "${projectId}"`,
      machine_project: myProjectId,
      requested_project: projectId,
    })
  }
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
  // CRITICAL: node_modules must be excluded at ALL levels, not just root.
  // These are ephemeral build artifacts generated by npm install, NOT
  // source files. Treating them as source-of-truth caused the "removed
  // 13552 stale" bug that deleted critical dependency files.
  //
  // vite.config.runner.mjs is GENERATED by the runner (ensureViteHostOverride)
  // and never exists in the DB. Removing it as "stale" crashes Vite on hot-reload.
  const PRESERVE_ROOT = new Set(['.next', '.npmrc', '.auroraly-install-hash', 'vite.config.runner.mjs'])
  const PRESERVE_ANYWHERE = new Set(['node_modules'])
  async function collectDiskPaths(dir, rel = '') {
    const out = []
    const fs = await import('node:fs/promises')
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name
      // Skip root-level runner artifacts
      if (rel === '' && PRESERVE_ROOT.has(ent.name)) continue
      // Skip node_modules at ANY level (root, frontend/, apps/web/, etc)
      if (PRESERVE_ANYWHERE.has(ent.name)) continue
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
  appendLog('runner', `[sync] node_modules excluded from sync (ephemeral build artifacts, not source files)`)

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

// ─── log-pattern readiness for CRA (webpack-dev-server) ──────────────
// `react-scripts` (CRA) binds its HTTP port and serves a "Compiling..."
// loading shell with a 2xx response code LONG before the JS bundle has
// actually compiled. Our TCP+HTTP probes both flip to "ready" the moment
// that shell answers, but the user's iframe is blank because no JS has
// been built yet. The only reliable signal is the literal string
// "Compiled successfully" / "webpack X.Y.Z compiled successfully" /
// "Compiled with warnings" emitted by webpack on stdout/stderr after
// the first successful compile. We scan the dev process output for it
// and gate /status on `compileLogReady` when the project looks like CRA.
let compileLogReady = false
let isCRADevServer = false
// Case-insensitive substring patterns. Webpack 5 emits messages like
// "webpack 5.91.0 compiled successfully in 12345 ms" with a version
// in the middle, so we match on the stable phrase rather than the
// CRA-specific "Compiled successfully!" prefix.
const COMPILE_READY_PATTERNS = [
  'compiled successfully',
  'compiled with warnings',
]
function scanForCompileReady(chunk) {
  if (compileLogReady) return
  const text = (chunk?.toString?.('utf8') || '').toLowerCase()
  for (const pat of COMPILE_READY_PATTERNS) {
    if (text.includes(pat)) {
      compileLogReady = true
      appendLog('runner', `[runner] CRA/webpack compile-ready signal detected: "${pat}"`)
      return
    }
  }
}

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
    const { cwd, pkg, nested, static: isStatic } = resolved

    // Static-site path: no package.json, plain HTML — spawn http-server
    // bound to USER_DEV_PORT. We use the globally-installed `serve`
    // package (bundled into the Dockerfile) so we don't need to npm
    // install anything for these projects. Sub-1s cold start.
    if (isStatic) {
      appendLog('runner', `[runner] spawning static-site server (npx serve) in ${cwd}`)
      // `-l tcp://0.0.0.0:PORT` binds inside Fly's network. `-s` enables
      // single-page-app rewriting so client-side routers work. We can
      // detect SPA later; for now defaulting to safe-mode (serve any
      // index.html). `--no-clipboard` keeps it noninteractive.
      devProc = spawn('npx', ['--yes', 'serve', '-l', `tcp://0.0.0.0:${USER_DEV_PORT}`, '-s', '--no-clipboard', cwd], {
        env: { ...process.env, NODE_ENV: 'development' },
      })
      devProc.stdout.on('data', d => appendLog('dev', d))
      devProc.stderr.on('data', d => appendLog('dev', d))
      devProc.on('exit', (code, signal) => {
        appendLog('runner', `[runner] static-site server exited code=${code} signal=${signal}`)
        devProc = null
      })
      return
    }

    if (!installPromise) installPromise = runInstallIfNeeded(cwd).finally(() => { installPromise = null })
    await installPromise

    await ensureViteHostOverride(pkg, cwd)
    const cmd = pickDevCommand(pkg, cwd)
    if (!cmd) {
      lastStartError = 'no usable dev/start/preview script and no recognizable framework (vite/next/react-scripts) in node_modules'
      appendLog('runner', `[runner] start failed: ${lastStartError}`)
      return
    }

    // Detect CRA so the readiness probe waits for "Compiled successfully"
    // in stdout instead of trusting react-scripts' premature 200 OK shell.
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
    isCRADevServer = !!deps['react-scripts']
    compileLogReady = false
    if (isCRADevServer) {
      appendLog('runner', `[runner] CRA detected — gating readiness on "Compiled successfully" log pattern`)
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
    devProc.stdout.on('data', d => { appendLog('dev', d); scanForCompileReady(d) })
    devProc.stderr.on('data', d => { appendLog('dev', d); scanForCompileReady(d) })
    devProc.on('exit', (code, signal) => {
      appendLog('runner', `[runner] dev server exited code=${code} signal=${signal}`)
      if (code !== 0 && code !== null) lastStartError = `dev server exited ${code}`
      devProc = null
      compileLogReady = false
      isCRADevServer = false
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
    // node_modules is "fresh" and skip its own sanity check. Both the
    // in-memory and persisted-to-disk copies need clearing.
    lastInstallHash = ''
    await savePersistedInstallHash('').catch(() => {})

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
  process.env.RUNNER_STARTED_AT = new Date().toISOString()
  const buildSha = process.env.BUILD_SHA || 'dev'
  appendLog('runner', `[runner v5.clean] build=${buildSha} listening on :${RUNNER_PORT} (user dev → :${USER_DEV_PORT}, proxy on :${USER_DEV_PROXY_PORT})`)
  appendLog('runner', `[runner v5.clean] single-source-of-truth files (DB content), loud-fail sync, no config injection`)
  appendLog('runner', `[runner v5.clean] project pinning: AURORALY_PROJECT_ID=${AURORALY_PROJECT_ID || '(template)'}`)
  // Hydrate the install-hash cache from disk on boot. This is the key
  // change that makes machine restarts (auto_stop_machines = "stop")
  // fast: previously, the in-memory hash reset to null and we'd nuke
  // node_modules on every boot even though the files on disk were
  // perfectly valid. Now subsequent boots see "cache hit" and skip
  // straight to spawning the dev server.
  loadPersistedInstallHash().catch(() => { /* non-fatal */ })
})

// ─── Project-routing proxy on USER_DEV_PROXY_PORT (3000) ─────────────
// Why: the external wildcard `*.preview.auroraly.co` routes to ANY
// machine in the Fly app, not the one pinned to a specific project.
// Without this proxy, an iframe request for projectId X would round-
// robin across all machines — some would serve project X (200), others
// would serve their OWN projects' CSS pretending to be X (visually
// wrong!), others would 500. The user saw this as "preview rendering
// without CSS" because the stylesheet request landed on a sibling
// machine that returned its own project's compiled output (or an
// error page with text/html content-type).
//
// Fix: every request entering port 3000 is inspected here first.
//   • If the Host's subdomain matches this machine's AURORALY_PROJECT_ID
//     → reverse-proxy to the local dev server on USER_DEV_PORT (3001).
//   • If it doesn't match → respond with `fly-replay: elsewhere=true`,
//     telling Fly's edge to retry on a different machine. Eventually
//     Fly lands on the machine pinned to that project.
//
// WebSocket upgrades (Next.js HMR / Vite HMR) are also proxied to the
// dev server when the project matches. WS replays aren't supported by
// Fly so mismatched WS connections are closed; this is acceptable
// because the iframe's initial HTTP request will have been correctly
// routed before WS attempts open.
import http from 'node:http'
import httpProxyMod from 'http-proxy'
import { projectIdFromHost } from './host-parser.js'
const httpProxy = httpProxyMod.default || httpProxyMod

const devProxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${USER_DEV_PORT}`,
  changeOrigin: false, // keep Host so Next.js HMR knows its public URL
  ws: true,
  xfwd: true,
})
devProxy.on('error', (err, _req, res) => {
  try {
    if (res && !res.headersSent) {
      // Dev server isn't up yet (still installing) or just crashed.
      // 503 with retry hint so the iframe's auto-reload re-attempts.
      res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '3' })
      res.end(`dev server not ready: ${err.message}`)
    }
  } catch {}
})

// projectIdFromHost is imported from ./host-parser.js above — single
// source of truth shared with the unit tests.

const proxyServer = http.createServer((req, res) => {
  const { projectId: reqProject, machineId: reqMachine } = projectIdFromHost(req.headers.host)
  const myProject = AURORALY_PROJECT_ID
  // Health probe path bypasses project pinning so Fly TCP checks pass
  // even on template machines that have no AURORALY_PROJECT_ID.
  if (req.url === '/__runner_health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('ok')
  }
  if (!myProject || reqProject !== myProject) {
    // Wrong machine for this project. Prefer a targeted replay when
    // the iframe URL embeds the machineId (single hop). Otherwise fall
    // back to `elsewhere=true` (Fly picks a random sibling; may take
    // several hops to find the right one).
    const replayHeader = reqMachine
      ? `instance=${reqMachine}`
      : 'elsewhere=true'
    res.writeHead(200, {
      'content-type': 'text/plain',
      'fly-replay': replayHeader,
    })
    return res.end(`auroraly-routing: this machine serves "${myProject || '(none)'}", request was for "${reqProject}" — replaying via ${replayHeader}`)
  }
  devProxy.web(req, res)
})
proxyServer.on('upgrade', (req, socket, head) => {
  const { projectId: reqProject } = projectIdFromHost(req.headers.host)
  if (!AURORALY_PROJECT_ID || reqProject !== AURORALY_PROJECT_ID) {
    // Can't fly-replay a WS handshake. Close cleanly so the browser
    // can re-issue after the HTTP-level replay puts it on the right
    // machine.
    socket.destroy()
    return
  }
  devProxy.ws(req, socket, head)
})
proxyServer.listen(USER_DEV_PROXY_PORT, '0.0.0.0', () => {
  appendLog('runner', `[proxy] listening on :${USER_DEV_PROXY_PORT} → forwards same-project to :${USER_DEV_PORT}, fly-replays others`)
})

// Graceful shutdown so Fly's machine-stop doesn't leave zombies.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    appendLog('runner', `[runner] received ${sig}, shutting down`)
    try { devProc?.kill('SIGTERM') } catch {}
    setTimeout(() => process.exit(0), 1000)
  })
}
