// ── notify-preview helper tests ──
// Verifies that the Fly preview-runner notifier degrades gracefully in
// all the conditions it encounters in production: missing config, no
// running machine, machine in wrong state, HTTP errors, timeouts. The
// contract is "never throw, always return a status object" — the chat
// stream must not block or crash on preview infra hiccups.

import { test, describe, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { notifyPreviewOfFileChange } from '../lib/fly/notify-preview.js'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  // Default to Fly being configured. Individual tests override.
  process.env.FLY_API_TOKEN = 'test-token'
  process.env.FLY_PREVIEW_APP_NAME = 'auroraly-preview-runner'
  process.env.FLY_REGION = 'iad'
  process.env.RUNNER_SECRET_SEED = 'test-seed'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = ORIGINAL_FETCH
})

describe('notifyPreviewOfFileChange — graceful degradation', () => {
  test('returns no-project-id when projectId is missing', async () => {
    const r = await notifyPreviewOfFileChange(null)
    assert.equal(r.notified, false)
    assert.equal(r.reason, 'no-project-id')
  })

  test('returns fly-not-configured when FLY_API_TOKEN missing', async () => {
    delete process.env.FLY_API_TOKEN
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, false)
    assert.equal(r.reason, 'fly-not-configured')
  })

  test('returns fly-not-configured when FLY_PREVIEW_APP_NAME missing', async () => {
    delete process.env.FLY_PREVIEW_APP_NAME
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, false)
    assert.equal(r.reason, 'fly-not-configured')
  })

  test('returns no-machine when project has not been previewed yet', async () => {
    // First fetch = listMachines() → []
    global.fetch = async () => new Response('[]', { status: 200 })
    const r = await notifyPreviewOfFileChange('p-never-previewed')
    assert.equal(r.notified, false)
    assert.equal(r.reason, 'no-machine')
  })

  test('returns machine-<state> when machine exists but is not started', async () => {
    const fakeMachine = {
      id: 'mc1',
      state: 'stopped',
      config: { metadata: { auroraly_project_id: 'p1' } },
    }
    global.fetch = async () => new Response(JSON.stringify([fakeMachine]), { status: 200 })
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, false)
    assert.equal(r.reason, 'machine-stopped')
    assert.equal(r.machineId, 'mc1')
  })

  test('returns notified=true when machine is started and runner responds OK', async () => {
    const fakeMachine = {
      id: 'mc1',
      state: 'started',
      config: { metadata: { auroraly_project_id: 'p1' } },
    }
    let calls = 0
    const seenUrls = []
    global.fetch = async (url, init) => {
      calls++
      seenUrls.push(String(url))
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      // Runner /sync-from-supabase
      assert.equal(init?.method, 'POST')
      assert.match(String(url), /\/sync-from-supabase$/)
      const headers = init?.headers || {}
      assert.ok(headers['X-Auroraly-Secret'])
      return new Response('{}', { status: 200 })
    }
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, true)
    assert.equal(r.machineId, 'mc1')
    assert.equal(calls, 2)
  })

  test('returns runner-<status> when runner returns non-2xx', async () => {
    const fakeMachine = {
      id: 'mc1',
      state: 'started',
      config: { metadata: { auroraly_project_id: 'p1' } },
    }
    let calls = 0
    global.fetch = async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      return new Response('runner is down', { status: 503 })
    }
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, false)
    assert.match(r.reason, /runner-503/)
    assert.equal(r.machineId, 'mc1')
  })

  test('returns fetch-failed when listMachines throws', async () => {
    global.fetch = async () => { throw new Error('econnreset') }
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, false)
    assert.match(r.reason, /machine-lookup-failed/)
  })

  test('never throws — wraps every error path', async () => {
    // Pathological fetch that throws inside the runner call (not the list call)
    const fakeMachine = {
      id: 'mc1',
      state: 'started',
      config: { metadata: { auroraly_project_id: 'p1' } },
    }
    let calls = 0
    global.fetch = async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      throw new Error('socket hang up')
    }
    const r = await notifyPreviewOfFileChange('p1')
    assert.equal(r.notified, false)
    assert.match(r.reason, /fetch-failed/)
    assert.equal(r.machineId, 'mc1')
  })

  test('flags requiresRestart when package.json is among changed paths', async () => {
    const fakeMachine = {
      id: 'mc1',
      state: 'started',
      config: { metadata: { auroraly_project_id: 'p1' } },
    }
    let calls = 0
    global.fetch = async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      return new Response('{}', { status: 200 })
    }
    const r = await notifyPreviewOfFileChange('p1', { changedPaths: ['package.json'] })
    assert.equal(r.notified, true)
    assert.equal(r.requiresRestart, true)
  })

  test('flags requiresRestart even for nested package.json (workspaces)', async () => {
    const fakeMachine = { id: 'mc1', state: 'started', config: { metadata: { auroraly_project_id: 'p1' } } }
    let calls = 0
    global.fetch = async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      return new Response('{}', { status: 200 })
    }
    const r = await notifyPreviewOfFileChange('p1', { changedPaths: ['apps/web/package.json'] })
    assert.equal(r.requiresRestart, true)
  })

  test('does NOT flag requiresRestart for ordinary code changes', async () => {
    const fakeMachine = { id: 'mc1', state: 'started', config: { metadata: { auroraly_project_id: 'p1' } } }
    let calls = 0
    global.fetch = async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      return new Response('{}', { status: 200 })
    }
    const r = await notifyPreviewOfFileChange('p1', { changedPaths: ['app/page.jsx', 'lib/foo.ts'] })
    assert.equal(r.requiresRestart, false)
  })

  test('does NOT flag requiresRestart for a substring match like package.json.bak', async () => {
    const fakeMachine = { id: 'mc1', state: 'started', config: { metadata: { auroraly_project_id: 'p1' } } }
    let calls = 0
    global.fetch = async () => {
      calls++
      if (calls === 1) return new Response(JSON.stringify([fakeMachine]), { status: 200 })
      return new Response('{}', { status: 200 })
    }
    const r = await notifyPreviewOfFileChange('p1', { changedPaths: ['package.json.bak'] })
    assert.equal(r.requiresRestart, false)
  })

  test('requiresRestart is surfaced even when sync itself fails (no machine)', async () => {
    global.fetch = async () => new Response('[]', { status: 200 })
    const r = await notifyPreviewOfFileChange('p1', { changedPaths: ['package.json'] })
    assert.equal(r.notified, false)
    assert.equal(r.reason, 'no-machine')
    // Caller still needs to know about the dep change to show the user
    // a Stop→Start hint when they eventually open the preview.
    assert.equal(r.requiresRestart, true)
  })
})
