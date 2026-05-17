// ──────────────────────────────────────────────────────────────────────
// Tests for the deterministic scaffolding step that wraps every
// Auroraly-generated project with the Next.js + Tailwind boilerplate
// the LLM compose phase doesn't write (package.json with a dev script,
// layout.jsx, configs, etc).
//
// Without this scaffold, projects had 67 perfectly-good JSX files but
// the runner couldn't boot them — "no package.json with a dev/start
// script found anywhere in /project". These tests pin the contract.
// ──────────────────────────────────────────────────────────────────────

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildScaffolding } from '../lib/ai/phased-pipeline/scaffolding.js'

test('returns the canonical Next.js scaffolding files', () => {
  const files = buildScaffolding({ projectName: 'Cozy Coffee' })
  const paths = files.map((f) => f.path).sort()
  // The runner needs at minimum: package.json with a dev script,
  // app/layout.jsx, app/globals.css, tailwind/postcss configs.
  for (const required of [
    'package.json',
    'next.config.js',
    'tailwind.config.js',
    'postcss.config.js',
    'app/globals.css',
    'app/layout.jsx',
    'jsconfig.json',
    '.gitignore',
  ]) {
    assert.ok(paths.includes(required), `missing required scaffold file: ${required}`)
  }
})

test('package.json has the dev/start scripts the runner looks for', () => {
  const files = buildScaffolding({ projectName: 'Nexsara' })
  const pkg = JSON.parse(files.find((f) => f.path === 'package.json').content)
  assert.equal(pkg.scripts.dev, 'next dev')
  assert.equal(pkg.scripts.start, 'next start')
  assert.equal(pkg.scripts.build, 'next build')
  assert.match(pkg.dependencies.next, /^\^14/)
  assert.match(pkg.dependencies.react, /^\^18/)
  // Tailwind trio MUST be in devDependencies — otherwise Next's webpack
  // crashes at compile time with "Cannot find module 'tailwindcss'".
  assert.match(pkg.devDependencies.tailwindcss, /^\^3/)
  assert.match(pkg.devDependencies.postcss, /^\^8/)
  assert.match(pkg.devDependencies.autoprefixer, /^\^10/)
})

test('package.json name is npm-safe even with weird project names', () => {
  // Slashes, capital letters, spaces, emoji — all common in user input.
  const cases = [
    { input: 'Cozy Coffee', expected: 'cozy-coffee' },
    { input: 'Nexsara/v2', expected: 'nexsara-v2' },
    { input: 'My Plant Shop! 🌱', expected: 'my-plant-shop' },
    { input: '   trim me   ', expected: 'trim-me' },
    { input: '###', expected: 'auroraly-project' },
    { input: '', expected: 'auroraly-project' },
  ]
  for (const { input, expected } of cases) {
    const files = buildScaffolding({ projectName: input })
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json').content)
    assert.equal(pkg.name, expected, `${JSON.stringify(input)} → ${pkg.name}`)
  }
})

test('fullstack archetype adds @supabase/supabase-js dependency', () => {
  const filesPlain = buildScaffolding({ projectName: 'X', fullstack: false })
  const pkgPlain = JSON.parse(filesPlain.find((f) => f.path === 'package.json').content)
  assert.equal(pkgPlain.dependencies['@supabase/supabase-js'], undefined)

  const filesFull = buildScaffolding({ projectName: 'X', fullstack: true })
  const pkgFull = JSON.parse(filesFull.find((f) => f.path === 'package.json').content)
  assert.match(pkgFull.dependencies['@supabase/supabase-js'], /^\^2/)
})

