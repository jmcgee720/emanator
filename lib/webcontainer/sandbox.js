// ══════════════════════════════════════════════════════════════════════
// ── WEBCONTAINER SANDBOX MANAGER ──
// Browser-side singleton that boots a WebContainer, mounts the
// Emanator-generated project, runs `npm install && npm run dev`, and
// exposes the live preview URL.
//
// Gated behind NEXT_PUBLIC_WEBCONTAINERS_ENABLED=1 — off by default.
// StackBlitz WebContainers require:
//   1. Cross-Origin-Isolation (COOP: same-origin, COEP: require-corp)
//   2. A non-Safari browser (WebContainers supports Chrome + Edge + Firefox)
//   3. SharedArrayBuffer available
//
// If any requirement fails, `boot()` rejects with a descriptive error
// and the UI falls back to the legacy Babel preview cleanly.
// ══════════════════════════════════════════════════════════════════════

import { toWebContainerTree, ensureScaffolding } from './file-tree.js'

let _instance = null
let _bootPromise = null

/**
 * Returns true when the host environment can run WebContainers.
 * Safe to call on the server (returns false).
 */
export function isWebContainerSupported() {
  if (typeof window === 'undefined') return false
  try {
    return typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true
  } catch {
    return false
  }
}

/**
 * Returns true when the feature flag is on.
 */
export function isWebContainerEnabled() {
  if (typeof window === 'undefined') return false
  const flag = process.env.NEXT_PUBLIC_WEBCONTAINERS_ENABLED
  return String(flag || '0') === '1'
}

/**
 * Lazy-import the WebContainer SDK only when actually needed.
 * Keeps it out of the main bundle for users who don't enable the flag.
 */
async function loadSdk() {
  const mod = await import('@webcontainer/api')
  return mod.WebContainer
}

/**
 * Boot the WebContainer singleton. First call reserves it; subsequent
 * calls reuse the existing boot.
 *
 * @returns {Promise<WebContainer>}
 */
export async function bootSandbox() {
  if (_instance) return _instance
  if (_bootPromise) return _bootPromise

  if (!isWebContainerSupported()) {
    throw new Error(
      'WebContainer requires a cross-origin-isolated context (COOP + COEP headers) and SharedArrayBuffer. ' +
      'Check your browser + server headers.'
    )
  }

  _bootPromise = (async () => {
    const WebContainer = await loadSdk()
    _instance = await WebContainer.boot()
    return _instance
  })()

  try {
    return await _bootPromise
  } catch (err) {
    _bootPromise = null
    throw err
  }
}

/**
 * Mount a fresh project tree into the sandbox. Wipes any previous
 * mount. Adds scaffolding (package.json, next.config.js, etc.) if
 * missing.
 *
 * @param {Array<{path, content}>} files
 * @param {{projectName?: string}} [opts]
 */
export async function mountProject(files, opts = {}) {
  const wc = await bootSandbox()
  const raw = toWebContainerTree(files)
  const full = ensureScaffolding(raw, opts)
  await wc.mount(full)
  return { mounted: Object.keys(full).length }
}

/**
 * Hot-update a subset of files without a full re-mount. Use this on
 * every pipeline file-save for near-instant refresh.
 *
 * @param {Array<{path, content}>} files
 */
export async function updateFiles(files) {
  const wc = await bootSandbox()
  if (!Array.isArray(files) || files.length === 0) return { updated: 0 }
  let count = 0
  for (const f of files) {
    if (!f?.path) continue
    try {
      // Ensure parent directory exists then write file.
      const parent = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : ''
      if (parent) {
        await wc.fs.mkdir(parent, { recursive: true }).catch(() => {})
      }
      await wc.fs.writeFile(f.path, typeof f.content === 'string' ? f.content : '')
      count++
    } catch (err) {
      console.warn('[WebContainer] writeFile failed for', f.path, err?.message)
    }
  }
  return { updated: count }
}

/**
 * Spawn a command in the sandbox. Returns a `Process` the caller can
 * stream stdout/stderr from.
 *
 * @param {string} cmd
 * @param {string[]} args
 */
export async function spawn(cmd, args = []) {
  const wc = await bootSandbox()
  return wc.spawn(cmd, args)
}

/**
 * Full boot → mount → install → dev server → URL sequence.
 * Emits progress via the supplied callbacks.
 *
 * @param {Array<{path, content}>} files
 * @param {Object} cbs
 * @param {(stage: string, detail?: string) => void} [cbs.onStage]
 * @param {(line: string) => void} [cbs.onLog]
 * @param {(url: string, port: number) => void} cbs.onReady
 * @param {(err: Error) => void} [cbs.onError]
 * @returns {Promise<{stop: () => Promise<void>}>}
 */
export async function runDevServer(files, cbs = {}) {
  const { onStage = () => {}, onLog = () => {}, onReady, onError = () => {} } = cbs

  try {
    onStage('boot', 'Starting WebContainer…')
    const wc = await bootSandbox()

    onStage('mount', 'Mounting project files…')
    await mountProject(files)

    // Listen for server-ready BEFORE starting install so we don't miss it.
    wc.on('server-ready', (port, url) => {
      onStage('ready', url)
      onReady?.(url, port)
    })

    onStage('install', 'Running npm install…')
    const install = await wc.spawn('npm', ['install', '--no-audit', '--no-fund'])
    install.output.pipeTo(new WritableStream({
      write(chunk) { onLog(String(chunk)) },
    })).catch(() => {})
    const installCode = await install.exit
    if (installCode !== 0) {
      throw new Error(`npm install exited with code ${installCode}`)
    }

    onStage('dev', 'Starting Next.js dev server…')
    const dev = await wc.spawn('npm', ['run', 'dev'])
    dev.output.pipeTo(new WritableStream({
      write(chunk) { onLog(String(chunk)) },
    })).catch(() => {})

    return {
      stop: async () => {
        try { dev.kill() } catch { /* noop */ }
      },
    }
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
    throw err
  }
}

/**
 * Reset the singleton — primarily for tests.
 */
export function _resetSandbox() {
  _instance = null
  _bootPromise = null
}
