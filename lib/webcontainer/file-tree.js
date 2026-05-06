// ══════════════════════════════════════════════════════════════════════
// ── WEBCONTAINER FILE TREE ──
// Pure module that converts the flat `[{path, content}]` file list
// produced by the Auroraly pipeline into the nested `FileSystemTree`
// shape `@webcontainer/api`'s `mount()` expects.
//
// Also fills in the scaffolding files (package.json, next.config.js,
// tailwind.config.js, postcss.config.js) that Auroraly's pipeline
// intentionally doesn't emit — the generated projects are pure content;
// the WebContainer layer owns the runtime shell.
// ══════════════════════════════════════════════════════════════════════

import { convertCraToVite, isCraPackage, renameCjsConfigsToCjs, bubbleCssImportsInTree } from './cra-to-vite.js'

/**
 * @typedef {Object} WcFileNode
 * @property {{contents: string}} [file]
 * @property {{directory: WcTree}} [directory]
 * @typedef {Object.<string, WcFileNode>} WcTree
 */

/**
 * Convert a flat Auroraly file list to a nested WebContainer tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {WcTree}
 */
export function toWebContainerTree(files = []) {
  const root = {}
  if (!Array.isArray(files)) return root
  for (const f of files) {
    if (!f?.path) continue
    const parts = String(f.path).replace(/^\/+/, '').split('/').filter(Boolean)
    if (parts.length === 0) continue
    let cursor = root
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLeaf = i === parts.length - 1
      if (isLeaf) {
        cursor[seg] = { file: { contents: typeof f.content === 'string' ? f.content : '' } }
      } else {
        if (!cursor[seg] || !cursor[seg].directory) {
          cursor[seg] = { directory: {} }
        }
        cursor = cursor[seg].directory
      }
    }
  }
  return root
}

/**
 * Deterministic package.json for an Auroraly-generated Next.js 14 project.
 * Pinned to the same versions `/app` itself runs on so dependency conflicts
 * don't surface in the WebContainer-side npm install.
 *
 * Includes `@next/swc-wasm-nodejs` because WebContainers run inside a
 * WASM Node.js sandbox where the native linux-x64 SWC binary fails to load.
 *
 * @param {string} projectName
 * @returns {string}
 */
