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
 * Ensure every file the Next.js dev server needs to boot is present.
 * Auroraly generates content files (app/page.jsx, components/*.jsx, etc.)
 * but never emits the build-system scaffolding — this layer injects it
 * without stomping user files that happen to share the path.
 *
 * For IMPORTED projects (GitHub/ZIP) that already ship their own
 * package.json + next.config + app/layout, we leave them entirely alone
 * so we don't break Pages-router apps, custom Webpack configs, Vite
 * games, Phaser, etc.
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

  // Detect whether this is a fully-imported project that brings its own runtime.
  // If it ships package.json AND (pages/ or app/ or vite.config or index.html),
  // we treat it as self-contained and only fill in absolute essentials.
  const importedPackageJson = hasFile('package.json')
  const hasAppRouter = hasDir('app') && (
    hasFile('app/layout.jsx') || hasFile('app/layout.js') ||
    hasFile('app/layout.tsx') || hasFile('app/layout.ts')
  )
  const hasPagesRouter = hasDir('pages')
  const hasViteEntry = hasFile('index.html') || hasFile('vite.config.js') || hasFile('vite.config.ts')
  const isSelfContained = importedPackageJson && (hasAppRouter || hasPagesRouter || hasViteEntry)

  if (isSelfContained) {
    // Imported project — leave its files alone, but patch the package.json
    // to inject @next/swc-wasm-nodejs when Next.js is detected. WebContainers
    // are a WASM Node.js sandbox; the default native SWC binary fails to load
    // and Next.js dev never serves the first page.
    patchNextSwcWasm(out)
    return out
  }

  // Auroraly-generated project — inject the canonical Next.js 14 shell.
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

  return out
}

/**
 * Detect the right dev command for the mounted tree.
 * - If imported package.json has `dev` script → use `npm run dev`.
 * - If imported package.json only has `start` → use `npm start`.
 * - Else → fall back to `npx next dev` (auroraly default).
 *
 * @param {WcTree} tree
 * @returns {{cmd: string, args: string[]}}
 */
export function detectDevCommand(tree) {
  const pkgNode = tree?.['package.json']
  if (pkgNode?.file?.contents) {
    try {
      const pkg = JSON.parse(pkgNode.file.contents)
      const scripts = pkg.scripts || {}
      if (scripts.dev) return { cmd: 'npm', args: ['run', 'dev'] }
      if (scripts.start) return { cmd: 'npm', args: ['start'] }
    } catch { /* fall through */ }
  }
  return { cmd: 'npm', args: ['run', 'dev'] }
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
