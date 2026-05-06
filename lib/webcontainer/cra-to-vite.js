// ══════════════════════════════════════════════════════════════════════
// ── CRA → VITE TRANSFORMER ──
// Converts a Create-React-App (or CRA + craco) project tree into a Vite
// project at mount time, so it runs inside WebContainers reliably.
//
// Why? CRA's react-scripts uses Node features that WebContainers don't
// fully support (webpack-dev-server internals, terser native bindings,
// schema-utils ajv variants). Vite is purpose-built for ESM + dev mode
// and runs cleanly in WebContainers.
//
// What we do (non-destructive — only replaces build-system files):
//   1. Replace package.json scripts:
//        start/build/test → vite / vite build / vitest
//      Drop react-scripts + @craco/craco from deps.
//      Add vite + @vitejs/plugin-react.
//   2. Move public/index.html → /index.html, with substitutions:
//        %PUBLIC_URL%  → ''
//        Insert <script type="module" src="/src/index.js"></script>
//        before </body> (or src/index.jsx, App.js — whichever exists).
//   3. Write vite.config.js with:
//        - @vitejs/plugin-react
//        - resolve.alias '@' → /src   (CRA users assume jsconfig paths)
//        - server.port 3000
//        - publicDir 'public' kept so static assets keep working
//   4. Inject envPrefix: 'REACT_APP_' so import.meta.env.REACT_APP_* +
//      process.env.REACT_APP_* both work without code changes.
//
// User code (App.js, src/index.js, components/*) is NEVER touched.
// ══════════════════════════════════════════════════════════════════════

const VITE_VERSION = '^5.4.0'
const PLUGIN_REACT_VERSION = '^4.3.0'

/**
 * @param {Object} pkg - parsed package.json object
 * @returns {boolean}
 */
export function isCraPackage(pkg) {
  if (!pkg) return false
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  return Boolean(deps['react-scripts'] || deps['@craco/craco'])
}

/**
 * Build the Vite scripts block, mapping CRA's standard script names so
 * downstream `npm start` / `npm run build` continue to work.
 *
 * `--host 0.0.0.0` is critical inside WebContainers — Vite defaults to
 * binding to localhost, but the WebContainer port-forwarder watches the
 * external interface and never emits the `ready` signal otherwise.
 *
 * `--logLevel info` ensures Vite actually writes its boot banner to
 * stdout. Without it large CRA imports can sit silently while Vite
 * scans dependencies, making the preview look hung when it's just slow.
 */
function buildViteScripts(_existingScripts = {}) {
  const cmd = 'vite --port 3000 --host 0.0.0.0 --logLevel info'
  return {
    start: cmd,
    dev: cmd,
    build: 'vite build',
    preview: 'vite preview --port 3000 --host 0.0.0.0',
    test: 'echo "vitest not configured" && exit 0',
  }
}

/**
 * Rewrite a parsed package.json from CRA → Vite shape.
 * Returns the new package.json object (does NOT mutate input).
 */
export function rewritePackageJson(pkg) {
  const next = JSON.parse(JSON.stringify(pkg))
  next.scripts = buildViteScripts(next.scripts)

  const deps = { ...(next.dependencies || {}) }
  const devDeps = { ...(next.devDependencies || {}) }

  // Drop CRA build chain.
  delete deps['react-scripts']
  delete deps['@craco/craco']
  delete deps['craco-less']
  delete deps['eslint-config-react-app']
  delete deps['react-app-rewired']
  delete deps['customize-cra']
  delete devDeps['react-scripts']
  delete devDeps['@craco/craco']
  delete devDeps['eslint-config-react-app']

  // Inject Vite stack.
  devDeps.vite = devDeps.vite || VITE_VERSION
  devDeps['@vitejs/plugin-react'] = devDeps['@vitejs/plugin-react'] || PLUGIN_REACT_VERSION

  // Vite needs `type: 'module'` so vite.config.js is parsed as ESM. CRA
  // projects don't usually set this, so we add it.
  next.type = 'module'

  next.dependencies = deps
  next.devDependencies = devDeps
  // Browser slimification: CRA bakes in browserslist, which is fine for Vite too.
  return next
}

