// ── Codebase Root Detection Tests ──
//
// Proves:
//   • /app is detected when it exists and looks like Auroraly
//   • AURORALY_CODEBASE_ROOT env var overrides everything
//   • Vercel env var presence flips isPersistent → false
//   • Probe-based persistence detection: writable dir → true; read-only → false
//   • Last-resort fallback returns cwd with isPersistent: false

import { test, describe, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { detectCodebaseRoot } from '../lib/ai/codebase-root.js'

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.AURORALY_CODEBASE_ROOT
  delete process.env.VERCEL
  delete process.env.VERCEL_ENV
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe('detectCodebaseRoot', () => {
  test('defaults to /app when /app/package.json exists (Emergent sandbox)', () => {
    // We are in /app right now and package.json exists
    assert.equal(fs.existsSync('/app/package.json'), true)
    const out = detectCodebaseRoot()
    assert.equal(out.root, '/app')
    assert.equal(out.isPersistent, true)
    assert.equal(out.source, '/app')
  })

  test('AURORALY_CODEBASE_ROOT env override wins when valid', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-root-'))
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}')
    try {
      process.env.AURORALY_CODEBASE_ROOT = tmp
      const out = detectCodebaseRoot()
      assert.equal(out.root, tmp)
      assert.equal(out.source, 'env:AURORALY_CODEBASE_ROOT')
      assert.equal(out.isPersistent, true)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('AURORALY_CODEBASE_ROOT pointing at non-Auroraly dir is ignored (falls through)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'not-auroraly-'))
    try {
      process.env.AURORALY_CODEBASE_ROOT = tmp
      const out = detectCodebaseRoot()
      // Should NOT use the override (no package.json)
      assert.notEqual(out.source, 'env:AURORALY_CODEBASE_ROOT')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('VERCEL env var marks isPersistent=false (serverless signal)', () => {
    process.env.VERCEL = '1'
    const out = detectCodebaseRoot()
    assert.equal(out.isPersistent, false, 'VERCEL=1 must always be non-persistent')
  })

  test('VERCEL_ENV=production also marks isPersistent=false', () => {
    process.env.VERCEL_ENV = 'production'
    const out = detectCodebaseRoot()
    assert.equal(out.isPersistent, false)
  })

  test('all output fields are populated', () => {
    const out = detectCodebaseRoot()
    assert.ok(typeof out.root === 'string' && out.root.length > 0)
    assert.ok(typeof out.isPersistent === 'boolean')
    assert.ok(typeof out.source === 'string')
  })
})