test('globals.css emits CSS vars when design tokens are provided', () => {
  const tokens = {
    palette: {
      pageBg: '#fffdf7',
      brandPrimary: '#3d2c1e',
      brandAccent: '#c98a3a',
    },
  }
  const files = buildScaffolding({ projectName: 'X', tokens })
  const css = files.find((f) => f.path === 'app/globals.css').content
  assert.match(css, /@tailwind base;/)
  assert.match(css, /--page-bg: #fffdf7;/)
  assert.match(css, /--brand-primary: #3d2c1e;/)
  assert.match(css, /--brand-accent: #c98a3a;/)
})

test('globals.css works without design tokens (no crash on empty palette)', () => {
  const files = buildScaffolding({ projectName: 'X' })
  const css = files.find((f) => f.path === 'app/globals.css').content
  // Still has Tailwind directives — that's the non-negotiable part.
  assert.match(css, /@tailwind base;/)
  assert.match(css, /@tailwind components;/)
  assert.match(css, /@tailwind utilities;/)
})

test('app/layout.jsx imports globals.css (so Tailwind actually loads)', () => {
  const files = buildScaffolding({ projectName: 'Cozy Coffee' })
  const layout = files.find((f) => f.path === 'app/layout.jsx').content
  assert.match(layout, /import '\.\/globals\.css'/)
  // metadata.title shows the human-readable name (not the npm-slugged one).
  assert.match(layout, /title: 'Cozy Coffee'/)
  // RootLayout signature must match what Next 14 app-router expects.
  assert.match(layout, /export default function RootLayout\({ children }\)/)
  assert.match(layout, /<html lang="en">/)
})

test('layout escapes double-quotes in project name (no broken JSX)', () => {
  const files = buildScaffolding({ projectName: 'The "Best" Cafe' })
  const layout = files.find((f) => f.path === 'app/layout.jsx').content
  // Bare double-quote in title would terminate the string and produce
  // invalid JSX. Verify the escape made it through.
  assert.ok(
    layout.includes('The \\"Best\\" Cafe') || layout.includes(`The \\"Best\\" Cafe`),
    'project name with double quotes should be escaped in layout title',
  )
})

test('tailwind config content paths cover compose output locations', () => {
  const files = buildScaffolding({ projectName: 'X' })
  const tw = files.find((f) => f.path === 'tailwind.config.js').content
  // Phase-5 compose writes to app/, components/, lib/ — all three must
  // be scanned by Tailwind or class names get purged from the build.
  assert.match(tw, /\.\/app\/\*\*\/\*\.{js,jsx,ts,tsx}/)
  assert.match(tw, /\.\/components\/\*\*\/\*\.{js,jsx,ts,tsx}/)
  assert.match(tw, /\.\/lib\/\*\*\/\*\.{js,jsx,ts,tsx}/)
})

test('jsconfig.json enables the @/ import alias compose tells the AI to use', () => {
  const files = buildScaffolding({ projectName: 'X' })
  const jsconfig = JSON.parse(files.find((f) => f.path === 'jsconfig.json').content)
  assert.deepEqual(jsconfig.compilerOptions.paths, { '@/*': ['./*'] })
})

test('next.config.js disables image optimization (preview uses data: URLs)', () => {
  const files = buildScaffolding({ projectName: 'X' })
  const next = files.find((f) => f.path === 'next.config.js').content
  // Images come back from Phase 4 as base64 data: URLs inlined directly
  // into <img src="data:...">. Next/Image's loader gets confused by those
  // unless images.unoptimized is true.
  assert.match(next, /images:\s*\{\s*unoptimized:\s*true\s*\}/)
})

test('every scaffold file has non-empty content (no accidental blanks)', () => {
  const files = buildScaffolding({ projectName: 'Cozy Coffee' })
  for (const f of files) {
    assert.ok(typeof f.path === 'string' && f.path.length > 0, 'path must be non-empty')
    assert.ok(typeof f.content === 'string' && f.content.length > 0, `${f.path} content empty`)
  }
})

test('returns the same files in stable order across calls (deterministic)', () => {
  const a = buildScaffolding({ projectName: 'X' }).map((f) => f.path)
  const b = buildScaffolding({ projectName: 'X' }).map((f) => f.path)
  assert.deepEqual(a, b)
})
