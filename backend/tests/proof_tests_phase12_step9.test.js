/**
 * Phase 12 Step 9 — Proof Tests for Self-Modification Safety & End-to-End Correctness
 *
 * 12 proof tests validating that Emanator can safely self-modify through Core System flow.
 *
 * Primary targets:
 *   /app/lib/ai/service.js
 *   /app/lib/self_builder/safe_apply.js
 *   /app/lib/self_builder/change_log.js
 *   /app/lib/ai/plan-validator.js
 *   /app/app/api/[[...path]]/route.js
 *   /app/components/dashboard/Dashboard.jsx
 *   /app/components/dashboard/LeftPanel.jsx
 *   /app/components/dashboard/DiffReviewPanel.jsx
 *   /app/components/dashboard/BuilderMemory.jsx
 *
 * Test Environment:
 *   URL: https://api-feature-extract.preview.emergentagent.com
 *   Auth: testprov@test.com / password123  (Supabase)
 */

/* ──────────────────────── mock setup (unit tests only) ──────────────────────── */
jest.mock('../../lib/supabase/db', () => ({
  db: {
    chats:            { findById: jest.fn(), create: jest.fn() },
    users:            { findById: jest.fn() },
    messages:         { findByChatId: jest.fn(), findById: jest.fn(), update: jest.fn() },
    projectFiles:     { findByPath: jest.fn(), findByProjectId: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    fileChangeEvents: { create: jest.fn() },
    changelog:        { create: jest.fn(), findByProject: jest.fn(), findLastRejectedForTask: jest.fn() },
    projectMemory:    { findByProjectId: jest.fn().mockResolvedValue([]), create: jest.fn(), updateById: jest.fn(), deleteById: jest.fn() },
  }
}))

/* ──────────────────────── constants ──────────────────────── */
const BASE_URL       = 'https://api-feature-extract.preview.emergentagent.com'
const SUPABASE_URL   = 'https://cawmmqakaxbznbelcrwd.supabase.co'
const SUPABASE_KEY   = 'sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22'
const TEST_EMAIL     = 'testprov@test.com'
const TEST_PASSWORD  = 'password123'
const SELF_EDIT_PREFIX = '⚙ Self-Edit: '

/* ──────────────────────── helpers ──────────────────────── */

/** Authenticate via Supabase password grant and return bearer header string */
async function getSupabaseToken() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Supabase auth failed: ${res.status}`)
  const data = await res.json()
  return `Bearer ${data.access_token}`
}

/** Reset all mocks between unit tests */
function resetMocks() {
  const { db } = require('../../lib/supabase/db')
  Object.values(db).forEach(ns => {
    Object.values(ns).forEach(fn => { if (typeof fn.mockReset === 'function') fn.mockReset() })
  })
  // Restore commonly-needed defaults
  db.projectMemory.findByProjectId.mockResolvedValue([])
}

/* ════════════════════════════════════════════════════════════
 *  TEST SUITE
 * ════════════════════════════════════════════════════════════ */

describe('Phase 12 Step 9 — Self-Modification Safety Proof Tests', () => {
  let authToken   = null
  let projectId   = null
  const cleanupChatIds = []

  // ── Setup: real Supabase auth ──
  beforeAll(async () => {
    try {
      authToken = await getSupabaseToken()
      console.log('✅ Supabase auth token obtained')
    } catch (err) {
      console.warn('⚠️  Supabase auth failed — API tests will be skipped:', err.message)
    }

    if (authToken) {
      try {
        const res = await fetch(`${BASE_URL}/api/projects`, {
          headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
        })
        if (res.ok) {
          const projects = await res.json()
          if (projects.length > 0) {
            projectId = projects[0].id
            console.log('✅ Test project:', projectId)
          }
        }
      } catch {}
    }
  }, 15000)

  // ── Cleanup: delete any chats we created ──
  afterAll(async () => {
    for (const chatId of cleanupChatIds) {
      try {
        await fetch(`${BASE_URL}/api/chats/${chatId}`, {
          method: 'DELETE',
          headers: { 'Authorization': authToken },
        })
      } catch {}
    }
  }, 15000)

  beforeEach(() => resetMocks())

  /* ─────────────────────────────────────────────
   * PROOF 1: Core System owner creates self-edit chat
   * (API integration)
   * ───────────────────────────────────────────── */
  test('Proof 1: Core System owner creates self-edit chat', async () => {
    expect(authToken).toBeTruthy()
    expect(projectId).toBeTruthy()

    const res = await fetch(`${BASE_URL}/api/projects/${projectId}/chats`, {
      method: 'POST',
      headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${SELF_EDIT_PREFIX}Proof Test 1`, is_self_edit: true }),
    })

    expect(res.status).toBe(201)
    const chat = await res.json()
    cleanupChatIds.push(chat.id)

    expect(chat.title).toMatch(/^⚙ Self-Edit:/)
    expect(chat.chat_type).toBe('self_edit')
    console.log('✅ PROOF 1 PASSED: self-edit chat created, chat_type=self_edit')
  })

  /* ─────────────────────────────────────────────
   * PROOF 2: self-edit target selected (streaming accepts metadata.selfEditTarget)
   * (API integration)
   * ───────────────────────────────────────────── */
  test('Proof 2: self-edit target selected via streaming', async () => {
    expect(authToken).toBeTruthy()
    expect(projectId).toBeTruthy()

    // Create a self-edit chat
    const chatRes = await fetch(`${BASE_URL}/api/projects/${projectId}/chats`, {
      method: 'POST',
      headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${SELF_EDIT_PREFIX}Target Test`, is_self_edit: true }),
    })
    expect(chatRes.status).toBe(201)
    const chat = await chatRes.json()
    cleanupChatIds.push(chat.id)

    // Stream a message with selfEditTarget metadata — must return 200 SSE (not 403)
    const streamRes = await fetch(`${BASE_URL}/api/chats/${chat.id}/messages/stream`, {
      method: 'POST',
      headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'inspect plan_validator',
        metadata: { provider: 'openai', selfEditTarget: 'plan_validator' },
      }),
    })

    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream')
    console.log('✅ PROOF 2 PASSED: self-edit target accepted, streaming 200 SSE')
  }, 30000)

  /* ─────────────────────────────────────────────
   * PROOF 3: plan generated with valid file_actions
   * (unit — plan-validator)
   * ───────────────────────────────────────────── */
  test('Proof 3: plan generated with valid file_actions', () => {
    const { validatePlan } = require('../../lib/ai/plan-validator')

    const plan = {
      file_actions: [{ path: 'lib/test.js', action: 'create', content: 'const x = 1' }],
      reasoning: ['create new utility module'],
    }
    const fileContext = {
      existingPaths: [],
      files: [{ path: 'lib/test.js', exists: false }],
    }

    const result = validatePlan(plan, fileContext)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.hash).toBeTruthy()
    console.log('✅ PROOF 3 PASSED: valid plan accepted by validator')
  })

  /* ─────────────────────────────────────────────
   * PROOF 4: validator accepts valid plan / rejects invalid
   * (unit — plan-validator)
   * ───────────────────────────────────────────── */
  test('Proof 4: validator rejects invalid plan (create-on-existing)', () => {
    const { validatePlan } = require('../../lib/ai/plan-validator')

    const plan = {
      file_actions: [{ path: 'lib/existing.js', action: 'create', content: 'x' }],
    }
    const fileContext = {
      existingPaths: ['lib/existing.js'],
      files: [{ path: 'lib/existing.js', exists: true, content: 'old' }],
    }

    const result = validatePlan(plan, fileContext)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('marked create but file exists'))).toBe(true)
    console.log('✅ PROOF 4 PASSED: validator rejects create-on-existing')
  })

  /* ─────────────────────────────────────────────
   * PROOF 5: diff preview appears with diffStatus='pending'
   * (unit — safe_apply.findPendingDiffMessage)
   * ───────────────────────────────────────────── */
  test('Proof 5: diff preview appears with diffStatus=pending', async () => {
    const { findPendingDiffMessage } = require('../../lib/self_builder/safe_apply')
    const { db } = require('../../lib/supabase/db')

    const pendingMsg = {
      id: 'msg-pending-1',
      metadata: {
        diffStatus: 'pending',
        diffFiles: [{ path: 'components/dashboard/Dashboard.jsx', action: 'update' }],
      },
    }
    db.messages.findByChatId.mockResolvedValue([pendingMsg])

    const found = await findPendingDiffMessage('chat-abc')
    expect(found).toBeTruthy()
    expect(found.metadata.diffStatus).toBe('pending')
    expect(found.metadata.diffFiles).toHaveLength(1)
    console.log('✅ PROOF 5 PASSED: pending diff message found with diffStatus=pending')
  })

  /* ─────────────────────────────────────────────
   * PROOF 6: apply succeeds through safe_apply
   * (unit — safe_apply.safeApplyDiffs)
   * ───────────────────────────────────────────── */
  test('Proof 6: apply succeeds through safe_apply', async () => {
    const { safeApplyDiffs } = require('../../lib/self_builder/safe_apply')
    const { db } = require('../../lib/supabase/db')

    db.projectFiles.findByPath.mockResolvedValue(null) // file doesn't exist
    db.projectFiles.create.mockResolvedValue({ id: 'f1', path: 'test.js', content: 'const x=1' })
    db.fileChangeEvents.create.mockResolvedValue({})

    const diffs = [{ path: 'test.js', action: 'create', newContent: 'const x=1' }]
    const result = await safeApplyDiffs('proj-1', diffs, () => 'javascript')

    expect(result.written).toContain('test.js')
    expect(result.errors).toHaveLength(0)
    expect(result.rolledBack).toBe(false)
    console.log('✅ PROOF 6 PASSED: safeApplyDiffs creates file successfully')
  })

  /* ─────────────────────────────────────────────
   * PROOF 7: diffStatus transitions to 'applied'
   * (unit — safe_apply with chatId + messageId)
   * ───────────────────────────────────────────── */
  test('Proof 7: diffStatus transitions to applied', async () => {
    const { safeApplyDiffs } = require('../../lib/self_builder/safe_apply')
    const { db } = require('../../lib/supabase/db')

    db.chats.findById.mockResolvedValue({ id: 'c1', title: 'Regular Chat' })
    db.messages.findById.mockResolvedValue({ id: 'msg-7', metadata: { diffStatus: 'pending' } })
    db.messages.update.mockResolvedValue({})
    db.projectFiles.findByPath.mockResolvedValue(null)
    db.projectFiles.create.mockResolvedValue({ id: 'f7' })
    db.fileChangeEvents.create.mockResolvedValue({})

    const diffs = [{ path: 'test7.js', action: 'create', newContent: 'x=7' }]
    const result = await safeApplyDiffs('proj-7', diffs, () => 'text', {
      chatId: 'c1', userId: 'u1', messageId: 'msg-7',
    })

    expect(result.diffStatusTransitioned).toBe('applied')
    // Verify messages.update was called with diffStatus='applied'
    expect(db.messages.update).toHaveBeenCalledWith('msg-7', expect.objectContaining({
      metadata: expect.objectContaining({ diffStatus: 'applied' }),
    }))
    console.log('✅ PROOF 7 PASSED: diffStatus transitioned to applied')
  })

  /* ─────────────────────────────────────────────
   * PROOF 8: changelog entry written with correct metadata
   * (unit — change_log.logChange)
   * ───────────────────────────────────────────── */
  test('Proof 8: changelog entry with correct metadata', async () => {
    const { logChange } = require('../../lib/self_builder/change_log')
    const { db } = require('../../lib/supabase/db')

    db.changelog.create.mockResolvedValue({})
    // addPromptPatternToMemory / recordPatternSuccess need memory mock
    db.projectMemory.findByProjectId.mockResolvedValue([])
    db.projectMemory.create.mockResolvedValue({})

    await logChange({
      projectId: 'p8',
      chatId: 'c8',
      userId: 'u8',
      userTask: 'update Dashboard.jsx layout for Core System',
      taskMode: 'apply',
      result: 'applied',
      filePaths: ['components/dashboard/Dashboard.jsx'],
      fileActions: [{ path: 'components/dashboard/Dashboard.jsx', action: 'write' }],
      chatType: 'self_edit',
    })

    expect(db.changelog.create).toHaveBeenCalledTimes(1)
    const entry = db.changelog.create.mock.calls[0][0]
    expect(entry.project_id).toBe('p8')
    expect(entry.chat_id).toBe('c8')
    expect(entry.user_id).toBe('u8')
    expect(entry.task_mode).toBe('apply')
    expect(entry.file_actions).toEqual([{ path: 'components/dashboard/Dashboard.jsx', action: 'write' }])
    expect(entry.validator_result).toEqual({ result: 'applied', chat_type: 'self_edit' })
    expect(entry.created_at).toBeTruthy()
    console.log('✅ PROOF 8 PASSED: changelog entry written with full metadata')
  })

  /* ─────────────────────────────────────────────
   * PROOF 9: builder memory reflects resulting status/update
   * (API integration — GET /api/projects/:id/builder-status + memory)
   * ───────────────────────────────────────────── */
  test('Proof 9: builder memory reflects status', async () => {
    expect(authToken).toBeTruthy()
    expect(projectId).toBeTruthy()

    // Check builder-status endpoint
    const statusRes = await fetch(`${BASE_URL}/api/projects/${projectId}/builder-status`, {
      headers: { 'Authorization': authToken },
    })
    expect(statusRes.status).toBe(200)
    const status = await statusRes.json()
    expect(status).toHaveProperty('total')
    expect(status).toHaveProperty('applied')
    expect(status).toHaveProperty('rolledBack')
    expect(status).toHaveProperty('discarded')
    expect(status).toHaveProperty('selfEdits')
    expect(status).toHaveProperty('lastBuild')

    // Check memory endpoint
    const memRes = await fetch(`${BASE_URL}/api/projects/${projectId}/memory`, {
      headers: { 'Authorization': authToken },
    })
    expect(memRes.status).toBe(200)
    const memory = await memRes.json()
    expect(Array.isArray(memory)).toBe(true)

    console.log(`✅ PROOF 9 PASSED: builder-status returned (total=${status.total}, applied=${status.applied}, selfEdits=${status.selfEdits}), memory=${memory.length} entries`)
  })

  /* ─────────────────────────────────────────────
   * PROOF 10: discard path works on a separate pending diff
   * (unit — safe_apply.discardDiffs)
   * ───────────────────────────────────────────── */
  test('Proof 10: discard path works', async () => {
    const { discardDiffs } = require('../../lib/self_builder/safe_apply')
    const { db } = require('../../lib/supabase/db')

    db.chats.findById.mockResolvedValue({ title: 'Builder Chat' })
    const pendingMsg = { id: 'msg-10', metadata: { diffStatus: 'pending' } }
    db.messages.findByChatId.mockResolvedValue([pendingMsg])
    db.messages.findById.mockResolvedValue(pendingMsg)
    db.messages.update.mockResolvedValue({})

    const result = await discardDiffs('chat-10', 'msg-10', 'u10')
    expect(result.discarded).toBe(true)
    expect(result.diffStatusTransitioned).toBe('discarded')
    console.log('✅ PROOF 10 PASSED: discard transitions diffStatus to discarded')
  })

  /* ─────────────────────────────────────────────
   * PROOF 11: rollback path works on a forced failed apply case
   * (unit — safe_apply.safeApplyDiffs with intentional failure)
   * ───────────────────────────────────────────── */
  test('Proof 11: rollback on forced failure', async () => {
    const { safeApplyDiffs } = require('../../lib/self_builder/safe_apply')
    const { db } = require('../../lib/supabase/db')

    // Snapshot phase: both files don't exist
    db.projectFiles.findByPath.mockResolvedValue(null)

    // First create succeeds, second fails
    let createCallCount = 0
    db.projectFiles.create.mockImplementation(() => {
      createCallCount++
      if (createCallCount === 1) {
        return Promise.resolve({ id: 'new-file-1', path: 'first.js' })
      }
      return Promise.reject(new Error('Forced DB failure on second file'))
    })

    db.fileChangeEvents.create.mockResolvedValue({})

    // During rollback, findByPath is called again to find the newly-created file.
    // Call sequence:
    //   #1 snapshot first.js → null
    //   #2 snapshot second.js → null
    //   #3 rollback first.js → must return the created file so it can be deleted
    let findByPathCallCount = 0
    db.projectFiles.findByPath.mockImplementation((pid, path) => {
      findByPathCallCount++
      // Calls 1-2: snapshot phase (both null).  Call 3+: rollback phase.
      if (path === 'first.js' && findByPathCallCount >= 3) {
        return Promise.resolve({ id: 'new-file-1', path: 'first.js' })
      }
      return Promise.resolve(null)
    })

    db.projectFiles.delete.mockResolvedValue({})

    const diffs = [
      { path: 'first.js', action: 'create', newContent: 'const a=1' },
      { path: 'second.js', action: 'create', newContent: 'const b=2' },
    ]

    const result = await safeApplyDiffs('proj-11', diffs, () => 'text')

    expect(result.rolledBack).toBe(true)
    expect(result.written).toHaveLength(0) // all rolled back
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.rollbackDetails).toBeTruthy()
    // first.js was a new file → rollback should delete it
    expect(result.rollbackDetails.deleted).toContain('first.js')
    console.log('✅ PROOF 11 PASSED: rollback deleted newly-created file on failure')
  })

  /* ─────────────────────────────────────────────
   * PROOF 12: normal builder chat cannot perform self-edit apply flow
   * (unit + API)
   * ───────────────────────────────────────────── */
  test('Proof 12: normal builder chat cannot self-edit apply', async () => {
    // ── 12a (unit): self-edit chat + non-owner → FORBIDDEN ──
    const { safeApplyDiffs } = require('../../lib/self_builder/safe_apply')
    const { db } = require('../../lib/supabase/db')

    db.chats.findById.mockResolvedValue({ id: 'se-chat', title: `${SELF_EDIT_PREFIX}Danger` })
    db.users.findById.mockResolvedValue({ id: 'member-user', role: 'member' })

    const seResult = await safeApplyDiffs('proj-12', [{ path: 'x.js', action: 'create', newContent: 'x' }], () => 'text', {
      chatId: 'se-chat', userId: 'member-user',
    })
    expect(seResult.errors.some(e => e.includes('FORBIDDEN'))).toBe(true)
    expect(seResult.written).toHaveLength(0)
    console.log('  ✅ 12a: self-edit + member → FORBIDDEN')

    // ── 12b (unit): builder chat + member → allowed ──
    resetMocks()
    db.chats.findById.mockResolvedValue({ id: 'builder-chat', title: 'Normal Builder Chat' })
    db.users.findById.mockResolvedValue({ id: 'member-user', role: 'member' })
    db.projectFiles.findByPath.mockResolvedValue(null)
    db.projectFiles.create.mockResolvedValue({ id: 'f12' })
    db.fileChangeEvents.create.mockResolvedValue({})

    const builderResult = await safeApplyDiffs('proj-12', [{ path: 'y.js', action: 'create', newContent: 'y' }], () => 'text', {
      chatId: 'builder-chat', userId: 'member-user',
    })
    expect(builderResult.errors.some(e => e.includes('FORBIDDEN'))).toBe(false)
    expect(builderResult.written).toContain('y.js')
    console.log('  ✅ 12b: builder chat + member → allowed')

    // ── 12c (API): title prefix injection protection ──
    if (authToken && projectId) {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}/chats`, {
        method: 'POST',
        headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${SELF_EDIT_PREFIX}Injection Attempt`, is_self_edit: false }),
      })
      expect(res.status).toBe(201)
      const chat = await res.json()
      cleanupChatIds.push(chat.id)
      // Prefix must be stripped when is_self_edit=false
      expect(chat.title).not.toMatch(/^⚙ Self-Edit:/)
      expect(chat.chat_type).toBe('builder')
      console.log('  ✅ 12c: title prefix stripped when is_self_edit=false (injection protection)')
    }

    console.log('✅ PROOF 12 PASSED: normal builder chat cannot self-edit')
  })

  /* ─────────────────────────────────────────────
   * SUMMARY
   * ───────────────────────────────────────────── */
  afterAll(() => {
    console.log('\n' + '═'.repeat(72))
    console.log('  PHASE 12 STEP 9 — SELF-MODIFICATION SAFETY PROOF TESTS COMPLETE')
    console.log('═'.repeat(72))
  })
})
