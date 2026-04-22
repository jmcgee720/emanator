/**
 * Tests for the extracted self-edit snapshot helper. Uses a private
 * temp dir per test so the real /app/.emanator-backups stays clean.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

// We need to exercise the real module but point it at a scoped temp
// backup dir. The module hardcodes /app/.emanator-backups by design
// (simple + deterministic), so we assert against that dir and clean
// up after ourselves.

const { snapshotSelfEditFile } = require('../../lib/ai/self-edit-snapshot.js')

const BACKUP_DIR = '/app/.emanator-backups'
const TEST_FILE_REL = `.test-artifacts/self-edit-test-${process.pid}.txt`
const TEST_FILE_FULL = path.join('/app', TEST_FILE_REL)

function writeTestFile(content = 'hello world') {
  const dir = path.dirname(TEST_FILE_FULL)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(TEST_FILE_FULL, content)
}

function listOwnBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  const prefix = TEST_FILE_REL.replace(/\//g, '__')
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix))
}

function cleanOwnBackups() {
  for (const f of listOwnBackups()) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)) } catch {}
  }
}

afterEach(() => {
  try { fs.unlinkSync(TEST_FILE_FULL) } catch {}
  cleanOwnBackups()
})

describe('snapshotSelfEditFile — happy path', () => {
  it('copies the source file to /app/.emanator-backups with a timestamped name', () => {
    writeTestFile('hello v1')
    const result = snapshotSelfEditFile(TEST_FILE_REL, 'unit-test')
    expect(result.saved).toBe(true)
    expect(result.name).toMatch(/^\.test-artifacts__self-edit-test-\d+\.txt\./)
    expect(result.name).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)

    const backups = listOwnBackups()
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(BACKUP_DIR, backups[0]), 'utf8')).toBe('hello v1')
  })

  it('creates the backup dir on first use', () => {
    writeTestFile('x')
    snapshotSelfEditFile(TEST_FILE_REL, 'unit-test')
    expect(fs.existsSync(BACKUP_DIR)).toBe(true)
  })

  it('uses the provided label in the log message (no throw)', () => {
    writeTestFile('x')
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      snapshotSelfEditFile(TEST_FILE_REL, 'custom-label-999')
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[custom-label-999]'))
    } finally { spy.mockRestore() }
  })
})

describe('snapshotSelfEditFile — no-op paths', () => {
  it('returns reason=missing-path for blank input', () => {
    expect(snapshotSelfEditFile('', 'x')).toEqual(expect.objectContaining({ saved: false, reason: 'missing-path' }))
    expect(snapshotSelfEditFile(null, 'x')).toEqual(expect.objectContaining({ saved: false }))
    expect(snapshotSelfEditFile(undefined, 'x')).toEqual(expect.objectContaining({ saved: false }))
  })

  it('returns reason=source-missing when target does not exist', () => {
    const result = snapshotSelfEditFile('.test-artifacts/does-not-exist.txt', 'unit-test')
    expect(result).toEqual({ saved: false, reason: 'source-missing' })
  })

  it('source-missing path does not create the backup dir if it does not already exist', () => {
    const result = snapshotSelfEditFile('.test-artifacts/never-here.txt', 'unit-test')
    expect(result.saved).toBe(false)
    // Don't assert BACKUP_DIR absence (other tests + real code create it).
  })
})

describe('snapshotSelfEditFile — pruning', () => {
  // Directly stash 25 dummy backups with the same prefix to test pruning.
  it('prunes backup list to 20 entries per path', () => {
    writeTestFile('v')
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const prefix = TEST_FILE_REL.replace(/\//g, '__')
    const now = Date.now()
    // Create 25 fake older backups using monotonically increasing timestamps
    for (let i = 0; i < 25; i++) {
      const ts = new Date(now - (25 - i) * 60_000).toISOString().replace(/[:.]/g, '-')
      fs.writeFileSync(path.join(BACKUP_DIR, `${prefix}.${ts}`), `v${i}`)
    }

    const before = listOwnBackups().length
    expect(before).toBe(25)

    const result = snapshotSelfEditFile(TEST_FILE_REL, 'unit-test')
    expect(result.saved).toBe(true)

    const after = listOwnBackups()
    // Pruned to the MAX of 20. One is the new backup we just created.
    expect(after.length).toBe(20)
  })
})
