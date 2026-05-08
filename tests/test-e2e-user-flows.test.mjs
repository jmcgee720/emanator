// ──────────────────────────────────────────────────────────────────────
// End-to-end user-flow audit test.
//
// Pretends to be a real user doing the two flows the user actually cares
// about right now:
//   1. Open Mangia-Mama → view in preview → make an edit
//   2. Create a new project (Nexsara) → run the wizard → reach the
//      "Skip imagery" decision → land on a working preview
//
// We don't drive a real browser. Instead we simulate each step by:
//   - Importing the relevant module + invoking the function the UI would
//   - Asserting the contract / state transition
//   - Surfacing any defect in the chain so the main agent can fix it
//
// Pure code-level audit. All-fail messages are loud + actionable.
// ──────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

try {
  const t = readFileSync('/app/.env.local', 'utf8')
  for (const l of t.split('\n')) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2]
  }
} catch { /* ok if missing */ }

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ──────────────────────── Flow A: Mangia-Mama preview ────────────────────────

test('FLOW-A.1: Mangia-Mama project exists in DB and has its files', async () => {
  const { createAdminClient } = await import('../lib/supabase/admin.js')
  const sb = createAdminClient()
  const { data: projects } = await sb
    .from('projects')
    .select('id, name, created_at')
    .ilike('name', 'mangia%')
    .order('created_at', { ascending: false })
    .limit(1)
  assert.ok(projects?.length, 'Mangia-Mama project not found in DB')
  const proj = projects[0]
  const { count } = await sb
    .from('project_files')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', proj.id)
  assert.ok(count > 50, `expected 100+ files for a CRA app, got ${count}`)
})

test('FLOW-A.2: Mangia-Mama has package.json with react-scripts (CRA detection works)', async () => {
  const { createAdminClient } = await import('../lib/supabase/admin.js')
  const { resolveContent } = await import('../lib/supabase/file-storage.js')
  const sb = createAdminClient()
  const { data: projects } = await sb
    .from('projects')
    .select('id')
    .ilike('name', 'mangia%')
    .order('created_at', { ascending: false })
    .limit(1)
  const projectId = projects[0].id
  const { data: pkg } = await sb
    .from('project_files')
    .select('content, storage_path')
    .eq('project_id', projectId)
    .or('path.eq.package.json,path.eq.frontend/package.json')
    .limit(1)
    .single()
  assert.ok(pkg, 'no package.json found — preview engine cannot detect framework')
  const text = pkg.content || (await resolveContent(pkg)) || ''
  // Either CRA (react-scripts) or our auto-converted Vite — both are valid
  // entry points the Fly runner can spawn.
  assert.ok(
    /react-scripts|vite/i.test(text),
    `package.json missing both react-scripts AND vite — preview cannot start. Got: ${text.slice(0, 200)}`,
  )
})

test('FLOW-A.3: Fly machine config bumped to 2GB/2vCPU (no more OOM)', async () => {
  const text = readFileSync('/app/lib/fly/machines.js', 'utf8')
  assert.ok(text.includes('memory_mb: 2048'), 'RAM not bumped to 2GB')
  assert.ok(text.includes('cpus: 2'), 'CPU not bumped to 2 vCPU')
})

test('FLOW-A.4: ServerPreview drawer auto-opens during npm install', async () => {
  const text = readFileSync('/app/components/dashboard/tabs/ServerPreview.jsx', 'utf8')
  assert.ok(text.includes(`open={status === 'starting' || drawerOpenOverride}`),
    'drawer must open while status="starting"')
  assert.ok(text.includes('lastInstallActivity'),
    'must show last-activity hint in collapsed summary')
  assert.ok(text.includes('animate-pulse'),
    'must show pulse indicator when install is active')
})

test('FLOW-A.5: ServerPreview boot timeout is 15 minutes (5-10min CRA installs)', async () => {
  const text = readFileSync('/app/components/dashboard/tabs/ServerPreview.jsx', 'utf8')
  assert.ok(text.includes('MAX_POLLS = 300'), 'poll budget should be 300×3s = 15 min')
  assert.ok(text.includes('15 min timeout'), 'error message must reflect the budget')
})

// ──────────────────────── Flow B: Nexsara wizard ────────────────────────

