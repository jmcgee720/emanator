// ──────────────────────────────────────────────────────────────────────
// Test: preview-runner exposes BUILD_SHA on /status, /version, and the
// boot log line.
//
// This is the diagnostic backstop for "did the new image actually
// deploy?" — when a user reports "same error", we can hit /version on
// their preview machine and compare the buildSha against the latest
// GitHub commit. If they differ, the machine is running stale code and
// the orchestrator's image-staleness check should recycle it on next
// /start. If they match, the bug isn't a stale runner — keep digging.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('/app/preview-runner/index.js', 'utf8')
const DOCKERFILE = readFileSync('/app/preview-runner/Dockerfile', 'utf8')
const WORKFLOW = readFileSync('/app/.github/workflows/preview-runner-deploy.yml', 'utf8')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ─── runner code ──────────────────────────────────────────────────────

test('runner defines a GET /version endpoint', () => {
  assert.match(SRC, /app\.get\(['"]\/version['"]/, '/version route must be registered')
})

test('/version returns BUILD_SHA from process.env', () => {
  // The route handler reads process.env.BUILD_SHA with a 'dev' fallback
  const block = SRC.match(/app\.get\(['"]\/version['"][\s\S]{0,400}/)[0]
  assert.match(block, /process\.env\.BUILD_SHA/, '/version must read BUILD_SHA from env')
  assert.match(block, /['"]dev['"]/, '/version must fall back to "dev" when BUILD_SHA is missing')
})

test('/status response includes buildSha for orchestrator stale-image diagnostics', () => {
  // Find the /status res.json block
  const block = SRC.match(/app\.get\(['"]\/status['"][\s\S]{0,1500}/)[0]
  assert.match(block, /buildSha:\s*process\.env\.BUILD_SHA/, '/status must expose buildSha')
})

test('boot log line includes build SHA so it appears in the Floating Logs panel', () => {
  // [runner v5.clean] build=<sha> listening on …
  assert.match(SRC, /\[runner v5\.clean\] build=\$\{buildSha\}/, 'boot log must template the resolved build SHA')
})

// ─── Dockerfile ───────────────────────────────────────────────────────

test('Dockerfile declares ARG BUILD_SHA with a dev default', () => {
  assert.match(DOCKERFILE, /^ARG BUILD_SHA=dev$/m, 'must declare ARG BUILD_SHA=dev')
})

test('Dockerfile promotes ARG BUILD_SHA into an ENV the runner can read', () => {
  assert.match(DOCKERFILE, /^ENV BUILD_SHA=\$\{BUILD_SHA\}$/m, 'must export BUILD_SHA as ENV')
})

// ─── deploy workflow ──────────────────────────────────────────────────

test('GitHub Actions workflow passes --build-arg BUILD_SHA=${{ github.sha }}', () => {
  assert.match(WORKFLOW, /--build-arg "BUILD_SHA=\$\{\{ github\.sha \}\}"/, 'workflow must wire github.sha into the docker build')
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
  if (failed) {
    console.error(`\n${failed} test(s) failed`)
    process.exit(1)
  }
  console.log(`\n${tests.length} test(s) passed`)
})()
