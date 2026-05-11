// ── Read Files Auto-Recovery Tests ──
//
// Proves the deterministic recovery path in handleReadFilesDisk: when the
// AI guesses a path that doesn't exist, the tool either (a) transparently
// loads the file if the basename has a unique match, or (b) surfaces
// candidates, or (c) tells the AI to use exec_command. This is what
// breaks the "I'll search the codebase" → narrate-forever failure mode.
//
// Uses real /app filesystem (no mocking) so the test is faithful to prod.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { handleReadFiles } from '../lib/e2b/agent-tools.js'

describe('handleReadFiles (self-edit) — Auto-Recovery', () => {
  test('exact existing path → returns content (baseline / no regression)', async () => {
    const result = await handleReadFiles(
      { paths: ['lib/ai/synthesis-sanitizer.js'] },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    assert.match(result, /synthesis-sanitizer\.js/)
    assert.match(result, /cleanForSynthesis/)
    assert.match(result, /lines\)/)
    assert.doesNotMatch(result, /FILE NOT FOUND/)
  })

  test('wrong path with UNIQUE basename → auto-loads the real file', async () => {
    // synthesis-sanitizer.js exists only at /app/lib/ai/synthesis-sanitizer.js
    const result = await handleReadFiles(
      { paths: ['app/api/sanitizer/synthesis-sanitizer.js'] },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    assert.match(result, /auto-recovered/, 'must announce auto-recovery')
    assert.match(result, /lib\/ai\/synthesis-sanitizer\.js/, 'must show the real path')
    assert.match(result, /cleanForSynthesis/, 'must include actual file content')
    assert.match(result, /did not exist/, 'must explain what happened')
  })

  test('wrong path with GENERIC basename → directs AI to exec_command', async () => {
    // route.js is too generic — we refuse to guess
    const result = await handleReadFiles(
      { paths: ['app/api/totally/fake/route.js'] },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    assert.match(result, /FILE NOT FOUND/)
    assert.match(result, /exec_command/, 'must instruct AI to use exec_command')
    assert.match(result, /find \/app/, 'must give a concrete command')
    assert.match(result, /Do NOT stop/, 'must explicitly forbid stopping')
  })

  test('wrong path with NO matches anywhere → directs AI to exec_command', async () => {
    const result = await handleReadFiles(
      { paths: ['some/totally/made-up-file-xyz-9999.js'] },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    assert.match(result, /FILE NOT FOUND/)
    assert.match(result, /exec_command/)
    assert.match(result, /Do NOT stop and ask the user/)
  })

  test('wrong path with MULTIPLE candidates → returns candidate list', async () => {
    // package.json exists at /app/package.json — but also at many node_modules
    // paths (excluded). Use a name that's likely to have a few real matches.
    // Try config.js — likely several
    const result = await handleReadFiles(
      { paths: ['some/wrong/path/tailwind.config.js'] },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    // Either we got candidates OR a single match (depends on repo state) — both are valid
    // The key assertion: we don't return a bare FILE NOT FOUND with no help
    if (/Candidates with same filename/.test(result)) {
      assert.match(result, /Call .read_files. again with the correct path/)
      assert.match(result, /Do NOT ask the user/)
    } else {
      // single-match auto-recovery branch — that's fine too
      assert.ok(
        /auto-recovered/.test(result) || /exec_command/.test(result),
        'must either auto-recover or direct to exec_command — never silent FILE NOT FOUND'
      )
    }
  })

  test('result never contains bare FILE NOT FOUND without recovery guidance', async () => {
    // Sanity: every failure mode must offer recovery (exec_command, candidates, or auto-load)
    const result = await handleReadFiles(
      { paths: ['xx/yy/zz.js'] },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    assert.match(result, /FILE NOT FOUND/)
    // Must include at least one recovery mechanism
    assert.ok(
      /exec_command/.test(result) || /Candidates/.test(result) || /auto-recovered/.test(result),
      'every FILE NOT FOUND must offer a recovery path'
    )
  })

  test('mixed paths (one exists, one does not) → both handled', async () => {
    const result = await handleReadFiles(
      {
        paths: [
          'lib/ai/synthesis-sanitizer.js', // exists
          'fake/nonexistent/file-zzz-9999.js', // does not exist
        ],
      },
      { projectId: null, projectFiles: [], isSelfEdit: true }
    )
    assert.match(result, /synthesis-sanitizer\.js/, 'real file is read')
    assert.match(result, /cleanForSynthesis/, 'real content is included')
    assert.match(result, /FILE NOT FOUND/, 'missing file is flagged')
    assert.match(result, /exec_command/, 'missing file gets recovery directive')
  })
})
