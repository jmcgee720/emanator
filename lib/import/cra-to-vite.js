/**
 * CRA → Vite import-time converter
 *
 * Auroraly's preview infrastructure can't reliably run CRA (`react-scripts`)
 * apps because:
 *   - CRA was deprecated by Facebook in 2023; its dep tree is structurally
 *     rotten (ajv@6 vs ajv-keywords@5, schema-utils@2 vs babel-loader@8, etc.)
 *   - Even with overrides, downstream errors cascade endlessly
 *
 * Solution: when a user imports a CRA-shaped project, transform it to Vite
 * BEFORE the files are written to Supabase. Vite has a clean dep tree, boots
 * in 2 seconds, and the existing Fly runner already supports it.
 *
 * This module is pure-function: takes an array of {path, content} files,
 * returns a new array. No I/O, no side effects.
 */

/**
 * Detect whether a file array represents a CRA project.
 * Returns true if any package.json (root or nested) lists react-scripts.
 */
export function isCRAProject(files) {
  return files.some(f => {
    if (!/(?:^|\/)package\.json$/.test(f.path)) return false
    try {
      const pkg = JSON.parse(f.content)
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      return !!deps['react-scripts']
    } catch { return false }
  })
}

/**
 * Find the workspace root inside the file tree. CRA projects are often nested
 * under `frontend/`, `web/`, `client/`, `app/` etc. — we want to operate on
 * whichever directory contains the package.json with react-scripts.
 *
 * Returns the directory prefix (e.g., "frontend/" or "" for root) or null.
 */
export function findCRARoot(files) {
  for (const f of files) {
    if (!/(?:^|\/)package\.json$/.test(f.path)) continue
    try {
      const pkg = JSON.parse(f.content)
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      if (!deps['react-scripts']) continue
      const dir = f.path.replace(/package\.json$/, '')
      return dir // e.g., "frontend/" or ""
    } catch { /* skip */ }
  }
  return null
}

/**
 * Find the entry source file relative to the CRA root.
 * Returns "src/index.jsx" / "src/index.js" / "src/index.tsx" / "src/main.tsx" etc.
 * Falls back to "src/index.jsx" if nothing found.
 */
export function findEntryFile(files, root) {
  const candidates = [
    'src/index.tsx', 'src/index.ts',
    'src/index.jsx', 'src/index.js',
    'src/main.tsx', 'src/main.ts',
    'src/main.jsx', 'src/main.js',
    'src/App.tsx', 'src/App.jsx', 'src/App.js',
  ]
  for (const c of candidates) {
    const fullPath = root + c
    if (files.some(f => f.path === fullPath)) return c
  }
  return 'src/index.jsx'
}

/**
 * Parse craco.config.js for `webpack.alias` and convert to vite.resolve.alias.
 * craco aliases use Node `path.resolve(__dirname, 'src')` patterns; we
 * literal-translate those to Vite's expected path-import syntax.
 *
 * Best-effort: regex-based, since we don't want a full JS parser. Returns
 * an object like { '@': './src' }. Vite accepts string or absolute paths.
 */
export function parseCRACoAliases(cracoContent) {
  if (!cracoContent) return {}
  const aliases = {}
  // Match `'@': path.resolve(__dirname, 'src')` or `"@": path.resolve(__dirname, "src/components")`
  const re = /['"]([^'"]+)['"]\s*:\s*path\.resolve\s*\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(cracoContent)) !== null) {
    aliases[m[1]] = './' + m[2].replace(/^\.?\/?/, '')
  }
  return aliases
}

/**
 * Generate a fresh vite.config.js body for a CRA-converted project.
 */
export function generateViteConfig(aliases, hasReactPlugin = true) {
  const aliasEntries = Object.entries(aliases)
  const aliasBlock = aliasEntries.length === 0
    ? ''
    : `  resolve: {
    alias: {
${aliasEntries.map(([k, v]) => `      '${k}': new URL('${v}', import.meta.url).pathname,`).join('\n')}
    },
  },\n`
  return `import { defineConfig } from 'vite'
${hasReactPlugin ? `import react from '@vitejs/plugin-react'\n` : ''}
export default defineConfig({
  plugins: [${hasReactPlugin ? `react({ include: /\\.(js|jsx|ts|tsx)$/ })` : ''}],
${aliasBlock}  // CRA traditionally allowed JSX inside .js files; tell esbuild to parse
  // them as JSX so converted projects don't break on \`<App />\` in .js entries.
  esbuild: {
    loader: 'jsx',
    include: /src\\/.*\\.(js|jsx|ts|tsx)$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    allowedHosts: true,
    headers: {
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': "frame-ancestors *",
    },
    hmr: { clientPort: 443, protocol: 'wss' },
  },
})
`
}

/**
 * Generate a Vite-shaped index.html (root level), based on the CRA's
 * public/index.html. Replaces CRA template tags (%PUBLIC_URL%, %REACT_APP_*%)
 * and injects the module script tag.
 */
