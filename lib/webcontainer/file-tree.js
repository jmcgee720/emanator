// ══════════════════════════════════════════════════════════════════════
// ── WEBCONTAINER FILE TREE ──
// Pure module that converts the flat `[{path, content}]` file list
// produced by the Emanator pipeline into the nested `FileSystemTree`
// shape `@webcontainer/api`'s `mount()` expects.
//
// Also fills in the scaffolding files (package.json, next.config.js,
// tailwind.config.js, postcss.config.js) that Emanator's pipeline
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
 * Convert a flat Emanator file list to a nested WebContainer tree.
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
 * Deterministic package.json for an Emanator-generated Next.js 14 project.
 * Pinned to the same versions `/app` itself runs on so dependency conflicts
 * don't surface in the WebContainer-side npm install.
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
export const metadata = { title: 'Emanator Preview' }
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>)
}
`

/**
 * Ensure every file the Next.js dev server needs to boot is present.
 * Emanator generates content files (app/page.jsx, components/*.jsx, etc.)
 * but never emits the build-system scaffolding — this layer injects it
 * without stomping user files that happen to share the path.
 *
 * @param {WcTree} tree - already-nested tree from toWebContainerTree
 * @param {Object} [opts]
 * @param {string} [opts.projectName]
 * @returns {WcTree} new tree with scaffolding merged in
 */
export function ensureScaffolding(tree, opts = {}) {
  const out = { ...tree }

  const putFile = (path, contents) => {
    const parts = path.split('/')
    let cursor = out
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLeaf = i === parts.length - 1
      if (isLeaf) {
        if (!cursor[seg]) cursor[seg] = { file: { contents } }
        return
      }
      if (!cursor[seg] || !cursor[seg].directory) {
        cursor[seg] = { directory: {} }
      }
      cursor = cursor[seg].directory
    }
  }

  putFile('package.json', buildPackageJson(opts.projectName))
  putFile('next.config.js', NEXT_CONFIG_JS)
  putFile('tailwind.config.js', TAILWIND_CONFIG_JS)
  putFile('postcss.config.js', POSTCSS_CONFIG_JS)
  putFile('app/globals.css', GLOBALS_CSS)
  putFile('app/layout.jsx', APP_LAYOUT_JSX)

  return out
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
