// Pins the AdminPanel modal's positioning guarantees.
//
// History: this modal has shipped at least 3 "centering fixes" that
// regressed because (a) Tailwind purge stripped utility classes,
// (b) a parent in the DOM tree created a containing block, or (c) a
// later refactor accidentally removed `position: fixed`. The defensive
// inline-style + portal approach below is the contract we want to lock
// in so future edits don't silently lose the fix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('AdminPanel portals into document.body (bypasses transformed ancestors)', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  assert.match(src, /createPortal\(/, 'must use createPortal')
  assert.match(src, /document\.body\s*\)/, 'must mount onto document.body, not a project subtree')
})

test('AdminPanel overlay uses inline styles for critical fixed positioning', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  // Inline styles can't be purged by Tailwind and beat any conflicting
  // utility. We require ALL of these to be inline on the overlay.
  assert.match(src, /position:\s*'fixed'/, 'fixed positioning must be inline')
  assert.match(src, /inset:\s*0/, 'inset:0 must be inline')
  assert.match(src, /zIndex:\s*99999/, 'high z-index must be inline')
  assert.match(src, /width:\s*'100vw'/, 'full viewport width fallback')
  assert.match(src, /height:\s*'100vh'/, 'full viewport height fallback')
})

test('AdminPanel modal uses flex-center + auto margin belt-and-suspenders', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  // Flex centering for the modern path
  assert.match(src, /items-center justify-center/, 'flex centering classes present')
  // Auto margins as fallback if flex centering ever breaks
  assert.match(src, /margin:\s*'auto'/, 'auto-margin fallback present')
})

test('AdminPanel still exposes overlay + content test-ids', async () => {
  const src = await readFile(join(ROOT, 'components/dashboard/AdminPanel.jsx'), 'utf8')
  assert.match(src, /data-testid="admin-panel-overlay"/)
  assert.match(src, /data-testid="admin-panel"/)
  assert.match(src, /data-testid="admin-close-btn"/)
})