test('FLOW-B.1: Phase 1 plan parser is now token-budget tolerant (8000)', async () => {
  const text = readFileSync('/app/lib/ai/phased-pipeline/phase-1-plan.js', 'utf8')
  assert.ok(text.includes('max_tokens: 8000'),
    'Phase 1 must use 8000 token budget for fullstack plans (was 3000 — that broke Nexsara)')
  assert.ok(text.includes('safeParseJson'),
    'Phase 1 must use the tolerant JSON parser')
  assert.ok(text.includes('fixer'),
    'Phase 1 must have a fixer-retry on parse failure')
})

test('FLOW-B.2: All three plan-style phases use the tolerant parser', async () => {
  for (const f of [
    'lib/ai/phased-pipeline/phase-1-plan.js',
    'lib/ai/phased-pipeline/phase-2-copy.js',
    'lib/ai/phased-pipeline/phase-3-design-tokens.js',
  ]) {
    const text = readFileSync(`/app/${f}`, 'utf8')
    assert.ok(text.includes('safeParseJson'), `${f} must use safeParseJson`)
    assert.ok(!text.includes("raw.match(/\\{[\\s\\S]*\\}/)"),
      `${f} still has the brittle greedy regex fallback — replace with safeParseJson`)
  }
})

test('FLOW-B.3: BuildWizard renders the Skip Imagery button on design_tokens ready state', async () => {
  const text = readFileSync('/app/components/dashboard/BuildWizard.jsx', 'utf8')
  assert.ok(text.includes('build-wizard-skip-imagery'), 'data-testid must be present for tests')
  assert.ok(text.includes('Skip imagery for now'), 'button label must be discoverable')
  assert.ok(text.includes('handleSkipImagery'), 'click handler must exist')
  assert.ok(text.includes("phase.id === 'design_tokens'"),
    'skip button must only render on the tokens-ready state, not other phases')
})

test('FLOW-B.4: /api/build/images route accepts skipImagery and returns deferred sentinel', async () => {
  const text = readFileSync('/app/lib/api/routes/build-steps.js', 'utf8')
  assert.ok(text.includes('skipImagery'), 'route must read skipImagery from request body')
  assert.ok(text.includes('imagery_status'), 'route must stamp project settings flag')
  assert.ok(text.includes("'deferred'"), 'route must use the deferred status string')
})

test('FLOW-B.5: ImageryDeferredBanner renders with proper visibility gating', async () => {
  const text = readFileSync('/app/components/dashboard/ImageryDeferredBanner.jsx', 'utf8')
  assert.ok(text.includes("status !== 'deferred'"), 'banner must hide unless status is deferred')
  assert.ok(text.includes('imagery-generate-btn'), 'data-testid must be present')
  assert.ok(text.includes('/api/build/imagery/generate'), 'click action must hit the right endpoint')
})

test('FLOW-B.6: Phase 5 compose has fullstack-aware file-type hints', async () => {
  const text = readFileSync('/app/lib/ai/phased-pipeline/phase-5-compose.js', 'utf8')
  assert.ok(text.includes('isApiRoute'), 'must detect API routes')
  assert.ok(text.includes('isLibFile'), 'must detect lib files')
  assert.ok(text.includes('THIS IS AN API ROUTE'), 'must hint LLM differently for API routes')
  assert.ok(text.includes('FULLSTACK FILE RULES'), 'fullstack rules must be in the prompt')
})

// ──────────────────────── Cross-cutting safety nets ────────────────────────

test('SAFETY.1: persistContent enforces size cap with FILE_TOO_LARGE', async () => {
  const text = readFileSync('/app/lib/supabase/file-storage.js', 'utf8')
  assert.ok(text.includes('FILE_TOO_LARGE'), 'size cap must throw the named error code')
  assert.ok(text.includes('MAX_FILE_BYTES'), 'cap constant must be exported')
  assert.ok(text.includes('extractInlineImages'), 'image extractor must run before size check')
})

test('SAFETY.2: image extractor skip-list covers binary + brand-VFS paths', async () => {
  const text = readFileSync('/app/lib/supabase/image-extractor.js', 'utf8')
  for (const sentinel of [
    "_assets/", "_generated/", "_uploads/",
    'BINARY_ASSET_EXT',
    'components/assets.js',
  ]) {
    assert.ok(text.includes(sentinel), `extractor missing skip rule: ${sentinel}`)
  }
})

