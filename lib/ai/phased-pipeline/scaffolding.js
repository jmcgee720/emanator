// ──────────────────────────────────────────────────────────────────────
// /app/lib/ai/phased-pipeline/scaffolding.js
//
// Deterministic Next.js + Tailwind scaffolding files. Written after the
// LLM-driven compose phase completes so every generated project has the
// minimum framework boilerplate it needs to actually boot in the Fly
// preview-runner (package.json with a `dev` script, tailwind config,
// app/layout.jsx, app/globals.css, etc).
//
// Pre-Feb-2026 the pipeline assumed Claude would include these in
// plan.files. It never did — projects were missing the entire scaffold,
// the runner couldn't find a dev script, and previews silently failed
// to start. Writing them deterministically here removes the ambiguity:
// every Auroraly-generated project is a real, runnable Next.js app.
//
// Only writes files that DON'T already exist (Claude-generated files
// take precedence) — that lets us upgrade the stack later without
// silently overwriting user customizations.
// ──────────────────────────────────────────────────────────────────────

/**
 * Returns the full set of scaffolding files for a Next.js + Tailwind
 * project. Caller is responsible for writing them via db.projectFiles.
 *
 * @param {object} opts
 * @param {string} opts.projectName - human name, lowercased+slugged for npm
 * @param {object} [opts.tokens]    - Phase 3 design tokens (for CSS vars)
 * @param {boolean} [opts.fullstack] - true for fullstack_app archetype
 * @returns {Array<{path: string, content: string}>}
 */
export function buildScaffolding({ projectName = 'auroraly-project', tokens = null, fullstack = false } = {}) {
  const npmName = String(projectName)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'auroraly-project'

  const files = []

  // ─── package.json ────────────────────────────────────────────────
  // next ^14.2 because that's what the preview-runner already pulls
  // (warm-cache friendly). React 18 to match Next 14's peer range.
  // Tailwind/postcss/autoprefixer pinned to versions that work with
  // Next 14's built-in PostCSS pipeline. legacy-peer-deps is set by
  // the runner's .npmrc; no need to pin it here too.
  const pkg = {
    name: npmName,
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'next lint',
    },
    dependencies: {
      next: '^14.2.5',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      ...(fullstack ? { '@supabase/supabase-js': '^2.45.0' } : {}),
    },
    devDependencies: {
      tailwindcss: '^3.4.10',
      postcss: '^8.4.41',
      autoprefixer: '^10.4.20',
    },
  }
  files.push({ path: 'package.json', content: JSON.stringify(pkg, null, 2) + '\n' })

  // ─── next.config.js ──────────────────────────────────────────────
  // images.unoptimized = true so embedded data: URLs render without
  // next/image's loader complaining. No experimental flags.
  files.push({
    path: 'next.config.js',
    content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
}

module.exports = nextConfig
`,
  })

  // ─── tailwind.config.js ──────────────────────────────────────────
  // content paths cover every place the compose phase writes JSX.
  files.push({
    path: 'tailwind.config.js',
    content: `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
}
`,
  })

  // ─── postcss.config.js ───────────────────────────────────────────
  files.push({
    path: 'postcss.config.js',
    content: `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
  })

  // ─── app/globals.css ─────────────────────────────────────────────
  // CSS variables seeded from design tokens (Phase 3) so pages can
  // reference `var(--page-bg)` if they need a non-Tailwind hex.
  const cssVars = tokens?.palette
    ? Object.entries(tokens.palette)
        .map(([k, v]) => `  --${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v};`)
        .join('\n')
    : ''
  files.push({
    path: 'app/globals.css',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
${cssVars || '  /* design tokens not provided — pages use Tailwind classes only */'}
}

html, body { margin: 0; padding: 0; }
body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
`,
  })

  // ─── app/layout.jsx ──────────────────────────────────────────────
  // Minimal app-router layout — imports globals.css so Tailwind loads
  // on every page. Pages compose phase generates will be children.
  const displayName = String(projectName).replace(/"/g, '\\"')
  files.push({
    path: 'app/layout.jsx',
    content: `import './globals.css'

export const metadata = {
  title: '${displayName}',
  description: '${displayName} — built with Auroraly',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
  })

  // ─── jsconfig.json ───────────────────────────────────────────────
  // Enables the `@/` import prefix the compose prompt tells the AI to
  // use (e.g. `import db from '@/lib/db.js'`). Without this Next
  // would still resolve, but VS Code / TypeScript autocomplete works
  // way better with the explicit alias.
  files.push({
    path: 'jsconfig.json',
    content: JSON.stringify(
      { compilerOptions: { paths: { '@/*': ['./*'] } } },
      null,
      2,
    ) + '\n',
  })

  // ─── .gitignore ──────────────────────────────────────────────────
  // Helpful for users who export the project. The runner ignores
  // .gitignore — node_modules is kept on-disk between runs for warm
  // restarts, but .next/cache and similar can blow up to multi-GB.
  files.push({
    path: '.gitignore',
    content: `node_modules/
.next/
.env*.local
.DS_Store
*.log
`,
  })

  return files
}

/**
 * Merge required Tailwind + Next.js devDependencies / scripts into an
 * existing package.json without clobbering user customizations. Returns
 * the patched object + a boolean indicating whether anything actually
 * changed.
 *
 * Background: the LLM compose phase sometimes writes its own package.json
 * (e.g. with extra deps like framer-motion) but forgets the Tailwind
 * trio. The first scaffolding pass then skips ours because the file
 * exists, leaving `app/globals.css` with `@tailwind` directives but no
 * PostCSS plugin to process them → "Module parse failed: Unexpected
 * character '@'" build error.
 */
export function mergeRequiredPackageDeps(existing, { fullstack = false } = {}) {
  const pkg = existing && typeof existing === 'object' ? { ...existing } : {}
  let changed = false

  const requiredScripts = {
    dev: 'next dev',
    build: 'next build',
    start: 'next start',
    lint: 'next lint',
  }
  pkg.scripts = pkg.scripts && typeof pkg.scripts === 'object' ? { ...pkg.scripts } : {}
  for (const [k, v] of Object.entries(requiredScripts)) {
    if (!pkg.scripts[k]) {
      pkg.scripts[k] = v
      changed = true
    }
  }

  const requiredDeps = {
    next: '^14.2.5',
    react: '^18.3.1',
    'react-dom': '^18.3.1',
    ...(fullstack ? { '@supabase/supabase-js': '^2.45.0' } : {}),
  }
  pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === 'object' ? { ...pkg.dependencies } : {}
  for (const [k, v] of Object.entries(requiredDeps)) {
    if (!pkg.dependencies[k] && !pkg.devDependencies?.[k]) {
      pkg.dependencies[k] = v
      changed = true
    }
  }

  const requiredDevDeps = {
    tailwindcss: '^3.4.10',
    postcss: '^8.4.41',
    autoprefixer: '^10.4.20',
  }
  pkg.devDependencies = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? { ...pkg.devDependencies } : {}
  for (const [k, v] of Object.entries(requiredDevDeps)) {
    if (!pkg.devDependencies[k] && !pkg.dependencies[k]) {
      pkg.devDependencies[k] = v
      changed = true
    }
  }

  return { pkg, changed }
}
