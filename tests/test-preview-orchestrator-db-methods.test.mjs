// ──────────────────────────────────────────────────────────────────────
// Regression: orchestrator route should only call methods that exist on
// the db object. (Previously called `db.projectFiles.list()` which is
// `findByProjectId()` in the actual schema → "db.projectFiles.list is
// not a function" preview-failed-to-start.)
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

const dbSrc = readFileSync('/app/lib/supabase/db.js', 'utf8')

function methodsOf(group) {
  // Cheap parser: scan `<group>: {` … `},` and collect `async <name>(`
  const start = dbSrc.indexOf(`${group}: {`)
  if (start === -1) return new Set()
  // Find the matching close brace (track depth from the opening brace).
  const openIdx = dbSrc.indexOf('{', start)
  let depth = 0, end = -1
  for (let i = openIdx; i < dbSrc.length; i++) {
    const ch = dbSrc[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  const slice = dbSrc.slice(openIdx, end)
  const names = new Set()
  for (const m of slice.matchAll(/async\s+([a-zA-Z_$][\w$]*)\s*\(/g)) names.add(m[1])
  return names
}

const orchestratorCalls = [
  // file: callExpr → group → method
  { file: '/app/app/api/previews/[projectId]/start/route.js', group: 'projects', method: 'findById' },
  { file: '/app/app/api/previews/[projectId]/start/route.js', group: 'projectFiles', method: 'findByProjectId' },
  { file: '/app/app/api/previews/[projectId]/stop/route.js', group: 'projects', method: 'findById' },
  { file: '/app/app/api/previews/[projectId]/logs/route.js', group: 'projects', method: 'findById' },
]

for (const c of orchestratorCalls) {
  test(`db.${c.group}.${c.method}() must be defined (used by ${c.file.split('/').pop()})`, () => {
    const m = methodsOf(c.group)
    assert.ok(m.has(c.method), `db.${c.group}.${c.method} not found in db.js. Available: ${[...m].join(', ')}`)
    // Also assert the route file actually contains the call (catches refactors).
    const src = readFileSync(c.file, 'utf8')
    const re = new RegExp(`db\\.${c.group}\\.${c.method}\\s*\\(`, 'm')
    assert.match(src, re, `${c.file} should call db.${c.group}.${c.method}(...)`)
  })
}

// Negative test: ensure no orchestrator route still has the old `.list(` typo.
test('orchestrator must NOT call db.projectFiles.list (regression for "list is not a function")', () => {
  for (const c of orchestratorCalls) {
    const src = readFileSync(c.file, 'utf8')
    assert.doesNotMatch(src, /db\.projectFiles\.list\s*\(/, `${c.file} still calls db.projectFiles.list — should be findByProjectId`)
  }
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (err) { console.error(`  ✗ ${t.name}\n     `, err.message); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
