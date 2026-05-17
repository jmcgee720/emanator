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
// Mid-Feb-2026: tightened further — framework files (postcss.config.js,
// tailwind.config.js, app/globals.css, app/layout.jsx, next.config.js)
// are now AUTHORITATIVE infrastructure, NOT user-customizable. The
// scaffolding pass force-overwrites them every build, and the compose
// phase strips them from plan.files before handing it to Claude. This
// closes the failure mode where Claude generated a half-broken
// postcss.config.js or a globals.css with junk CSS vars that crashed
// PostCSS compilation.
// ──────────────────────────────────────────────────────────────────────

/**
 * Paths that are pure framework infrastructure. The compose phase MUST
 * NOT pass these to Claude, and the scaffolding pass MUST always write
 * them with our canonical content (never deferring to a pre-existing
 * version in the DB, except `package.json` which gets MERGED instead of
 * overwritten so user deps survive).
 */
export const FRAMEWORK_PATHS = Object.freeze([
  'package.json',           // merged (preserves user deps), not overwritten
  'next.config.js',
  'tailwind.config.js',
  'postcss.config.js',
  'app/globals.css',
  'app/layout.jsx',
  'jsconfig.json',
  '.gitignore',
])

/**
 * Subset of FRAMEWORK_PATHS that should be FORCE-OVERWRITTEN every build
 * (i.e. we don't trust Claude or any earlier scaffolding to have produced
 * them correctly). package.json is excluded — it gets merged separately
 * to preserve user-added deps like framer-motion.
 */
export const FORCE_OVERWRITE_PATHS = Object.freeze([
  'next.config.js',
  'tailwind.config.js',
  'postcss.config.js',
  'app/globals.css',
  'app/layout.jsx',
])

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
  // Next 14's built-in PostCSS pipeline.
  //
  // CRITICAL: the Tailwind trio lives in `dependencies`, NOT
  // `devDependencies`. Fly auto-sets NODE_ENV=production on Node
  // containers, which makes `npm install` silently skip devDependencies
  // — even when our preview is functionally a dev environment. Parking
  // them in `dependencies` makes them install regardless of NODE_ENV.
  // We also override NODE_ENV in the runner's spawn (defense in depth),
  // but this placement is the durable fix.
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
      tailwindcss: '^3.4.10',
      postcss: '^8.4.41',
      autoprefixer: '^10.4.20',
      ...(fullstack ? { '@supabase/supabase-js': '^2.45.0' } : {}),
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
  // CSS variables seeded from design tokens (Phase 3) ONLY when those
  // tokens are concrete hex/rgb values. We previously serialized
  // Tailwind class names ("bg-neutral-950") and `[object Object]`
  // straight into :root which produced invalid CSS variable values.
  // Filter strictly: pass through plain CSS color strings and skip
  // anything we can't safely emit.
  //
  // Detection rules:
  //   • hex (`#abc` / `#abcdef` / `#abcdef80`) → keep
  //   • CSS functional color (`rgb(...)`, `rgba(...)`, `hsl(...)`,
  //     `hsla(...)`, `oklch(...)`, `oklab(...)`) → keep
  //   • literal `transparent` / `currentColor` keyword → keep
  //   • token is an object with a `.hex` string → keep that
  //   • everything else (Tailwind class names like "bg-neutral-950",
  //     `[object Object]`, arbitrary strings) → drop
  const NAMED_COLORS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset'])
  const isCssColor = (v) => {
    if (typeof v !== 'string') return false
    const t = v.trim().toLowerCase()
    if (!t) return false
    if (/^#[0-9a-f]{3,8}$/.test(t)) return true
    if (/^(rgb|rgba|hsl|hsla|oklch|oklab|color|hwb|lab|lch)\s*\(/.test(t)) return true
    if (NAMED_COLORS.has(t)) return true
    return false
  }
  const cssVarsLines = []
  if (tokens?.palette && typeof tokens.palette === 'object') {
    for (const [k, v] of Object.entries(tokens.palette)) {
      const kebab = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
      let value = null
      if (typeof v === 'string' && isCssColor(v)) value = v.trim()
      else if (v && typeof v === 'object' && typeof v.hex === 'string') value = v.hex.trim()
      if (value) cssVarsLines.push(`  --${kebab}: ${value};`)
    }
  }
  const cssVars = cssVarsLines.join('\n')
  files.push({
    path: 'app/globals.css',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
${cssVars || '  /* design tokens omitted — pages use Tailwind utility classes */'}
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
    // Tailwind trio lives in `dependencies`, NOT `devDependencies`.
    //
    // Why: Fly auto-sets NODE_ENV=production on Node containers, which
    // tells `npm install` to silently skip `devDependencies` — even
    // though our preview is functionally a dev environment. We learned
    // this the hard way: `next` installed, the css configs synced
    // cleanly, and PostCSS still threw `require.resolve('tailwindcss')`
    // at boot because tailwindcss never landed on disk. Moving the trio
    // to `dependencies` makes them install regardless of NODE_ENV.
    //
    // We ALSO set NODE_ENV=development in the runner spawn (belt &
    // suspenders), but this placement is the durable fix — it survives
    // any future env-var drift on Fly, vercel, or a self-hosted setup.
    tailwindcss: '^3.4.10',
    postcss: '^8.4.41',
    autoprefixer: '^10.4.20',
    ...(fullstack ? { '@supabase/supabase-js': '^2.45.0' } : {}),
  }
  pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === 'object' ? { ...pkg.dependencies } : {}
  for (const [k, v] of Object.entries(requiredDeps)) {
    // If the dep is already present in EITHER section, leave it alone
    // (preserves user version pins). Only add when truly missing.
    if (!pkg.dependencies[k] && !pkg.devDependencies?.[k]) {
      pkg.dependencies[k] = v
      changed = true
    }
  }

  // If a previous (broken) scaffolding pass parked tailwindcss /
  // postcss / autoprefixer in devDependencies, move them up to
  // dependencies so they actually install on Fly. Preserve the user's
  // version pin while migrating.
  const migrateToDeps = ['tailwindcss', 'postcss', 'autoprefixer']
  pkg.devDependencies = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? { ...pkg.devDependencies } : {}
  for (const k of migrateToDeps) {
    if (pkg.devDependencies[k] && !pkg.dependencies[k]) {
      pkg.dependencies[k] = pkg.devDependencies[k]
      delete pkg.devDependencies[k]
      changed = true
    }
  }

  return { pkg, changed }
}
