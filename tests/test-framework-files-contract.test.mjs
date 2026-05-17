// Layer 1/2 tests: framework files are stripped from Claude's plan,
// scaffolding pass force-overwrites framework infra, package.json is
// merged (not overwritten), globals.css emits valid CSS values only.

import { strict as assert } from 'node:assert'
import {
  buildScaffolding,
  FRAMEWORK_PATHS,
  FORCE_OVERWRITE_PATHS,
  mergeRequiredPackageDeps,
} from '../lib/ai/phased-pipeline/scaffolding.js'

// ── FRAMEWORK_PATHS contract ──
{
  // package.json must be in framework paths (so compose strips it from
  // Claude's plan) but NOT in force-overwrite (we MERGE it).
  assert.ok(FRAMEWORK_PATHS.includes('package.json'))
  assert.ok(!FORCE_OVERWRITE_PATHS.includes('package.json'))

  // Configs and globals.css must be force-overwritten.
  for (const p of ['postcss.config.js', 'tailwind.config.js', 'app/globals.css', 'next.config.js', 'app/layout.jsx']) {
    assert.ok(FRAMEWORK_PATHS.includes(p), `${p} should be in FRAMEWORK_PATHS`)
    assert.ok(FORCE_OVERWRITE_PATHS.includes(p), `${p} should be force-overwritten`)
  }
}

// ── globals.css emits valid CSS values only (Nexsara repro fix) ──
{
  // The Nexsara bug: tokens.palette had Tailwind class names + nested
  // objects ("bg-neutral-950", { hex: "#fff" }, etc.) which got
  // serialized straight into :root as bogus CSS values. This test
  // proves we now filter to real CSS colors and skip junk.
  const tokens = {
    palette: {
      pageBg: 'bg-neutral-950',          // Tailwind class — must be dropped
      surface: '#0a0a0a',                // hex — must be kept
      primary: 'rgb(99, 102, 241)',      // rgb — must be kept
      ink: { tokens: 'tailwind' },       // unparseable object — must be dropped
      hex: { hex: '#abcdef' },           // {hex:...} object — must be kept via .hex
      muted: '[object Object]',          // toString'd object — must be dropped
    },
  }
  const files = buildScaffolding({ projectName: 'test', tokens })
  const globals = files.find((f) => f.path === 'app/globals.css').content

  // Junk values must NOT appear in the output.
  assert.ok(!globals.includes('bg-neutral-950'), 'Tailwind class leaked into CSS var')
  assert.ok(!globals.includes('[object Object]'), '[object Object] leaked into CSS var')
  // The `ink` token had value `{ tokens: 'tailwind' }` — neither the
  // object nor a `--ink:` var line should exist.
  assert.ok(!globals.includes('--ink:'), '--ink: leaked despite unparseable value')
  // `muted` had `[object Object]` string — same deal.
  assert.ok(!globals.includes('--muted:'), '--muted: leaked despite junk value')

  // Valid colors should be preserved.
  assert.ok(globals.includes('--surface: #0a0a0a;'), 'hex token should pass through')
  assert.ok(globals.includes('--primary: rgb(99, 102, 241);'), 'rgb token should pass through')
  assert.ok(globals.includes('--hex: #abcdef;'), 'nested {hex} object should be unwrapped')

  // @tailwind directives must still be there.
  assert.ok(globals.startsWith('@tailwind base;'), 'globals.css must start with @tailwind base')
  assert.ok(globals.includes('@tailwind components;'))
  assert.ok(globals.includes('@tailwind utilities;'))
}

// ── globals.css with no tokens still renders a sane stub ──
{
  const files = buildScaffolding({ projectName: 'plain' })
  const globals = files.find((f) => f.path === 'app/globals.css').content
  assert.ok(globals.includes('@tailwind base;'))
  assert.ok(globals.includes(':root'))
  // Fallback comment when no usable tokens.
  assert.ok(globals.includes('design tokens omitted'))
}

// ── package.json merger still preserves user deps (regression) ──
{
  const existing = {
    name: 'user-project',
    dependencies: { 'framer-motion': '^11.0.0' },
  }
  const { pkg, changed } = mergeRequiredPackageDeps(existing, {})
  assert.equal(changed, true)
  assert.equal(pkg.dependencies['framer-motion'], '^11.0.0')
  assert.ok(pkg.devDependencies.tailwindcss)
}

console.log('PASS: Layer 1/2 — framework paths contract, globals.css filtering, package.json merge')