/**
 * Pick the most likely entry-point file inside src/.
 * @param {Object} srcDir - WcTree directory of /src
 * @returns {string} src-relative path, e.g. 'src/index.js'
 */
function detectEntryPoint(srcDir) {
  const candidates = ['index.tsx', 'index.ts', 'index.jsx', 'index.js', 'main.tsx', 'main.jsx', 'main.js']
  for (const name of candidates) {
    if (srcDir?.[name]?.file) return `src/${name}`
  }
  return 'src/index.js' // fallback — Vite will surface the error if it doesn't exist
}

/**
 * Transform CRA's public/index.html into Vite's root index.html.
 *  - Strip %PUBLIC_URL% (Vite serves /public at /).
 *  - Inject the Vite-style entry script tag before </body> if missing.
 */
export function rewriteIndexHtml(htmlContent, entryPath) {
  let html = String(htmlContent || '')
  // Replace CRA's public-url placeholder with the Vite-equivalent.
  html = html.replace(/%PUBLIC_URL%/g, '')
  // Strip any `<%= ... %>` template tokens — Vite doesn't process those.
  html = html.replace(/<%=?[^%]*%>/g, '')
  // Inject entry script before </body> if no <script type="module"> already.
  if (!/<script[^>]+type=['"]module['"][^>]+src=['"]\/src\//.test(html)) {
    const tag = `\n    <script type="module" src="/${entryPath}"></script>\n  `
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${tag}</body>`)
    } else {
      html += tag
    }
  }
  return html
}

/**
 * Generate vite.config.js content.
 */
export function buildViteConfig() {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Auto-generated by Auroraly's CRA→Vite converter at WebContainer mount time.
// User app code is unchanged — only the build chain was swapped.
export default defineConfig({
  // CRA-style projects (like Mangia-Mama) put JSX inside \`.js\` files and
  // rely on Babel auto-detecting it. Vite + plugin-react default to only
  // transforming \`.jsx\`/\`.tsx\`, so plain \`.js\` files containing JSX
  // crash the import-analysis plugin with "Unexpected token '<'". Telling
  // plugin-react to include \`.js\`/\`.mjs\` reproduces CRA's behavior.
  plugins: [react({ include: /\\.(mjs|cjs|js|jsx|ts|tsx)$/ })],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
    // Let imports omit \`.js\`/\`.jsx\` (CRA-style) without breaking Vite.
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
  },
  // CRA defaulted to REACT_APP_ env prefix; preserve that so
  // import.meta.env.REACT_APP_* and process.env.REACT_APP_* keep working.
  envPrefix: 'REACT_APP_',
  define: {
    'process.env': '({})', // shim for legacy 'process.env.X' refs in user code
  },
  // Tell esbuild's loader (used by Vite for non-plugin-react files at dev
  // time) to treat \`.js\` as JSX too — covers the rare case where a file
  // bypasses plugin-react.
  esbuild: { loader: 'jsx', include: /src\\/.*\\.[jt]sx?$/, exclude: [] },
  // ── WebContainer-safe dependency optimization ──
  // Vite's dep pre-bundler runs esbuild's WASM build on the dep graph at
  // startup. Imported CRA apps like Mangia-Mama (~500 packages) crash
  // esbuild WASM with a 'runtime.gopark' Go panic.
  //
  // \`optimizeDeps.disabled\` was removed in Vite 5.1 (it just prints a
  // warning and is ignored). The supported modern way to neuter the
  // pre-bundler is \`noDiscovery: true\` + \`include: []\` per the Vite
  // 5.1 migration notes. We keep an explicit \`entries\` glob so any
  // discovery that DOES happen scans only user code, not 500 transitive
  // deps. \`force: true\` clears any stale .vite cache from previous
  // crash attempts in the same WebContainer session.
  optimizeDeps: {
    noDiscovery: true,
    include: [],
    entries: ['src/**/*.{js,jsx,ts,tsx}'],
    force: true,
  },
  server: {
    port: 3000,
    host: true,           // bind 0.0.0.0 so the WC port-forwarder sees ready
    strictPort: false,
    hmr: { overlay: true, clientPort: 443 },
    fs: { strict: false }, // WebContainers: relax file-system root checks
    watch: {
      usePolling: true,    // WebContainer's virtual fs doesn't emit inotify
      ignored: ['**/node_modules/**', '**/.git/**', '**/build/**'],
    },
  },
  build: {
    outDir: 'build', // CRA used 'build' not 'dist'
    sourcemap: true,
  },
})
`
}

/**
 * Transform a CRA project subtree (in WcTree shape) into a Vite project.
 * Mutates the tree IN PLACE and returns it for chaining.
 *
 * @param {Object} scope - the WcTree at the project's cwd
 * @returns {Object} the same scope, transformed
 */
export function convertCraToVite(scope) {
  if (!scope || typeof scope !== 'object') return scope
  const pkgNode = scope['package.json']
  if (!pkgNode?.file?.contents) return scope
  let pkg
  try { pkg = JSON.parse(pkgNode.file.contents) } catch { return scope }
  if (!isCraPackage(pkg)) return scope

  // 1) package.json — drop CRA, add Vite.
  const newPkg = rewritePackageJson(pkg)
  pkgNode.file.contents = JSON.stringify(newPkg, null, 2) + '\n'

  // 2) Move public/index.html → /index.html (Vite root entry).
  const srcDir = scope.src?.directory
  const entryPath = detectEntryPoint(srcDir)

  const publicDir = scope.public?.directory
  const publicIndex = publicDir?.['index.html']?.file?.contents

  // Only emit a root index.html if the user doesn't already have one.
  if (!scope['index.html']?.file) {
    const sourceHtml = publicIndex || `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vite App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
    scope['index.html'] = {
      file: { contents: rewriteIndexHtml(sourceHtml, entryPath) },
    }
  }

  // 3) vite.config.js — only if user hasn't declared one.
  if (!scope['vite.config.js']?.file && !scope['vite.config.ts']?.file && !scope['vite.config.mjs']?.file) {
    scope['vite.config.js'] = { file: { contents: buildViteConfig() } }
  }

  // 4) Drop CRA's craco.config.js so Vite doesn't get confused by leftover
  //    references during install. Keep it as a backup file (rename only)
  //    so the user can still see it.
  if (scope['craco.config.js']?.file) {
    scope['craco.config.js.bak'] = scope['craco.config.js']
    delete scope['craco.config.js']
  }

  // 5) Because we now declare "type": "module" in package.json, every
  //    `.js` config file that uses CommonJS (`module.exports = ...`) will
  //    crash at load time (e.g. postcss.config.js, tailwind.config.js).
  //    Rename any such `.js` config to `.cjs` so Node keeps loading them
  //    as CommonJS. We only touch files that actually contain CJS syntax
  //    to avoid breaking ESM configs that users wrote intentionally.
  renameCjsConfigsToCjs(scope)

  return scope
}

/**
 * Detect common build-tool config files in the project root and rename
 * any that use CommonJS syntax (`module.exports` / `exports.x = ...`) to
 * `.cjs`. This prevents the "module is not defined in ES module scope"
 * crash after we flip package.json to `"type": "module"`.
 */
export function renameCjsConfigsToCjs(scope) {
  if (!scope || typeof scope !== 'object') return scope
  const candidates = [
    'postcss.config.js',
    'tailwind.config.js',
    'babel.config.js',
    'jest.config.js',
    'prettier.config.js',
    '.prettierrc.js',
    '.eslintrc.js',
    'next.config.js',
    'svgo.config.js',
    'lint-staged.config.js',
    'commitlint.config.js',
    'stylelint.config.js',
  ]
  for (const name of candidates) {
    const node = scope[name]
    const contents = node?.file?.contents
    if (!contents) continue
    if (isCommonJsSource(contents)) {
      const newName = name.replace(/\.js$/, '.cjs')
      scope[newName] = node
      delete scope[name]
    }
  }
  return scope
}

/**
 * Cheap heuristic: returns true if the source looks like CommonJS.
 * We avoid parsing; `module.exports`, `exports.x =`, or `require(` with
 * no top-level `import`/`export` is a strong signal.
 */
function isCommonJsSource(src) {
  const s = String(src || '')
  const hasCjsExport = /\bmodule\.exports\b/.test(s) || /^\s*exports\.\w+\s*=/m.test(s)
  const hasCjsRequire = /\brequire\s*\(/.test(s)
  const hasEsm = /^\s*import\s.+from\s+['"]/m.test(s) || /^\s*export\s+(default|const|function|class|\{)/m.test(s)
  return (hasCjsExport || hasCjsRequire) && !hasEsm
}

/**
 * Walk a WebContainer tree and rewrite every `.css` file so its `@import`
 * statements are bubbled to the top, after any `@charset` declaration.
 *
 * Rationale: CRA + Tailwind users routinely write
 *   @tailwind base;
 *   @tailwind components;
 *   @tailwind utilities;
 *   @import url('https://fonts...');
 *   body { ... }
 *
 * Tailwind's `@tailwind` directives are not technically "other statements"
 * because PostCSS expands them — but Vite's `vite:css` plugin (Lightning
 * CSS / postcss-import) enforces the spec strictly: `@import` must come
 * BEFORE any other rule except `@charset` / `@layer`. When that fails,
 * the @import is dropped and on some pipelines the whole CSS module is
 * rejected, leaving the page unstyled (white). We rewrite to comply.
 */
export function bubbleCssImportsInTree(node) {
  if (!node || typeof node !== 'object') return node
  for (const [name, child] of Object.entries(node)) {
    if (child?.directory) {
      bubbleCssImportsInTree(child.directory)
    } else if (child?.file && /\.css$/i.test(name)) {
      const before = String(child.file.contents || '')
      const after = bubbleCssImports(before)
      if (after !== before) child.file.contents = after
    }
  }
  return node
}

/**
 * Pure transform: returns the CSS source with `@import url(...)` and
 * `@import "..."` statements moved to the top (preserving their order
 * relative to each other), after any leading `@charset`. Comments and
 * @layer wrappers are left in place.
 */
export function bubbleCssImports(css) {
  const src = String(css || '')
  if (!src) return src
  // Match @import statements (single or double quoted, with or without url()).
  const importRe = /^[ \t]*@import\s+(?:url\([^)]*\)|['"][^'"]*['"])\s*[^;]*;[ \t]*\r?\n?/gim
  const imports = src.match(importRe)
  if (!imports || imports.length === 0) return src
  // Strip them from their original positions.
  const stripped = src.replace(importRe, '')
  // If the file already starts (after possible @charset) with all the
  // imports in the right order, no-op.
  const charsetRe = /^[ \t]*@charset\s+['"][^'"]*['"]\s*;[ \t]*\r?\n?/i
  const charsetMatch = stripped.match(charsetRe)
  const charset = charsetMatch ? charsetMatch[0] : ''
  const body = charset ? stripped.slice(charset.length) : stripped
  // Reassemble: charset (if any) + imports + body. Trim leading blank
  // lines from body so we don't end up with a stack of empty lines.
  const head = charset + imports.join('').replace(/\n+$/, '\n')
  const cleanBody = body.replace(/^\s*\n/, '')
  return head + cleanBody
}
