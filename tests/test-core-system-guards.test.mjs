// ──────────────────────────────────────────────────────────────────────
// Core System self-edit guardrails
// ──────────────────────────────────────────────────────────────────────
// Pins the gate that prevents the next NextAuth-style incident:
//   - writes to protected paths (auth, payments, env, schema, layout,
//     middleware) refuse without a literal `CONFIRMED: <path>` token
//     in the user's recent messages
//   - package.json edits that add forbidden auth-framework deps refuse
//   - even when the destination is not protected, kill-switch
//     substrings (`from 'next-auth'`, `process.env.NEXTAUTH`, etc)
//     refuse without CONFIRMED
//   - vague approvals ("yes", "go ahead") explicitly do NOT satisfy
//     the gate
//   - all of this runs ONLY in self-edit mode; project chats are
//     unaffected

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isPathGuarded,
  detectForbiddenPackageAdds,
  detectKillSwitchSubstrings,
  hasUserConfirmation,
  buildGuardRefusalMessage,
} from '../lib/ai/core-system-guards.js'

// ── isPathGuarded ─────────────────────────────────────────────────

test('isPathGuarded: catches direct auth file edit (components/auth/LoginPage.jsx)', () => {
  const r = isPathGuarded('components/auth/LoginPage.jsx')
  assert.equal(r.guarded, true)
  assert.equal(r.matchedPattern, 'components/auth/**')
})

test('isPathGuarded: catches AppShell.jsx (the NextAuth incident touched it)', () => {
  const r = isPathGuarded('components/AppShell.jsx')
  assert.equal(r.guarded, true)
  assert.equal(r.matchedPattern, 'components/AppShell.jsx')
})

test('isPathGuarded: catches middleware.js + middleware.ts variants', () => {
  assert.equal(isPathGuarded('middleware.js').guarded, true)
  assert.equal(isPathGuarded('middleware.ts').guarded, true)
})

test('isPathGuarded: catches app/auth/callback/route.js', () => {
  const r = isPathGuarded('app/auth/callback/route.js')
  assert.equal(r.guarded, true)
  assert.equal(r.matchedPattern, 'app/auth/**')
})

test('isPathGuarded: catches Stripe / payment routes', () => {
  assert.equal(isPathGuarded('app/api/stripe/webhook/route.js').guarded, true)
  assert.equal(isPathGuarded('lib/payments/charge.js').guarded, true)
  assert.equal(isPathGuarded('lib/credits/balance.js').guarded, true)
})

test('isPathGuarded: catches env files', () => {
  assert.equal(isPathGuarded('.env').guarded, true)
  assert.equal(isPathGuarded('.env.local').guarded, true)
  assert.equal(isPathGuarded('.env.production').guarded, true)
})

test('isPathGuarded: catches Supabase migrations', () => {
  assert.equal(isPathGuarded('supabase/migrations/009_add_oauth_fields.sql').guarded, true)
  assert.equal(isPathGuarded('supabase/migrations/001_init.sql').guarded, true)
})

test('isPathGuarded: handles leading-slash normalization', () => {
  // Models sometimes prefix paths with /; we strip those before
  // matching so the guard is not bypassed by a stray slash.
  assert.equal(isPathGuarded('/components/auth/LoginPage.jsx').guarded, true)
})

test('isPathGuarded: NORMAL files are not guarded', () => {
  for (const safe of [
    'components/dashboard/Dashboard.jsx',
    'components/dashboard/ChatComposer.jsx',
    'lib/ai/agent-core.js',
    'app/api/projects/[id]/route.js',
    'README.md',
    'tests/test-foo.test.mjs',
  ]) {
    const r = isPathGuarded(safe)
    assert.equal(r.guarded, false, `expected ${safe} to be unguarded`)
  }
})

// ── detectForbiddenPackageAdds ────────────────────────────────────

test('detectForbiddenPackageAdds: catches next-auth in new package.json', () => {
  const pkg = JSON.stringify({
    name: 'auroraly', version: '0.1.0',
    dependencies: { 'next': '14.0.0', 'next-auth': '5.0.0', 'react': '18.0.0' },
  })
  const r = detectForbiddenPackageAdds(pkg)
  assert.equal(r.guarded, true)
  assert.ok(r.matchedPackages.includes('next-auth'))
})