export function generateRootIndexHtml(craIndexHtml, entryFile) {
  if (!craIndexHtml) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entryFile}"></script>
  </body>
</html>
`
  }
  let html = craIndexHtml
  // Strip CRA template tags. %PUBLIC_URL% becomes empty (Vite serves public/ at root).
  html = html.replace(/%PUBLIC_URL%/g, '')
  // %REACT_APP_FOO% — leave a comment, since these resolve at build time.
  html = html.replace(/%REACT_APP_[A-Z0-9_]+%/g, '')
  // Inject module script tag before </body> if not already there.
  if (!/<script[^>]*type=["']module["']/.test(html)) {
    const scriptTag = `    <script type="module" src="/${entryFile}"></script>\n  `
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, scriptTag + '</body>')
    } else {
      html = html + '\n' + scriptTag
    }
  }
  return html
}

/**
 * The set of CRA-specific dev-time deps to remove. Their presence breaks
 * Vite installs (eslint-config-react-app pulls a 600-package eslint subtree
 * that has its own ajv issues, etc.).
 */
const CRA_DEPS_TO_REMOVE = [
  'react-scripts',
  '@craco/craco',
  'craco',
  '@craco/cli',
  'eslint-config-react-app',
  'fork-ts-checker-webpack-plugin',
  'workbox-webpack-plugin',
  'workbox-cacheable-response',
  'workbox-google-analytics',
  '@pmmmwh/react-refresh-webpack-plugin',
]

/**
 * Build a fresh package.json mutating the original's deps + scripts to
 * be Vite-shaped.
 */
export function transformPackageJson(originalPkg, hasTypeScript) {
  const pkg = JSON.parse(JSON.stringify(originalPkg)) // deep clone
  pkg.dependencies = pkg.dependencies || {}
  pkg.devDependencies = pkg.devDependencies || {}

  // 1. Remove CRA-specific deps from both dep buckets.
  for (const name of CRA_DEPS_TO_REMOVE) {
    delete pkg.dependencies[name]
    delete pkg.devDependencies[name]
  }

  // 2. Add Vite + plugin-react. Pin to known-good major versions.
  pkg.devDependencies['vite'] = '^5.4.0'
  pkg.devDependencies['@vitejs/plugin-react'] = '^4.3.0'
  if (hasTypeScript && !pkg.devDependencies['typescript'] && !pkg.dependencies['typescript']) {
    pkg.devDependencies['typescript'] = '^5.5.0'
  }

  // 3. Rewrite scripts to Vite-canonical commands.
  pkg.scripts = pkg.scripts || {}
  pkg.scripts.dev = 'vite'
  pkg.scripts.start = 'vite' // some users still type `npm start` reflexively
  pkg.scripts.build = 'vite build'
  pkg.scripts.preview = 'vite preview'
  // Drop CRA-specific scripts that won't work anymore.
  delete pkg.scripts.eject
  delete pkg.scripts.test // CRA's `react-scripts test` won't work; user can re-add Vitest later

  // 4. Drop CRA's eslintConfig (extends `react-app` which we just removed).
  delete pkg.eslintConfig

  // 5. Drop CRA's `browserslist` only if it's the default CRA boilerplate.
  // (Keep custom browserslist configs.) Heuristic: default CRA has the
  // "production"/"development" split with specific hardcoded entries.
  if (pkg.browserslist && pkg.browserslist.production && pkg.browserslist.development) {
    delete pkg.browserslist
  }

  // 6. Strip any `overrides` we may have injected during runner attempts.
  delete pkg.overrides

  return pkg
}

/**
 * Strip CRA-specific imports from the entry file (e.g., reportWebVitals).
 * These break under Vite if not removed.
 */
export function cleanEntryImports(entryContent) {
  if (!entryContent) return entryContent
  let content = entryContent
  // Remove `import reportWebVitals from './reportWebVitals'` and its call site.
  content = content.replace(/import\s+\w+\s+from\s+['"]\.\/reportWebVitals['"];?\s*\n?/g, '')
  content = content.replace(/^[ \t]*reportWebVitals\([^)]*\);?\s*\n?/gm, '')
  // Remove serviceWorker imports (CRA-specific).
  content = content.replace(/import\s+\*\s+as\s+serviceWorker\s+from\s+['"][^'"]*serviceWorker[^'"]*['"];?\s*\n?/g, '')
  content = content.replace(/^[ \t]*serviceWorker\.\w+\(\);?\s*\n?/gm, '')
  // Rewrite REACT_APP_FOO env access → import.meta.env.VITE_FOO (best-effort).
  content = content.replace(/process\.env\.REACT_APP_([A-Z0-9_]+)/g, 'import.meta.env.VITE_$1')
  return content
}

/**
 * Main entry: transform an array of {path, content} files. Returns a NEW
 * array (input is not mutated). If the input is not a CRA project, returns
 * the original array unchanged.
 *
 * Returns an object: { files, converted, root, entryFile, summary }
 *   - files: transformed array (or original if not CRA)
 *   - converted: boolean
 *   - root: detected CRA workspace prefix
 *   - entryFile: detected entry relative to root
 *   - summary: human-readable transform log lines
 */
export function convertCRAtoVite(files) {
  if (!isCRAProject(files)) {
    return { files, converted: false, root: null, entryFile: null, summary: [] }
  }
  const root = findCRARoot(files)
  if (root === null) {
    return { files, converted: false, root: null, entryFile: null, summary: ['CRA detected but root could not be located'] }
  }

  const summary = [`CRA → Vite conversion at root="${root || './'}"`]
  const out = []
  const seenPaths = new Set()
  let entryFile = findEntryFile(files, root)
  const hasTypeScript = files.some(f => f.path.startsWith(root) && /\.tsx?$/.test(f.path))
  if (hasTypeScript && !/\.tsx?$/.test(entryFile)) {
    // If the project is TS-heavy, re-detect entry preferring .tsx
    const tsCandidates = ['src/main.tsx', 'src/index.tsx']
    for (const c of tsCandidates) {
      if (files.some(f => f.path === root + c)) { entryFile = c; break }
    }
  }

  // Locate craco config + CRA index.html for translation.
  const cracoFile = files.find(f => f.path === root + 'craco.config.js')
  const aliases = parseCRACoAliases(cracoFile?.content || '')
  if (Object.keys(aliases).length > 0) {
    summary.push(`carried over aliases from craco.config.js: ${Object.keys(aliases).join(', ')}`)
  }
  const craIndexHtml = files.find(f => f.path === root + 'public/index.html')

  for (const f of files) {
    // Process files inside the CRA root only.
    if (root && !f.path.startsWith(root)) {
      out.push(f)
      seenPaths.add(f.path)
      continue
    }
    const rel = f.path.slice(root.length) // path relative to CRA root

    // package.json — transform deps & scripts.
    if (rel === 'package.json') {
      try {
        const pkg = JSON.parse(f.content)
        const newPkg = transformPackageJson(pkg, hasTypeScript)
        out.push({ ...f, content: JSON.stringify(newPkg, null, 2) + '\n' })
        seenPaths.add(f.path)
        summary.push('rewrote package.json (vite scripts + deps)')
        continue
      } catch (e) {
        summary.push(`package.json parse failed: ${e.message}`)
      }
    }

    // craco.config.js — drop, replaced by vite.config.js
    if (rel === 'craco.config.js') {
      summary.push('removed craco.config.js')
      seenPaths.add(f.path)
      continue
    }

    // public/index.html — relocate to root index.html (handled below)
    if (rel === 'public/index.html') {
      seenPaths.add(f.path)
      continue
    }

    // src/index.{js,jsx,ts,tsx} or src/main.{js,jsx,ts,tsx} — clean CRA imports
    if (/^src\/(index|main)\.(jsx?|tsx?)$/.test(rel)) {
      const cleaned = cleanEntryImports(f.content)
      if (cleaned !== f.content) summary.push(`cleaned CRA imports from ${rel}`)
      out.push({ ...f, content: cleaned })
      seenPaths.add(f.path)
      continue
    }

    // src/reportWebVitals.{js,ts} or src/serviceWorker.{js,ts} — drop
    if (/^src\/(reportWebVitals|serviceWorker|setupTests)\.(jsx?|tsx?)$/.test(rel)) {
      summary.push(`removed CRA-specific ${rel}`)
      seenPaths.add(f.path)
      continue
    }

    // .env files — rewrite REACT_APP_* → VITE_*
    if (/^\.env(\..+)?$/.test(rel) || /\/\.env(\..+)?$/.test(f.path)) {
      const newContent = f.content.replace(/^REACT_APP_/gm, 'VITE_')
      if (newContent !== f.content) summary.push(`rewrote ${rel}: REACT_APP_* → VITE_*`)
      out.push({ ...f, content: newContent })
      seenPaths.add(f.path)
      continue
    }

    // Default: pass through as-is.
    out.push(f)
    seenPaths.add(f.path)
  }

  // Inject vite.config.js at the CRA root.
  const viteConfigPath = root + 'vite.config.js'
  if (!seenPaths.has(viteConfigPath)) {
    out.push({
      path: viteConfigPath,
      content: generateViteConfig(aliases, true),
      file_type: 'js',
    })
    summary.push(`generated ${viteConfigPath}`)
  }

  // Inject root index.html (Vite expects it at workspace root, NOT in /public).
  const rootIndexPath = root + 'index.html'
  if (!seenPaths.has(rootIndexPath)) {
    out.push({
      path: rootIndexPath,
      content: generateRootIndexHtml(craIndexHtml?.content || '', entryFile),
      file_type: 'html',
    })
    summary.push(`generated ${rootIndexPath} from ${craIndexHtml ? 'public/index.html' : 'scratch'}`)
  }

  // Drop the public/index.html (Vite uses root index.html instead).
  // Already excluded via the loop's seenPaths logic above.

  return { files: out, converted: true, root, entryFile, summary }
}
