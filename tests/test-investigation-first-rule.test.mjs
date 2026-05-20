// ──────────────────────────────────────────────────────────────────────
// Investigation-first / doom-loop break rule + AdminPanel diagnostics
// ──────────────────────────────────────────────────────────────────────
// Pins:
//   1. The system prompt now contains an INVESTIGATION_FIRST_RULE that
//      forbids the agent from shipping fix N+1 on the same symptom
//      without diagnostic evidence about why fix N failed to land.
//   2. AdminPanel.jsx ships runtime instrumentation that logs the
//      containing-block ancestor chain — surfaces the root cause of
//      the position:fixed-pinned-to-parent bug on next mount.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

test('system prompt: defines INVESTIGATION_FIRST_RULE constant', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  assert.match(src, /const INVESTIGATION_FIRST_RULE = \[/, 'must define the rule as a shared constant')
  assert.match(src, /DOOM-LOOP BREAK/, 'rule must be named so the model recognises the pattern')
})

test('investigation rule: forbids same-symptom retry without diagnostics', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  assert.match(src, /FORBIDDEN from shipping another fix-attempt without first running diagnostics/, 'must explicitly forbid retry-without-diagnostics')
  assert.match(src, /something prevented the first fix from taking effect/, 'must name the actual failure mode')
})

test('investigation rule: enumerates the diagnostic checklist', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  for (const item of ['READ-BACK', 'GIT LOG', 'DEPLOYMENT VERIFY', 'RUNTIME PROBE', 'ROOT-CAUSE PROBE']) {
    assert.ok(src.includes(item), `checklist must include ${item}`)
  }
})

test('investigation rule: forbids "let me try a different approach" without evidence', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  assert.match(src, /let me try a different approach/, 'must explicitly name and ban this phrase')
})

test('investigation rule: warns about claiming fixes that were never committed', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  assert.match(src, /claiming you shipped a fix you did not actually commit/, 'must call out the fabricated-fix failure mode explicitly')
})

test('investigation rule: wired into BOTH project-mode and self-edit-mode prompts', async () => {
  const src = await readFile(join(ROOT, 'lib/api/stream-handler-v2.js'), 'utf8')
  const projectFn = src.slice(src.indexOf('function buildProjectSystemPrompt'), src.indexOf('function buildSelfEditSystemPrompt'))
  const selfEditFn = src.slice(src.indexOf('function buildSelfEditSystemPrompt'), src.indexOf('function buildSelfEditScope'))
  assert.match(projectFn, /INVESTIGATION_FIRST_RULE/, 'project prompt must include the rule')
  assert.match(selfEditFn, /INVESTIGATION_FIRST_RULE/, 'self-edit prompt must include the rule')
})

// ── AdminPanel runtime diagnostics ─────────────────────────────────

test('AdminPanel: mounts a diagnostic effect that walks the parent chain', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  assert.match(src, /\[AdminPanel diag\] MOUNTED — build marker/, 'must log a build-marker line so the user can verify the deployed bundle has this code')
  assert.match(src, /admin-panel-diag-v1/, 'build marker must be a stable string for grep verification')
  assert.match(src, /CONTAINING BLOCK CREATORS FOUND/, 'must log culprit ancestors when found')
  assert.match(src, /NO containing-block creators found/, 'must log a definitive negative when no culprits exist')
})

test('AdminPanel: diagnostic checks transform/filter/perspective/will-change/contain/backdrop-filter', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  // All six properties that create a containing block for position:fixed
  // must be checked. Missing any of them means the diagnostic can
  // falsely report "no culprits" when there actually is one.
  for (const prop of ['transform', 'filter', 'perspective', 'willChange', 'contain', 'backdropFilter']) {
    assert.ok(src.includes(prop), `diagnostic must check ${prop} as a possible containing-block creator`)
  }
})

test('AdminPanel: logs modal bounding rect AND viewport size for visual diff', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  assert.match(src, /getBoundingClientRect/, 'must log actual rendered geometry')
  assert.match(src, /viewportH: window\.innerHeight/, 'must include viewport height for centering math')
  assert.match(src, /viewportW: window\.innerWidth/, 'must include viewport width')
})

test('AdminPanel: attaches overlayRef to the actual overlay div', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  assert.match(src, /const overlayRef = useRef\(null\)/, 'must declare the ref')
  assert.match(src, /ref=\{overlayRef\}[\s\S]{0,400}data-testid="admin-panel-overlay"/, 'overlayRef must attach to the overlay div (not the inner content div)')
})
