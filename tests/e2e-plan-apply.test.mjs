/**
 * E2E Integration Test: plan → execute → diff → apply
 *
 * Tests the critical pipeline through the real SSE stream API.
 * Requires Next.js running on localhost:3002 and valid Supabase credentials.
 *
 * Run: node --test tests/e2e-plan-apply.test.mjs
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const NJ_HOST = 'localhost'
const NJ_PORT = 3002
const SUPABASE_URL = 'https://cawmmqakaxbznbelcrwd.supabase.co'
const SUPABASE_ANON = 'sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22'

// ── Helpers ──

async function supabaseAuth() {
  const body = JSON.stringify({ email: 'testprov@test.com', password: 'password123' })
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body,
  })
  const data = await res.json()
  assert.ok(data.access_token, 'auth should return access_token')
  return data.access_token
}

function apiCall(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: NJ_HOST, port: NJ_PORT, path, method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    const req = http.request(opts, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve(buf) } })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function sseStream(path, token, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: NJ_HOST, port: NJ_PORT, path, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    const req = http.request(opts, res => {
      let buf = ''
      const events = []
      res.on('data', chunk => {
        buf += chunk.toString()
        while (buf.includes('\n\n')) {
          const [block, rest] = buf.split('\n\n', 2)
          buf = rest
          const lines = block.trim().split('\n')
          let event = '', data = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7)
            else if (line.startsWith('data: ')) data = line.slice(6)
          }
          if (event) {
            try { events.push({ event, data: JSON.parse(data) }) } catch { events.push({ event, data }) }
          }
        }
      })
      res.on('end', () => resolve(events))
    })
    req.on('error', reject)
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('SSE timeout')) })
    req.write(JSON.stringify(body))
    req.end()
  })
}

// ── Test Suite ──

describe('E2E: plan → execute → diff → apply', () => {
  let token, projectId, chatId
  const TARGET_FILE = `e2e-pipeline-${Date.now()}.js`

  before(async () => {
    token = await supabaseAuth()
    const projects = await apiCall('GET', '/api/projects', token)
    assert.ok(Array.isArray(projects) && projects.length > 0, 'should have at least one project')
    projectId = projects[0].id

    const chat = await apiCall('POST', `/api/projects/${projectId}/chats`, token, { title: 'E2E Pipeline Test' })
    assert.ok(chat.id, 'should create a chat')
    chatId = chat.id
  })

  it('execute plan produces diff_file and no errors', async () => {
    const plan = {
      summary: `Create ${TARGET_FILE}`,
      intent: 'build',
      file_actions: [{ action: 'create', path: TARGET_FILE, reason: 'E2E test', description: 'Pipeline test file', intent: 'build', grounded_on: ['NONEXISTENT — new file'] }],
      reasoning: ['E2E pipeline test'],
      constraints_checked: { has_file_actions: true, no_illegal_create: true, minimal_patch: true, grounded_in_file_context: true },
    }

    const events = await sseStream(`/api/chats/${chatId}/messages/stream`, token, {
      content: 'Execute the approved plan',
      metadata: { scope: 'project', executePlan: plan },
    })

    // No error events
    const errors = events.filter(e => e.event === 'error')
    assert.equal(errors.length, 0, `should have no error events, got: ${JSON.stringify(errors)}`)

    // At least one diff_file event
    const diffs = events.filter(e => e.event === 'diff_file')
    assert.ok(diffs.length > 0, 'should emit at least one diff_file event')
    assert.equal(diffs[0].data.path, TARGET_FILE, 'diff_file path should match target')
    assert.equal(diffs[0].data.action, 'create', 'diff_file action should be create')
    assert.ok(diffs[0].data.newContent, 'diff_file should have newContent')

    // Done event with pending diff status
    const done = events.find(e => e.event === 'done')
    assert.ok(done, 'should emit a done event')
    assert.equal(done.data.diffStatus, 'pending', 'diffStatus should be pending')
    assert.ok(done.data.diffFiles?.length > 0, 'done should include diffFiles')
  })

  it('apply returns appliedFiles with the target path', async () => {
    const events = await sseStream(`/api/chats/${chatId}/messages/stream`, token, {
      content: 'apply',
      metadata: { scope: 'project' },
    })

    // No error events
    const errors = events.filter(e => e.event === 'error')
    assert.equal(errors.length, 0, `should have no error events, got: ${JSON.stringify(errors)}`)

    // Done event with appliedFiles
    const done = events.find(e => e.event === 'done')
    assert.ok(done, 'should emit a done event')
    assert.equal(done.data.toolMode, 'apply_pending_diff', 'toolMode should be apply_pending_diff')
    assert.ok(Array.isArray(done.data.appliedFiles), 'appliedFiles should be an array')
    assert.ok(done.data.appliedFiles.includes(TARGET_FILE), `appliedFiles should include ${TARGET_FILE}`)
    assert.equal(done.data.rolledBack, false, 'should not be rolled back')
  })

  it('invalid plan is rejected with no diffs emitted', async () => {
    const invalidPlan = {
      summary: 'Bad plan',
      intent: 'build',
      file_actions: [],
      reasoning: ['empty'],
      constraints_checked: {},
    }

    const events = await sseStream(`/api/chats/${chatId}/messages/stream`, token, {
      content: 'Execute the approved plan',
      metadata: { scope: 'project', executePlan: invalidPlan },
    })

    // No diff_file events
    const diffs = events.filter(e => e.event === 'diff_file')
    assert.equal(diffs.length, 0, 'should not emit any diff_file events')

    // Should have error or plan_validation_failed
    const rejected = events.some(e =>
      e.event === 'error' || e.data?.stage === 'plan_validation_failed'
    )
    assert.ok(rejected, 'should emit error or plan_validation_failed status')
  })
})