test('detectForbiddenPackageAdds: catches multiple auth framework adds (clerk + lucia)', () => {
  const pkg = JSON.stringify({
    dependencies: { '@clerk/nextjs': '5.0.0', 'lucia': '3.0.0', 'next': '14.0.0' },
  })
  const r = detectForbiddenPackageAdds(pkg)
  assert.equal(r.guarded, true)
  assert.deepEqual(r.matchedPackages.sort(), ['@clerk/nextjs', 'lucia'].sort())
})

test('detectForbiddenPackageAdds: does NOT flag already-present deps (only NEW adds)', () => {
  // If next-auth is somehow already in deps, an edit that keeps it is
  // not the moment to gate — that ship has sailed. Gate only the ADD.
  const previous = JSON.stringify({ dependencies: { 'next-auth': '5.0.0' } })
  const next = JSON.stringify({ dependencies: { 'next-auth': '5.0.0', 'lodash': '4.0.0' } })
  const r = detectForbiddenPackageAdds(next, previous)
  assert.equal(r.guarded, false)
})

test('detectForbiddenPackageAdds: malformed package.json fails open (does not block)', () => {
  // We do not want a typo in package.json to brick legitimate edits.
  // The downstream tools will fail on the malformed JSON anyway.
  const r = detectForbiddenPackageAdds('{ this is not valid json')
  assert.equal(r.guarded, false)
})

test('detectForbiddenPackageAdds: catches devDependencies adds too', () => {
  const pkg = JSON.stringify({ devDependencies: { 'next-auth': '5.0.0' } })
  const r = detectForbiddenPackageAdds(pkg)
  assert.equal(r.guarded, true)
})

// ── detectKillSwitchSubstrings ────────────────────────────────────

test('detectKillSwitchSubstrings: catches `from \'next-auth\'` import', () => {
  const content = "import { getServerSession } from 'next-auth'"
  const r = detectKillSwitchSubstrings(content)
  assert.equal(r.guarded, true)
  assert.ok(r.matchedSubstrings.some((s) => s.includes('next-auth')))
})

test('detectKillSwitchSubstrings: catches process.env.NEXTAUTH', () => {
  const content = 'const secret = process.env.NEXTAUTH_SECRET || ""'
  const r = detectKillSwitchSubstrings(content)
  assert.equal(r.guarded, true)
})

test('detectKillSwitchSubstrings: catches the literal supabase.auth replacement', () => {
  const content = '// disabling supabase\nsupabase.auth = { signInWithOAuth: () => null }'
  const r = detectKillSwitchSubstrings(content)
  assert.equal(r.guarded, true)
})

test('detectKillSwitchSubstrings: normal code is not flagged', () => {
  const content = 'export function add(a, b) { return a + b }\nconst foo = useSession()'
  const r = detectKillSwitchSubstrings(content)
  assert.equal(r.guarded, false)
})

// ── hasUserConfirmation ──────────────────────────────────────────

