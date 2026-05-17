// Regression test for the Fly NODE_ENV=production preview-boot bug.
//
// Root cause: Fly auto-sets NODE_ENV=production on Node containers,
// which makes `npm install` silently skip devDependencies — even
// without --production. tailwindcss was in devDependencies → never
// landed in /project/node_modules → Next.js's PostCSS chain threw
// `require.resolve('tailwindcss')` at boot → build failed with
// `@tailwind base; Unexpected character '@'` for hours of debugging.
//
// This test pins the fix in two places:
//   1) Scaffolding's canonical package.json puts Tailwind trio in
//      `dependencies` (NOT devDependencies)
//   2) mergeRequiredPackageDeps migrates pre-existing projects' trio
//      from devDependencies → dependencies, preserving version pins

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  buildScaffolding,
  mergeRequiredPackageDeps,
} from '../lib/ai/phased-pipeline/scaffolding.js'

// ── 1) Fresh scaffolding parks trio in `dependencies`, not devDeps ──
{
  const files = buildScaffolding({ projectName: 'fresh-project' })
  const pkgFile = files.find((f) => f.path === 'package.json')
  assert.ok(pkgFile, 'package.json must be scaffolded')
  const pkg = JSON.parse(pkgFile.content)
  for (const dep of ['tailwindcss', 'postcss', 'autoprefixer']) {
    assert.ok(pkg.dependencies[dep], `${dep} must be in dependencies`)
    assert.ok(!pkg.devDependencies?.[dep], `${dep} must NOT be in devDependencies`)
  }
  // No devDependencies block at all (we no longer use it).
  assert.ok(!pkg.devDependencies, 'fresh scaffold should not emit devDependencies')
}

// ── 2) Pre-existing project with trio stuck in devDeps → MIGRATED ──
// This is the Nexsara repro: heal-scaffolding finds the project's
// package.json already has the trio in devDependencies (from an earlier
// scaffolding pass), recognizes it's the broken placement, and moves
// it to dependencies — preserving the user's version pin.
{
  const existing = {
    name: 'nexsara',
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
    dependencies: {
      next: '^14.2.5',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'framer-motion': '^11.0.0',
    },
    devDependencies: {
      tailwindcss: '^3.4.10',
      postcss: '^8.4.41',
      autoprefixer: '^10.4.20',
    },
  }
  const { pkg, changed } = mergeRequiredPackageDeps(existing, {})
  assert.equal(changed, true, 'migration must report changes')

  // Trio moved up:
  assert.equal(pkg.dependencies.tailwindcss, '^3.4.10')
  assert.equal(pkg.dependencies.postcss, '^8.4.41')
  assert.equal(pkg.dependencies.autoprefixer, '^10.4.20')

  // Trio removed from devDependencies:
  assert.ok(!pkg.devDependencies.tailwindcss, 'tailwindcss should have been removed from devDeps')
  assert.ok(!pkg.devDependencies.postcss, 'postcss should have been removed from devDeps')
  assert.ok(!pkg.devDependencies.autoprefixer, 'autoprefixer should have been removed from devDeps')

  // User's custom deps preserved:
  assert.equal(pkg.dependencies['framer-motion'], '^11.0.0', 'user deps must survive migration')
}

// ── 3) Custom version pins are preserved during migration ──
{
  const existing = {
    devDependencies: {
      tailwindcss: '^3.5.0',  // user pinned a newer version
      postcss: '8.4.50',       // exact pin
    },
  }
  const { pkg } = mergeRequiredPackageDeps(existing, {})
  assert.equal(pkg.dependencies.tailwindcss, '^3.5.0', 'preserve user tailwind pin')
  assert.equal(pkg.dependencies.postcss, '8.4.50', 'preserve exact postcss pin')
  // autoprefixer wasn't in either section before — gets default added.
  assert.equal(pkg.dependencies.autoprefixer, '^10.4.20')
}

// ── 4) Trio already correctly in dependencies → no-op ──
{
  const existing = {
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
    dependencies: {
      next: '^14.2.5',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      tailwindcss: '^3.4.10',
      postcss: '^8.4.41',
      autoprefixer: '^10.4.20',
    },
  }
  const { changed } = mergeRequiredPackageDeps(existing, {})
  assert.equal(changed, false, 'correctly-placed trio should be a no-op')
}

// ── 5) The runner passes NODE_ENV=development to npm install ──
// Smoke-test via static source check — proves the env override is
// present in all three spawn call-sites in the runner.
{
  const runnerSrc = readFileSync(new URL('../preview-runner/index.js', import.meta.url), 'utf8')
  const occurrences = runnerSrc.match(/NODE_ENV:\s*'development'/g) || []
  assert.ok(occurrences.length >= 3,
    `runner must override NODE_ENV in all 3 npm install spawn sites; found ${occurrences.length}`)
  // Sanity: no remaining spawn site with bare `CI: '1' }` (no NODE_ENV).
  const bareCI = runnerSrc.match(/env:\s*\{\s*\.\.\.process\.env,\s*CI:\s*'1'\s*\}/g) || []
  assert.equal(bareCI.length, 0, `found ${bareCI.length} spawn site(s) missing NODE_ENV override`)
}

console.log('PASS: Fly NODE_ENV=production fix — trio in deps, migration works, all runner spawns overridden')
