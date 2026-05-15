// ── Per-project URL routing tests ──
// Verifies the new /project/[projectId] dynamic route exists, the
// AppShell + dynamic page wire up correctly, and the Dashboard prop
// surface accepts initialProjectId. Module-only checks — full e2e
// routing is exercised by Next at build time.

import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(new URL('..', import.meta.url).pathname)

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf-8')
}

describe('per-project URL routing — file structure', () => {
  test('dynamic route /project/[projectId]/page.js exists', () => {
    const p = path.join(REPO, 'app/project/[projectId]/page.js')
    assert.ok(fs.existsSync(p), '/app/project/[projectId]/page.js must exist')
  })

  test('shared AppShell component exists', () => {
    const p = path.join(REPO, 'components/AppShell.jsx')
    assert.ok(fs.existsSync(p), 'components/AppShell.jsx must exist')
  })

  test('homepage uses shared AppShell (no inlined auth code)', () => {
    const src = read('app/page.js')
    assert.match(src, /AppShell/)
    // The duplicated auth gate should be GONE from page.js — must live in AppShell now.
    assert.equal(src.includes('supabase.auth.onAuthStateChange'), false,
      'app/page.js should delegate auth to AppShell, not implement it inline')
  })

  test('dynamic route passes params.projectId as initialProjectId', () => {
    const src = read('app/project/[projectId]/page.js')
    assert.match(src, /AppShell/)
    assert.match(src, /initialProjectId/)
    assert.match(src, /params\.projectId/)
  })

  test('AppShell forwards initialProjectId to Dashboard', () => {
    const src = read('components/AppShell.jsx')
    assert.match(src, /initialProjectId/)
    // Must have a default so the homepage works (no param)
    assert.match(src, /initialProjectId\s*=\s*null/)
  })
})

describe('Dashboard — URL-driven project selection', () => {
  const src = read('components/dashboard/Dashboard.jsx')

  test('imports useRouter from next/navigation', () => {
    assert.match(src, /from\s+['"]next\/navigation['"]/)
    assert.match(src, /useRouter/)
  })

  test('accepts initialProjectId prop', () => {
    assert.match(src, /initialProjectId\s*=\s*null/)
  })

  test('openProjectWorkspace pushes URL', () => {
    // Body of openProjectWorkspace should call router.replace with `/project/${id}`
    assert.match(src, /router\.replace\(`\/project\/\$\{project\.id\}`\)/)
  })

  test('goToProjectsGrid pushes / when user backs out', () => {
    assert.match(src, /router\.replace\(['"]\/['"]\)/)
  })

  test('has a deep-link auto-select effect for initialProjectId', () => {
    // Should look the project up in `projects` once they load.
    assert.match(src, /initialProjectAppliedRef/)
    assert.match(src, /Deep-link/i)
  })
})