test('hasUserConfirmation: exact CONFIRMED:<path> in last user message accepts', () => {
  const msgs = [
    { role: 'user', content: 'please fix the google login bug' },
    { role: 'assistant', content: 'I propose changing components/auth/LoginPage.jsx ...' },
    { role: 'user', content: 'CONFIRMED: components/auth/LoginPage.jsx' },
  ]
  assert.equal(hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'), true)
})

test('hasUserConfirmation: CONFIRMED with parent prefix also accepts', () => {
  // User typing CONFIRMED: components/auth authorizes any file under
  // that subtree, so they do not have to re-confirm each individual
  // file in a multi-file change.
  const msgs = [{ role: 'user', content: 'CONFIRMED: components/auth' }]
  assert.equal(hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'), true)
})

test('hasUserConfirmation: vague approvals DO NOT count', () => {
  for (const phrase of ['yes', 'sure', 'go ahead', 'do it', 'ok', 'yes confirmed', 'YES', '👍']) {
    const msgs = [{ role: 'user', content: phrase }]
    assert.equal(
      hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'),
      false,
      `vague approval "${phrase}" must NOT pass the gate`,
    )
  }
})

test('hasUserConfirmation: CONFIRMED for a different path does NOT authorize this path', () => {
  const msgs = [{ role: 'user', content: 'CONFIRMED: components/dashboard/Dashboard.jsx' }]
  assert.equal(hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'), false)
})

test('hasUserConfirmation: CONFIRMED token must start the line (case-sensitive on CONFIRMED:)', () => {
  const msgs = [{ role: 'user', content: 'confirmed: components/auth/LoginPage.jsx' }]
  assert.equal(
    hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'),
    false,
    'lowercase confirmed: must NOT satisfy the gate',
  )
})

test('hasUserConfirmation: only the last 20 messages are scanned', () => {
  // 25 messages — the CONFIRMED is in the FIRST one, so it is older
  // than the 20-message window and should NOT count.
  const msgs = []
  msgs.push({ role: 'user', content: 'CONFIRMED: components/auth/LoginPage.jsx' })
  for (let i = 0; i < 24; i++) msgs.push({ role: 'assistant', content: `turn ${i}` })
  // The 24 assistant messages drown out the user CONFIRMED. With a
  // 20-message lookback window, we should still be looking at indices
  // 5..24 (zero-indexed), and the CONFIRMED at index 0 is dropped.
  assert.equal(hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'), false)
})

test('hasUserConfirmation: assistant messages with CONFIRMED do NOT count (only user role)', () => {
  // Critical: the model cannot self-authorize by saying CONFIRMED in
  // its own output. Only role:user satisfies the gate.
  const msgs = [
    { role: 'user', content: 'please fix something' },
    { role: 'assistant', content: 'CONFIRMED: components/auth/LoginPage.jsx — proceeding...' },
  ]
  assert.equal(hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'), false)
})

test('hasUserConfirmation: works with array-style content (vision API shape)', () => {
  const msgs = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
      { type: 'text', text: 'CONFIRMED: components/auth/LoginPage.jsx' },
    ],
  }]
  assert.equal(hasUserConfirmation(msgs, 'components/auth/LoginPage.jsx'), true)
})

// ── buildGuardRefusalMessage ──────────────────────────────────────

test('refusal: path refusal explains the CONFIRMED token format', () => {
  const msg = buildGuardRefusalMessage({
    kind: 'path', path: 'components/auth/LoginPage.jsx', matchedPattern: 'components/auth/**',
  })
  assert.match(msg, /PROTECTED PATH/)
  assert.match(msg, /CONFIRMED: components\/auth\/LoginPage\.jsx/)
  assert.match(msg, /Vague approval/)
})

test('refusal: package refusal names the specific package', () => {
  const msg = buildGuardRefusalMessage({
    kind: 'package', matchedPackages: ['next-auth'],
  })
  assert.match(msg, /PROTECTED DEPENDENCY/)
  assert.match(msg, /next-auth/)
  assert.match(msg, /CONFIRMED: next-auth/)
})

test('refusal: kill_switch refusal lists the matched substrings', () => {
  const msg = buildGuardRefusalMessage({
    kind: 'kill_switch', matchedSubstrings: ["from 'next-auth'"],
  })
  assert.match(msg, /PROTECTED CODE PATTERN/)
  assert.match(msg, /next-auth/)
})

// ── System prompt wiring ─────────────────────────────────────────

test('self-edit system prompt: includes PROTECTED_PATHS_RULE', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const src = await readFile(join(__dirname, '..', 'lib', 'api', 'stream-handler-v2.js'), 'utf8')

  const selfEditFn = src.slice(src.indexOf('function buildSelfEditSystemPrompt'), src.indexOf('function buildSelfEditScope'))
  assert.match(selfEditFn, /PROTECTED_PATHS_RULE/, 'self-edit prompt must include the protected paths rule')

  // The constant body must define the gate phrasing and explicitly
  // forbid vague approvals.
  assert.match(src, /const PROTECTED_PATHS_RULE = \[/, 'must define PROTECTED_PATHS_RULE constant')
  assert.match(src, /CONFIRMED:/, 'must mention the CONFIRMED token')
  assert.match(src, /Vague approval/, 'must explicitly forbid vague approvals')
})

test('project system prompt: does NOT include PROTECTED_PATHS_RULE (project chats unaffected)', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const src = await readFile(join(__dirname, '..', 'lib', 'api', 'stream-handler-v2.js'), 'utf8')

  const projectFn = src.slice(src.indexOf('function buildProjectSystemPrompt'), src.indexOf('function buildSelfEditSystemPrompt'))
  assert.ok(
    !projectFn.includes('PROTECTED_PATHS_RULE'),
    'project-mode prompt must NOT include PROTECTED_PATHS_RULE — protected paths apply to Core System self-edit only',
  )
})