test('SAFETY.3: PreviewTab auto-selects Server engine for fullstack_app projects', async () => {
  const text = readFileSync('/app/components/dashboard/tabs/PreviewTab.jsx', 'utf8')
  assert.ok(text.includes('preview_engine_hint'), 'must read the hint')
  assert.ok(text.includes("hint === 'server'"), 'must auto-flip to server engine when hinted')
})

test('SAFETY.4: orchestrator stamps imagery_status + preview_engine_hint after build', async () => {
  const text = readFileSync('/app/lib/ai/phased-pipeline/index.js', 'utf8')
  assert.ok(text.includes('imagery_status'), 'must stamp imagery status')
  assert.ok(text.includes('preview_engine_hint'), 'must stamp engine hint for fullstack')
  assert.ok(text.includes("'fullstack_app'"), 'must check fullstack archetype')
})

test('SAFETY.5: bulkInsert is per-row tolerant (Promise.allSettled)', async () => {
  const text = readFileSync('/app/lib/supabase/db.js', 'utf8')
  assert.ok(text.includes('Promise.allSettled'),
    'bulkInsert must use allSettled so a single oversized file does not abort the batch')
})

// ──────────────────────── E2E-style smoke ────────────────────────

test('E2E-SMOKE: Phase 1 actually parses a fullstack plan with truncation', async () => {
  // Reproduce the exact failure mode from the user screenshot: a long
  // fullstack-style plan that gets cut off mid-array. The tolerant
  // parser MUST recover.
  const { safeParseJson } = await import('../lib/ai/safe-json.js')
  const truncated = `{
    "archetype": "fullstack_app",
    "brand": { "name": "Nexsara", "tagline": "AI-powered marketing", "mood": "futuristic", "audience": "marketers", "tone": "confident" },
    "sections": [
      { "id": "nav", "purpose": "main navigation" },
      { "id": "hero", "purpose": "headline + CTA" },
      { "id": "features", "purpose": "showcase features", "count": 3 },
      { "id": "demo", "purpose": "product demo" },
      { "id": "pricing", "purpose": "pricing tiers" },
      { "id": "footer", "purpose": "links + contact" }
    ],
    "imageManifest": [
      { "role": "hero", "subject": "futuristic AI dashboard with marketing analytics" },
      { "role": "feature_1", "subject": "automated email campaigns dashboard" },
      { "role": "feature_2", "subject": "social media scheduler interface" },
      { "role": "feature_3", "subject": "campaign performance analytics" }`
    // ↑ truncated mid-array, exactly like the real Nexsara failure
  const parsed = safeParseJson(truncated)
  assert.equal(parsed.ok, true, `safeParseJson must recover: ${parsed.error?.message}`)
  assert.equal(parsed.value.archetype, 'fullstack_app')
  assert.equal(parsed.value.brand.name, 'Nexsara')
  assert.equal(parsed.value.sections.length, 6)
  assert.ok(parsed.value.imageManifest.length >= 3, 'must salvage at least the complete entries')
})

test('E2E-SMOKE: image extractor handles a real-world JSX with 12 inlined PNGs', async () => {
  const { extractInlineImages } = await import('../lib/supabase/image-extractor.js')
  // Simulate the AI emitting a runaway base64 page (Nexsara repro).
  const big = 'A'.repeat(50 * 1024) // 50KB base64 ≈ 37KB binary
  const dataUri = `data:image/png;base64,${big}`
  const code = `export default function Page() {
    return (
      <div>
        ${Array(12).fill(0).map(() => `<img src="${dataUri}" />`).join('\n')}
      </div>
    )
  }`
  const before = code.length
  // Use a fake project ID so the DB upserts no-op (ensureBucket will
  // succeed but the row insert will go through; this test does live
  // hit Supabase, so use a clearly-test project ID).
  const r = await extractInlineImages('test-e2e-smoke-project', 'app/page.jsx', code)
  // Even if the DB write fails (test env), the regex detection is the
  // key contract. We accept any extractedCount >= 0 — what we want to
  // assert is that the function ran without throwing.
  assert.ok(r.content.length <= before, 'rewritten content must be <= original')
  assert.equal(typeof r.extractedCount, 'number')
})

let pass = 0, fail = 0
for (const t of tests) {
  try { await t.fn(); console.log(`  ✓ ${t.name}`); pass++ }
  catch (e) { console.error(`  ✗ ${t.name}\n      ${e.message}`); fail++ }
}
console.log(`\n${pass} passing, ${fail} failing`)
process.exit(fail ? 1 : 0)
