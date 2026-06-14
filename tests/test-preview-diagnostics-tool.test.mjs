// ──────────────────────────────────────────────────────────────────────
// Test: the preview_diagnostics AI tool + /api/previews/[projectId]/diagnose
// route are wired up correctly, exposed in the project-scoped tool
// list, and produce verdicts the LLM can pattern-match on.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── 1. Vercel route file exists & exports GET ────────────────────────

test('/api/previews/[projectId]/diagnose/route.js exists', () => {
  assert.ok(existsSync('/app/app/api/previews/[projectId]/diagnose/route.js'),
    'diagnose route must be created')
})

test('diagnose route exports a GET handler', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/diagnose/route.js', 'utf8')
  assert.match(src, /export\s+async\s+function\s+GET\s*\(/, 'must export async GET')
})

test('diagnose route probes machine, runner /status, public HTTP, and WS upgrade', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/diagnose/route.js', 'utf8')
  assert.match(src, /findMachineForProject/)
  assert.match(src, /resolveDeployedImage/)
  assert.match(src, /isMachineImageStale/)
  assert.match(src, /isMachineConfigStale/)
  assert.match(src, /\/status[`'"]/, 'must probe /status')
  assert.match(src, /\/version[`'"]/, 'must probe /version')
  assert.match(src, /publicDevUrl/, 'must probe the public URL')
  assert.match(src, /Sec-WebSocket-Key/, 'must include WS upgrade probe')
  assert.match(src, /Sec-WebSocket-Version/, 'must include WS upgrade probe')
})

test('diagnose route surfaces a verdict + suggestedFix', () => {
  const src = readFileSync('/app/app/api/previews/[projectId]/diagnose/route.js', 'utf8')
  for (const verdict of [
    'no-machine',
    'stale-runner-image',
    'stale-machine-config',
    'runner-unreachable',
    'still-installing',
    'dev-server-error',
    'dev-server-not-running',
    'ws-blocked-at-fly-edge',
    'healthy',
  ]) {
    assert.match(src, new RegExp(verdict), `verdict string '${verdict}' must appear in makeVerdict`)
  }
})

// ─── 2. AI tool is exported and registered ────────────────────────────

test('previewDiagnosticsTool is exported from lib/ai/tools/preview-diagnostics.js', () => {
  const src = readFileSync('/app/lib/ai/tools/preview-diagnostics.js', 'utf8')
  assert.match(src, /export\s+function\s+previewDiagnosticsTool\s*\(/, 'previewDiagnosticsTool must be exported')
})

test('previewDiagnosticsTool calls /api/previews/<projectId>/diagnose', () => {
  const src = readFileSync('/app/lib/ai/tools/preview-diagnostics.js', 'utf8')
  assert.match(src, /\/api\/previews\/\$\{projectId\}\/diagnose/, 'tool must call the new route')
})

test('agent-tools-v2.js imports + registers previewDiagnosticsTool for projects', () => {
  const src = readFileSync('/app/lib/ai/agent-tools-v2.js', 'utf8')
  assert.match(src, /import\s*\{[^}]*previewDiagnosticsTool[^}]*\}\s*from\s*['"]\.\/tools\/preview-diagnostics\.js['"]/,
    'previewDiagnosticsTool must be imported alongside the other preview tools')
  // Must be pushed when projectId is set
  assert.match(src, /tools\.push\(previewDiagnosticsTool\(projectId\)\)/,
    'previewDiagnosticsTool(projectId) must be pushed onto the tools array in project mode')
})

test('previewDiagnosticsTool registers BEFORE the other preview tools so the model reaches for it first', () => {
  const src = readFileSync('/app/lib/ai/agent-tools-v2.js', 'utf8')
  const deepIdx = src.indexOf('previewDiagnosticsTool(projectId)')
  const logsIdx = src.indexOf('getPreviewLogsTool(projectId)')
  assert.ok(deepIdx > 0 && logsIdx > 0, 'both registrations must exist')
  assert.ok(deepIdx < logsIdx, 'preview_diagnostics must be registered before get_preview_logs')
})

// ─── 3. Runner has the /api/diagnostics/logs endpoint ──────────────────

test('preview-runner exposes POST /api/diagnostics/logs', () => {
  const src = readFileSync('/app/preview-runner/index.js', 'utf8')
  assert.match(src, /app\.post\(['"]\/api\/diagnostics\/logs['"]/, 'runner must register POST /api/diagnostics/logs')
})

test('/api/diagnostics/logs returns the last N lines with stream prefix', () => {
  const src = readFileSync('/app/preview-runner/index.js', 'utf8')
  // Extract the handler body (small window after the route registration)
  const handler = src.match(/app\.post\(['"]\/api\/diagnostics\/logs['"][^]*?\n\}\)/)
  assert.ok(handler, 'handler block must be present')
  assert.match(handler[0], /logs\.slice\(-lines\)/, 'must slice the tail of the logs buffer')
  assert.match(handler[0], /\[\$\{e\.stream\}\]/, 'must prefix each line with its stream')
})

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${name}\n    ${err.message}`)
    }
  }
  if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
  console.log(`\n${tests.length} test(s) passed`)
})()