export function buildPackageJson(projectName = 'emanator-preview') {
  const pkg = {
    name: projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'emanator-preview',
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev -p 3000',
      build: 'next build',
      start: 'next start -p 3000',
    },
    dependencies: {
      next: '14.2.3',
      react: '18.3.1',
      'react-dom': '18.3.1',
      'lucide-react': '^0.516.0',
      '@next/swc-wasm-nodejs': '14.2.3',
    },
    devDependencies: {
      tailwindcss: '^3.4.0',
      postcss: '^8.4.35',
      autoprefixer: '^10.4.18',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

export const NEXT_CONFIG_JS = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: { unoptimized: true },
}
module.exports = nextConfig
`

export const TAILWIND_CONFIG_JS = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './pages/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
}
`

export const POSTCSS_CONFIG_JS = `module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
`

export const GLOBALS_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
html, body { margin: 0; padding: 0; }
`

export const APP_LAYOUT_JSX = `import './globals.css'
export const metadata = { title: 'Auroraly Preview' }
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>)
}
`

/**
 * Mutate an imported Next.js project (in WC tree form) so it can run
 * inside WebContainers. WebContainers block native Node.js addons,
 * which means Next.js's SWC binary fails to load AND the wasm
 * fallback isn't reliably kicked in by Next 14. The bullet-proof
 * workaround is to force Babel-based compilation by injecting a
 * `.babelrc` with the `next/babel` preset.
 *
 * No-op if package.json is missing/unparseable or doesn't depend on `next`.
 *
 * Steps:
 *   1. Inject `@next/swc-wasm-nodejs` matching the Next.js version (belt-and-suspenders).
 *   2. Inject `.babelrc` so Next.js uses Babel for transforms (the working path).
 *   3. Set `swcMinify: false` is NOT needed for dev mode.
 *
 * @param {WcTree} tree
 */
export function patchNextSwcWasm(tree) {
  const pkgNode = tree?.['package.json']
  if (!pkgNode?.file?.contents) return
  let pkg
  try {
    pkg = JSON.parse(pkgNode.file.contents)
  } catch {
    return
  }
  const deps = pkg.dependencies || {}
  const devDeps = pkg.devDependencies || {}
  const nextVer = deps.next || devDeps.next
  if (!nextVer) return // not a Next.js project

  // 1. Inject @next/swc-wasm-nodejs (still useful as a backup path).
  if (!deps['@next/swc-wasm-nodejs'] && !devDeps['@next/swc-wasm-nodejs']) {
    const wasmVer = String(nextVer).replace(/^[\^~]/, '')
    pkg.dependencies = { ...deps, '@next/swc-wasm-nodejs': wasmVer }
    pkgNode.file.contents = JSON.stringify(pkg, null, 2) + '\n'
  }

  // 2. Inject .babelrc — forces Next.js to use Babel for compilation,
  //    which is what actually unblocks WebContainer execution. We only
  //    add it if the project hasn't already declared a Babel config.
  const babelConfigCandidates = ['.babelrc', '.babelrc.json', 'babel.config.js', 'babel.config.json']
  const hasBabelConfig = babelConfigCandidates.some((p) => tree[p]?.file)
  if (!hasBabelConfig) {
    tree['.babelrc'] = {
      file: { contents: JSON.stringify({ presets: ['next/babel'] }, null, 2) + '\n' },
    }
  }
}

/**
 * Detect the project's actual root inside the mounted tree.
 *
 * Auroraly users frequently import nested-workspace projects:
 *   /
 *   ├── backend/
 *   └── frontend/    ← real React/Next.js app lives here
 *       ├── package.json
 *       └── src/...
 *
 * If the root has no package.json but a known workspace folder
 * (`frontend`, `web`, `client`, `app`, `apps/web`, `packages/web`)
 * does, we treat that folder as the cwd for npm install + dev.
 *
 * Returns:
 *   - cwd: '' for a flat project, or the relative directory path
 *   - packageJson: the parsed package.json at that cwd, or null
 *   - framework: 'next' | 'cra' | 'vite' | 'auroraly' | 'unknown'
 *
 * @param {WcTree} tree
 * @returns {{ cwd: string, packageJson: object|null, framework: string }}
 */
export function detectProjectLayout(tree) {
  const tryParse = (contents) => {
    try { return JSON.parse(contents) } catch { return null }
  }

  const pkgNode = (subtree) => subtree?.['package.json']?.file?.contents
  const dirNode = (subtree, name) => subtree?.[name]?.directory

  const classifyFramework = (pkg, scope) => {
    if (!pkg) return 'auroraly'
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    if (deps.next) return 'next'
    if (deps['react-scripts'] || deps['@craco/craco']) return 'cra'
    if (deps.vite) return 'vite'
    // Heuristic: index.html + react = vite-ish
    if (scope?.['index.html']?.file && deps.react) return 'vite'
    return 'unknown'
  }

  // 1) Flat project — root has package.json.
  const rootPkgRaw = pkgNode(tree)
  if (rootPkgRaw) {
    const pkg = tryParse(rootPkgRaw)
    return { cwd: '', packageJson: pkg, framework: classifyFramework(pkg, tree) }
  }

  // 2) Nested workspace — scan common candidate folders.
  const candidates = ['frontend', 'web', 'client', 'app']
  for (const name of candidates) {
    const sub = dirNode(tree, name)
    const subPkgRaw = pkgNode(sub)
    if (subPkgRaw) {
      const pkg = tryParse(subPkgRaw)
      return { cwd: name, packageJson: pkg, framework: classifyFramework(pkg, sub) }
    }
  }

  // 3) Nested monorepo (apps/web, packages/web).
  for (const parent of ['apps', 'packages']) {
    const parentDir = dirNode(tree, parent)
    if (!parentDir) continue
    for (const childName of ['web', 'app', 'client', 'frontend']) {
      const child = dirNode(parentDir, childName)
      const childPkgRaw = pkgNode(child)
      if (childPkgRaw) {
        const pkg = tryParse(childPkgRaw)
        return { cwd: `${parent}/${childName}`, packageJson: pkg, framework: classifyFramework(pkg, child) }
      }
    }
  }

  // 4) No package.json anywhere — assume Auroraly-generated content.
  return { cwd: '', packageJson: null, framework: 'auroraly' }
}

// Re-export so PreviewTab can detect CRA imports without reaching into
// the cra-to-vite module directly.
export { isCraPackage }

/**
 * Detect whether the imported project ships its own routing/build files.
 * Used to skip Auroraly's scaffolding injection.
 * @param {WcTree} scope - tree at the project's actual cwd
 */
function hasOwnRouter(scope) {
  const has = (path) => {
    const parts = path.split('/')
    let cursor = scope
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLeaf = i === parts.length - 1
      if (!cursor || typeof cursor !== 'object') return false
      if (isLeaf) return !!(cursor[seg] && cursor[seg].file)
      if (!cursor[seg] || !cursor[seg].directory) return false
      cursor = cursor[seg].directory
    }
    return false
  }
  const dir = (n) => !!(scope?.[n] && scope[n].directory)
  return (
    (dir('app') && (has('app/layout.jsx') || has('app/layout.js') || has('app/layout.tsx') || has('app/layout.ts'))) ||
    dir('pages') ||
    has('public/index.html') ||
    has('index.html') ||
    has('vite.config.js') ||
    has('vite.config.ts') ||
    has('craco.config.js') ||
    has('craco.config.ts')
  )
}


/**
 * Ensure every file the Next.js dev server needs to boot is present.
 * Auroraly generates content files (app/page.jsx, components/*.jsx, etc.)
 * but never emits the build-system scaffolding — this layer injects it
 * without stomping user files that happen to share the path.
 *
 * For IMPORTED projects (GitHub/ZIP) — including nested-workspace layouts
 * like `frontend/` containing a CRA app — we leave the project's files
 * entirely alone and only patch Next.js imports with the SWC/Babel
 * workaround.
 *
 * @param {WcTree} tree - already-nested tree from toWebContainerTree
 * @param {Object} [opts]
 * @param {string} [opts.projectName]
 * @returns {WcTree} new tree with scaffolding merged in
 */
export function ensureScaffolding(tree, opts = {}) {
  const out = { ...tree }

  const hasFile = (path) => {
    const parts = path.split('/')
    let cursor = out
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLeaf = i === parts.length - 1
      if (!cursor || typeof cursor !== 'object') return false
      if (isLeaf) return !!(cursor[seg] && cursor[seg].file)
      if (!cursor[seg] || !cursor[seg].directory) return false
      cursor = cursor[seg].directory
    }
    return false
  }

  const hasDir = (name) => !!(out[name] && out[name].directory)

  const putFile = (path, contents) => {
    if (hasFile(path)) return // never overwrite imported files
    const parts = path.split('/')
    let cursor = out
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLeaf = i === parts.length - 1
      if (isLeaf) {
        cursor[seg] = { file: { contents } }
        return
      }
      if (!cursor[seg] || !cursor[seg].directory) {
        cursor[seg] = { directory: {} }
      }
      cursor = cursor[seg].directory
    }
  }

  // Detect project layout — flat, nested workspace, or pure Auroraly content.
  const layout = detectProjectLayout(out)
  const scope = layout.cwd
    ? layout.cwd.split('/').reduce((acc, seg) => acc?.[seg]?.directory, out)
    : out

  if (layout.packageJson) {
    // Imported project (flat or nested workspace) — leave its files alone.
    if (layout.framework === 'cra' && scope) {
      // CRA + WebContainer don't get along — webpack-dev-server hits node-
      // native edges WC doesn't support. We auto-rewrite to Vite at mount
      // time. User app code (App.js, components/*) is untouched; only the
      // build chain is swapped.
      convertCraToVite(scope)
    } else if (layout.framework === 'next' && scope) {
      patchNextSwcWasm(scope)
    }

    // Always run the CJS-config-rename safety net, even for projects that
    // weren't classified as CRA. Two real cases hit this path:
    //   1. A project's stored MongoDB files are ALREADY post-conversion
    //      (Mangia-Mama after its first session converted CRA→Vite). On
    //      re-import isCraPackage() is false, convertCraToVite() skips,
    //      and a leftover postcss.config.js in CommonJS form crashes Vite
    //      with "module is not defined in ES module scope" because the
    //      package.json says `"type": "module"`.
    //   2. A user-authored Vite project that ships type:module +
    //      postcss.config.js with module.exports — same crash.
    // Renaming only fires when package.json declares type:module AND the
    // file actually uses CommonJS syntax, so legitimate ESM configs are
    // never touched.
    if (scope) {
      try {
        const pkgScopeNode = scope['package.json']?.file?.contents
        if (pkgScopeNode) {
          const pkgScope = JSON.parse(pkgScopeNode)
          if (pkgScope?.type === 'module') renameCjsConfigsToCjs(scope)
        }
      } catch { /* malformed package.json — leave alone */ }

      // CSS @import bubbling — Vite/Lightning-CSS rejects @import url(...)
      // statements that come after other rules (incl. @tailwind), and on
      // strict pipelines this drops the entire stylesheet, leaving pages
      // unstyled (= white screen). We rewrite every .css in the project
      // so @import sits at the top after any @charset.
      bubbleCssImportsInTree(scope)
    }

    return out
  }

  // Pure Auroraly-generated project (no package.json anywhere) — inject the
  // canonical Next.js 14 shell at root.
  const hasAppRouter = hasDir('app') && (
    hasFile('app/layout.jsx') || hasFile('app/layout.js') ||
    hasFile('app/layout.tsx') || hasFile('app/layout.ts')
  )
  const hasPagesRouter = hasDir('pages')

  putFile('package.json', buildPackageJson(opts.projectName))
  if (!hasFile('next.config.js') && !hasFile('next.config.mjs') && !hasFile('next.config.ts')) {
    putFile('next.config.js', NEXT_CONFIG_JS)
  }
  if (!hasFile('tailwind.config.js') && !hasFile('tailwind.config.ts')) {
    putFile('tailwind.config.js', TAILWIND_CONFIG_JS)
  }
  if (!hasFile('postcss.config.js') && !hasFile('postcss.config.mjs')) {
    putFile('postcss.config.js', POSTCSS_CONFIG_JS)
  }
  // .babelrc forces Babel-based compilation so Next.js boots inside
  // WebContainers (which block the native SWC binary).
  if (!hasFile('.babelrc') && !hasFile('.babelrc.json') && !hasFile('babel.config.js')) {
    putFile('.babelrc', JSON.stringify({ presets: ['next/babel'] }, null, 2) + '\n')
  }
  // Only inject app/* shell if there's no Pages router AND no existing layout.
  if (!hasPagesRouter && !hasAppRouter) {
    putFile('app/globals.css', GLOBALS_CSS)
    putFile('app/layout.jsx', APP_LAYOUT_JSX)
  }

  // Reference the helper to silence unused-export warnings — it's exported
  // for downstream callers that want to introspect the layout.
  void hasOwnRouter

  return out
}

/**
 * Detect the right dev command for the mounted tree. Honors nested-workspace
 * layouts (cwd points to where the dev server should be spawned).
 *
 * @param {WcTree} tree
 * @returns {{cmd: string, args: string[], cwd: string}}
 */
export function detectDevCommand(tree) {
  const layout = detectProjectLayout(tree)
  const scripts = layout.packageJson?.scripts || {}
  let args = ['run', 'dev']
  if (scripts.dev) {
    args = ['run', 'dev']
  } else if (scripts.start) {
    args = ['start']
  }
  return { cmd: 'npm', args, cwd: layout.cwd || '' }
}

/**
 * Flatten a WcTree back to `[{path, content}]` — useful for diffing
 * what we mounted vs. what's on disk in the sandbox.
 *
 * @param {WcTree} tree
 * @param {string} [prefix]
 * @returns {Array<{path: string, content: string}>}
 */
export function flattenTree(tree, prefix = '') {
  if (!tree || typeof tree !== 'object') return []
  const out = []
  for (const [name, node] of Object.entries(tree)) {
    const full = prefix ? `${prefix}/${name}` : name
    if (node?.file) {
      out.push({ path: full, content: node.file.contents })
    } else if (node?.directory) {
      out.push(...flattenTree(node.directory, full))
    }
  }
  return out
}
