// Preview engine selector.
//
// Decides which preview backend to route a project to:
//
//   'webcontainer' — runs the app IN THE BROWSER via WebContainers.
//                    Instant boot, zero infra cost, works for 85-90%
//                    of the projects users build here (React SPA, Vite,
//                    Next.js, static HTML/CSS/JS).
//
//   'server'       — spins up a real Node.js Fly.io machine. Reserved
//                    for projects that use native modules or backend
//                    network access that WebContainers can't provide.
//
// The decision is intentionally conservative: default to WebContainer,
// only escape-hatch to Fly for the small set of packages that are known
// to break inside WebContainers. When in doubt, WebContainer is fine —
// worst case the app boots but a specific native feature fails, which
// the user will see immediately and can flip the engine manually.

// These packages CANNOT run inside a WebContainer:
//   - firebase-admin: uses node-native crypto primitives
//   - prisma / @prisma/client: shells out to a native query engine binary
//   - puppeteer / playwright: needs a real Chromium binary
//   - sharp / canvas: native image libs, no WASM fallback
//   - better-sqlite3, sqlite3: native sqlite bindings
//   - pg-native, mysql, oracledb: native DB drivers
//   - node-gyp-heavy libs generally
const NATIVE_MODULE_PACKAGES = new Set([
  'firebase-admin',
  'prisma',
  '@prisma/client',
  'puppeteer',
  'puppeteer-core',
  'playwright',
  'sharp',
  'canvas',
  'better-sqlite3',
  'sqlite3',
  'pg-native',
  'mysql',
  'oracledb',
  'node-gyp',
  'bcrypt', // native — use bcryptjs instead
])

/**
 * Given a project's file tree, decide the best preview engine.
 * Called from PreviewTab so we can render the right component
 * without a network round-trip.
 *
 * @param {Array<{path: string, content?: string}>} files
 * @returns {'webcontainer' | 'server'}
 */
export function pickPreviewEngine(files) {
  if (!Array.isArray(files) || files.length === 0) return 'webcontainer'

  // Locate the top-level package.json. Nested workspace projects
  // (frontend/package.json + backend/package.json) count if EITHER
  // includes a native module — safer to send those to server engine.
  const packageJsons = files.filter(f =>
    (f.path === 'package.json' || f.path?.endsWith('/package.json')) &&
    !f.path?.includes('node_modules/') &&
    typeof f.content === 'string'
  )
  if (packageJsons.length === 0) return 'webcontainer' // static site

  for (const pkgFile of packageJsons) {
    let pkg
    try { pkg = JSON.parse(pkgFile.content) } catch { continue }
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    }
    for (const name of Object.keys(allDeps)) {
      if (NATIVE_MODULE_PACKAGES.has(name)) {
        return 'server'
      }
    }
  }

  return 'webcontainer'
}

/**
 * Diagnostic helper — returns the list of "server-only" packages that
 * forced a project into server mode, so the UI can show the user WHY
 * their project is running on Fly instead of WebContainer.
 */
export function serverModeReasons(files) {
  if (!Array.isArray(files)) return []
  const reasons = []
  for (const pkgFile of files.filter(f => (f.path === 'package.json' || f.path?.endsWith('/package.json')) && typeof f.content === 'string')) {
    let pkg
    try { pkg = JSON.parse(pkgFile.content) } catch { continue }
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    }
    for (const name of Object.keys(allDeps)) {
      if (NATIVE_MODULE_PACKAGES.has(name)) reasons.push({ path: pkgFile.path, package: name })
    }
  }
  return reasons
}
