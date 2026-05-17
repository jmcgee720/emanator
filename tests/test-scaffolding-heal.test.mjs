// Test the mergeRequiredPackageDeps healer used by the scaffolding pass
// and the /api/projects/:id/heal-scaffolding endpoint.
import { strict as assert } from 'node:assert'
import { mergeRequiredPackageDeps } from '../lib/ai/phased-pipeline/scaffolding.js'

// ── Case 1: empty package.json → fully populated ──
{
  const { pkg, changed } = mergeRequiredPackageDeps({}, {})
  assert.equal(changed, true)
  assert.equal(pkg.scripts.dev, 'next dev')
  assert.ok(pkg.dependencies.next)
  assert.ok(pkg.dependencies.react)
  assert.ok(pkg.devDependencies.tailwindcss)
  assert.ok(pkg.devDependencies.postcss)
  assert.ok(pkg.devDependencies.autoprefixer)
}

// ── Case 2: package.json missing ONLY tailwind trio (the Nexsara bug) ──
{
  const existing = {
    name: 'nexsara',
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
    dependencies: { next: '^14.2.0', react: '^18.2.0', 'react-dom': '^18.2.0', 'framer-motion': '^11.0.0' },
  }
  const { pkg, changed } = mergeRequiredPackageDeps(existing, {})
  assert.equal(changed, true, 'should patch missing tailwind trio')
  assert.equal(pkg.dependencies['framer-motion'], '^11.0.0', 'preserves user deps')
  assert.equal(pkg.dependencies.next, '^14.2.0', 'preserves user version of next')
  assert.equal(pkg.devDependencies.tailwindcss, '^3.4.10')
  assert.equal(pkg.devDependencies.postcss, '^8.4.41')
  assert.equal(pkg.devDependencies.autoprefixer, '^10.4.20')
}

// ── Case 3: fully scaffolded package.json → no-op ──
{
  const existing = {
    name: 'already-good',
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
    dependencies: { next: '^14.2.5', react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: { tailwindcss: '^3.4.10', postcss: '^8.4.41', autoprefixer: '^10.4.20' },
  }
  const { changed } = mergeRequiredPackageDeps(existing, {})
  assert.equal(changed, false, 'should be a no-op when nothing missing')
}

// ── Case 4: tailwind in dependencies (not devDependencies) → no duplicate add ──
{
  const existing = {
    dependencies: { tailwindcss: '^3.5.0' },
  }
  const { pkg, changed } = mergeRequiredPackageDeps(existing, {})
  assert.equal(pkg.dependencies.tailwindcss, '^3.5.0', 'preserves user placement of tailwind in deps')
  // It will still patch postcss + autoprefixer + react + next, so changed should be true
  assert.equal(changed, true)
  assert.equal(pkg.devDependencies.tailwindcss, undefined, 'should NOT also add tailwind to devDeps')
}

// ── Case 5: fullstack adds @supabase/supabase-js ──
{
  const { pkg } = mergeRequiredPackageDeps({}, { fullstack: true })
  assert.ok(pkg.dependencies['@supabase/supabase-js'], 'fullstack should pull in supabase-js')
}

// ── Case 6: custom dev script preserved ──
{
  const existing = { scripts: { dev: 'next dev -p 4000' } }
  const { pkg } = mergeRequiredPackageDeps(existing, {})
  assert.equal(pkg.scripts.dev, 'next dev -p 4000', 'preserves custom dev script')
  assert.equal(pkg.scripts.build, 'next build', 'fills in missing build script')
}

// ── Case 7: null/undefined input doesn't crash ──
{
  const { pkg, changed } = mergeRequiredPackageDeps(null, {})
  assert.equal(changed, true)
  assert.ok(pkg.dependencies.next)
}

console.log('PASS: mergeRequiredPackageDeps handles empty, partial, fullstack, and edge-case package.json inputs')
