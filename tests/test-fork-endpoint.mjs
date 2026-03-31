/**
 * Test: POST /api/chats/:id/fork
 * 
 * 1. Sign in as owner
 * 2. Create a project
 * 3. Create a chat in that project
 * 4. Add several messages (simulating a conversation)
 * 5. Fork the chat
 * 6. Verify the forked chat has the correct title, a single synthetic message, and correct metadata
 * 7. Cleanup
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://cawmmqakaxbznbelcrwd.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_THdjUbHRES-r3CcQzzJh1A_CeSg-f22'
const API_BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://pipeline-secure.preview.emergentagent.com'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function apiFetch(path, opts = {}) {
  const url = `${API_BASE}/api${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

let token = null
let projectId = null
let chatId = null
let forkedChatId = null

async function run() {
  console.log('=== Fork Endpoint Test ===\n')

  // 1. Sign in
  console.log('1. Signing in as owner...')
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'REDACTED_LEAKED_USER',
    password: 'REDACTED_LEAKED_PASSWORD',
  })
  if (authError) {
    console.error('  FAIL: Auth error:', authError.message)
    process.exit(1)
  }
  token = authData.session.access_token
  console.log('  OK: Signed in, got token')

  // 2. Create a test project
  console.log('\n2. Creating test project...')
  const projRes = await apiFetch('/projects', {
    method: 'POST',
    token,
    body: { name: 'Fork Test Project', description: 'Testing session forking' },
  })
  if (projRes.status !== 201 && projRes.status !== 200) {
    console.error('  FAIL: Could not create project:', projRes.status, projRes.data)
    process.exit(1)
  }
  projectId = projRes.data.project?.id || projRes.data.id
  console.log('  OK: Project created:', projectId)

  // 3. Create a chat
  console.log('\n3. Creating chat...')
  const chatRes = await apiFetch(`/projects/${projectId}/chats`, {
    method: 'POST',
    token,
    body: { title: 'Original Test Chat' },
  })
  if (chatRes.status !== 201 && chatRes.status !== 200) {
    console.error('  FAIL: Could not create chat:', chatRes.status, chatRes.data)
    await cleanup()
    process.exit(1)
  }
  chatId = chatRes.data.id
  console.log('  OK: Chat created:', chatId)

  // 4. Add messages (simulate a conversation with >20 messages to trigger compression)
  console.log('\n4. Adding messages to simulate conversation...')
  const messageCount = 25
  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    const metadata = role === 'assistant' && i === messageCount - 2
      ? {
          proposedPlan: { summary: 'Add a login page', file_actions: [{ action: 'create', path: '/src/Login.jsx' }] },
          diffStatus: 'pending',
          diffFiles: [{ path: '/src/Login.jsx', action: 'create' }],
          planData: { summary: 'Add a login page', next_steps: ['Add auth middleware'] },
          planId: 'test-plan-123',
        }
      : {}
    const msgRes = await apiFetch(`/chats/${chatId}/messages`, {
      method: 'POST',
      token,
      body: {
        content: `Test message ${i + 1} from ${role}`,
        role,
        metadata,
      },
    })
    if (msgRes.status !== 201 && msgRes.status !== 200) {
      console.error(`  FAIL: Could not create message ${i + 1}:`, msgRes.status, msgRes.data)
      await cleanup()
      process.exit(1)
    }
  }
  console.log(`  OK: Added ${messageCount} messages`)

  // 5. Fork the chat
  console.log('\n5. Forking the chat...')
  const forkRes = await apiFetch(`/chats/${chatId}/fork`, {
    method: 'POST',
    token,
  })
  if (forkRes.status !== 201) {
    console.error('  FAIL: Fork failed:', forkRes.status, forkRes.data)
    await cleanup()
    process.exit(1)
  }
  forkedChatId = forkRes.data.id
  console.log('  OK: Forked chat created:', forkedChatId)
  console.log('  Response:', JSON.stringify(forkRes.data, null, 2))

  // 6. Verify the forked chat
  console.log('\n6. Verifying forked chat...')

  // 6a. Check title
  const expectedTitle = 'Fork of: Original Test Chat'
  if (forkRes.data.title !== expectedTitle) {
    console.error(`  FAIL: Title mismatch. Expected "${expectedTitle}", got "${forkRes.data.title}"`)
  } else {
    console.log('  OK: Title matches')
  }

  // 6b. Check forked_from
  if (forkRes.data.forked_from !== chatId) {
    console.error(`  FAIL: forked_from mismatch. Expected "${chatId}", got "${forkRes.data.forked_from}"`)
  } else {
    console.log('  OK: forked_from matches')
  }

  // 6c. Check original_message_count
  if (forkRes.data.original_message_count !== messageCount) {
    console.error(`  FAIL: original_message_count mismatch. Expected ${messageCount}, got ${forkRes.data.original_message_count}`)
  } else {
    console.log('  OK: original_message_count matches')
  }

  // 6d. Verify the forked chat has exactly one message (the synthetic summary)
  console.log('\n7. Checking forked chat messages...')
  const msgsRes = await apiFetch(`/chats/${forkedChatId}/messages`, { token })
  if (msgsRes.status !== 200) {
    console.error('  FAIL: Could not get forked chat messages:', msgsRes.status, msgsRes.data)
  } else {
    const msgs = msgsRes.data
    if (msgs.length !== 1) {
      console.error(`  FAIL: Expected 1 message in forked chat, got ${msgs.length}`)
    } else {
      console.log('  OK: Forked chat has exactly 1 synthetic message')
      const syntheticMsg = msgs[0]
      
      // Check it's a system role
      if (syntheticMsg.role !== 'system') {
        console.error(`  FAIL: Expected role "system", got "${syntheticMsg.role}"`)
      } else {
        console.log('  OK: Message role is "system"')
      }
      
      // Check content has summary text
      if (!syntheticMsg.content.includes('Previous conversation summary') && !syntheticMsg.content.includes('Forked from')) {
        console.error('  FAIL: Summary content missing expected text')
        console.log('  Content:', syntheticMsg.content)
      } else {
        console.log('  OK: Summary content present')
        console.log('  Content:', syntheticMsg.content.slice(0, 200))
      }

      // Check metadata
      const meta = syntheticMsg.metadata || {}
      if (meta.forked_from !== chatId) {
        console.error(`  FAIL: metadata.forked_from mismatch`)
      } else {
        console.log('  OK: metadata.forked_from correct')
      }
      
      if (meta.original_message_count !== messageCount) {
        console.error(`  FAIL: metadata.original_message_count mismatch`)
      } else {
        console.log('  OK: metadata.original_message_count correct')
      }

      // Check latest plan/diff metadata was carried over
      if (meta.proposedPlan?.summary === 'Add a login page') {
        console.log('  OK: proposedPlan metadata carried over')
      } else {
        console.error('  FAIL: proposedPlan metadata missing or wrong:', JSON.stringify(meta.proposedPlan))
      }

      if (meta.diffStatus === 'pending') {
        console.log('  OK: diffStatus metadata carried over')
      } else {
        console.error('  FAIL: diffStatus metadata missing:', meta.diffStatus)
      }

      if (meta.planId === 'test-plan-123') {
        console.log('  OK: planId metadata carried over')
      } else {
        console.error('  FAIL: planId metadata missing:', meta.planId)
      }
    }
  }

  // 8. Fork a chat with fewer messages (no compression needed)
  console.log('\n8. Testing fork with small chat (no compression)...')
  const smallChatRes = await apiFetch(`/projects/${projectId}/chats`, {
    method: 'POST',
    token,
    body: { title: 'Small Chat' },
  })
  const smallChatId = smallChatRes.data.id
  
  // Add just 3 messages
  for (let i = 0; i < 3; i++) {
    await apiFetch(`/chats/${smallChatId}/messages`, {
      method: 'POST',
      token,
      body: { content: `Small msg ${i}`, role: i % 2 === 0 ? 'user' : 'assistant' },
    })
  }
  
  const smallForkRes = await apiFetch(`/chats/${smallChatId}/fork`, { method: 'POST', token })
  if (smallForkRes.status === 201) {
    console.log('  OK: Small chat forked successfully')
    // Cleanup
    await apiFetch(`/chats/${smallForkRes.data.id}`, { method: 'DELETE', token })
  } else {
    console.error('  FAIL: Small chat fork failed:', smallForkRes.status, smallForkRes.data)
  }
  await apiFetch(`/chats/${smallChatId}`, { method: 'DELETE', token })

  // 9. Test error cases
  console.log('\n9. Testing error cases...')
  
  // 9a. Fork non-existent chat
  const badForkRes = await apiFetch('/chats/00000000-0000-0000-0000-000000000000/fork', {
    method: 'POST',
    token,
  })
  if (badForkRes.status === 404) {
    console.log('  OK: Non-existent chat returns 404')
  } else {
    console.error('  FAIL: Expected 404 for non-existent chat, got:', badForkRes.status)
  }

  // 9b. Fork without auth
  const noAuthRes = await apiFetch(`/chats/${chatId}/fork`, { method: 'POST' })
  if (noAuthRes.status === 401) {
    console.log('  OK: No auth returns 401')
  } else {
    console.error('  FAIL: Expected 401 for no auth, got:', noAuthRes.status)
  }

  await cleanup()
  console.log('\n=== All Fork Tests Complete ===')
}

async function cleanup() {
  console.log('\nCleaning up...')
  try {
    if (forkedChatId) await apiFetch(`/chats/${forkedChatId}`, { method: 'DELETE', token })
    if (chatId) await apiFetch(`/chats/${chatId}`, { method: 'DELETE', token })
    if (projectId) await apiFetch(`/projects/${projectId}`, { method: 'DELETE', token })
    console.log('  Cleanup done.')
  } catch (e) {
    console.error('  Cleanup error:', e.message)
  }
}

run().catch(err => {
  console.error('Fatal error:', err)
  cleanup().then(() => process.exit(1))
})
