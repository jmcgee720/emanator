/**
 * Stream Handler v2 — Emergent-style agent loop.
 *
 * Wires /lib/ai/agent-core.js to the existing SSE/credit/persistence
 * infrastructure. No modes, no policing, no detectors. The model uses
 * tools when it decides to and emits a text-only response when done.
 *
 * Feature flag: this is a SEPARATE endpoint
 * (POST /api/chats/:chatId/messages/stream-v2). The legacy v1 endpoint
 * remains unchanged. Frontend opts in by hitting this URL.
 *
 * SCOPE (Phase 1):
 *   - Self-edit chats: scoped to /app with sensible excludes (Core System).
 *   - Project chats: NOT YET — returns 501. Migration in Step 4.
 */

import { NextResponse } from 'next/server'
import { runAgent } from '@/lib/ai/agent-core'
import { buildDefaultToolset } from '@/lib/ai/agent-tools-v2'
import { createProvider } from '@/lib/ai/providers/index'
import { SELF_EDIT_PREFIX, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { creditsDb, estimateRequestCost } from '@/lib/credits/service'

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

/** Build a clean, minimal system prompt — NO policing, NO forbidden patterns. */
function buildSelfEditSystemPrompt() {
  return [
    'You are Auroraly\'s self-edit agent ("Core System mode"). You can read, search, edit, and run commands on the Auroraly source tree at /app.',
    '',
    'You have these tools:',
    '  • read_file       — read a file (returns line-numbered content)',
    '  • write_file      — create a new file or completely overwrite an existing one',
    '  • edit_file       — replace exact unique text in an existing file',
    '  • run_command     — run a shell command (find, grep, ls, node, etc.)',
    '  • search_files    — grep across the tree for a pattern',
    '  • list_files      — find files by name pattern',
    '',
    'Use tools whenever you need real information. If you do not know where a file lives, call list_files or run_command with `find`. If you need to see code before changing it, call read_file. Edit using edit_file with unique exact text.',
    '',
    'Respond with text only when you are finished — when there is no further tool call to make. The user is technical and prefers short, concrete answers (specific file paths, line numbers, what you changed and why).',
  ].join('\n')
}

function buildSelfEditScope() {
  return {
    rootDirs: ['/app'],
    excludePaths: [
      '/app/node_modules',
      '/app/.next',
      '/app/.git',
      '/app/.emergent',
      '/app/.vercel',
    ],
    maxFileBytes: 200 * 1024,
    execTimeoutMs: 20_000,
  }
}

/**
 * Build prior messages from the chat history for the agent.
 * Strips assistant tool-call metadata since v2 reconstructs its own.
 */
async function loadPriorMessages(db, chatId, currentUserMessageId) {
  try {
    const rows = await db.messages.listByChat(chatId)
    const prior = (rows || [])
      .filter((m) => m.id !== currentUserMessageId)
      .filter((m) => !m.metadata?.silent)
      .slice(-20) // last 20 turns, keep context manageable
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : String(m.content || ''),
      }))
      .filter((m) => m.content && m.content.length > 0)
    return prior
  } catch (e) {
    console.warn('[StreamV2] loadPriorMessages failed:', e?.message)
    return []
  }
}

/**
 * Main handler. Mirrors v1's auth/credit shell but delegates the actual
 * agent loop to /lib/ai/agent-core.js.
 */
export async function handleStreamMessageV2(request, { chatId, authUser: _authUser, dbUser, db }) {
  const body = await request.json()
  const { content, metadata = {} } = body
  const isSilent = metadata.silent === true

  if (!content) {
    return handleCORS(NextResponse.json({ error: 'Content required' }, { status: 400 }))
  }

  const chat = await db.chats.findById(chatId)
  if (!chat) {
    return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
  }

  // Conversation lock
  if (metadata.projectId && metadata.projectId !== chat.project_id) {
    return handleCORS(NextResponse.json({ error: 'Chat belongs to a different project. Confirm project context.' }, { status: 403 }))
  }

  // Permission gates (mirror v1)
  if (isMonitored(getUserRole(dbUser)) && chat.title?.startsWith(SELF_EDIT_PREFIX)) {
    return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
  }
  const isSelfEdit = chat.title?.startsWith(SELF_EDIT_PREFIX)
  if (isSelfEdit && !hasPermission(getUserRole(dbUser), 'self_edit')) {
    return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
  }

  // Phase 1: v2 only handles self-edit. Project chats stay on v1.
  if (!isSelfEdit) {
    return handleCORS(NextResponse.json({
      error: 'v2 agent is currently self-edit only. Use /messages/stream for project chats.',
      code: 'v2_self_edit_only',
    }, { status: 501 }))
  }

  // Persist the user message before streaming (mirrors v1)
  const userMessage = await db.messages.create({
    chat_id: chatId,
    project_id: chat.project_id,
    role: 'user',
    content: metadata.displayContent || content,
    metadata: { ...metadata, ...(isSilent ? { silent: true, full_content: content } : {}), agent_version: 'v2' },
  })
  await db.chats.update(chatId, { updated_at: new Date().toISOString() })

  // Pick provider + model — default to Claude Sonnet 4.5 for self-edit
  const providerName = metadata.provider || 'anthropic'
  const modelName = metadata.model || (providerName === 'anthropic' ? 'claude-sonnet-4-5-20250929' : 'gpt-4o')
  const apiKey = providerName === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : providerName === 'openai'
      ? process.env.OPENAI_API_KEY
      : (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)

  if (!apiKey) {
    return handleCORS(NextResponse.json({
      error: `No API key configured for provider "${providerName}"`,
    }, { status: 500 }))
  }

  // Credit pre-check
  const estimatedCost = estimateRequestCost(modelName, metadata.visualMode)
  let creditBalance = null
  try {
    creditBalance = await creditsDb.getBalance(dbUser.id)
  } catch (e) {
    console.warn('[StreamV2] balance check failed, proceeding:', e?.message)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: keepalive\ndata: {}\n\n`))
        } catch {
          closed = true
          clearInterval(heartbeat)
        }
      }, 8000)

      const send = (event, data) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const finish = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        try { controller.close() } catch {}
      }

      // Surface user message immediately (mirrors v1 UX)
      if (!isSilent) {
        send('user_message', { id: userMessage.id, content: userMessage.content, created_at: userMessage.created_at })
      }

      // Credit exhaustion: short-circuit
      if (creditBalance && creditBalance.balance < estimatedCost && !isSilent) {
        const upsellContent = `I'd love to help, but you're out of credits. You need at least **${estimatedCost}** credits for this request (current balance: **${creditBalance.balance.toFixed(2)}**).\n\nTap **Buy Credits** to top up and keep building!`
        const upsellMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: upsellContent,
          metadata: { credits_exhausted: true, required: estimatedCost, balance: creditBalance.balance, streamed: true, agent_version: 'v2' },
        })
        send('token', { content: upsellContent })
        send('credits_exhausted', { balance: creditBalance.balance, required: estimatedCost, messageId: upsellMessage.id })
        send('done', { content: upsellContent, messageId: upsellMessage.id, credits_exhausted: true })
        send('message_saved', { id: upsellMessage.id, credits_exhausted: true })
        return finish()
      }

      send('status', { stage: 'agent_starting', detail: 'Starting v2 agent…' })

      // Build provider + tools
      let provider
      try {
        provider = createProvider(providerName, apiKey, modelName, {})
      } catch (e) {
        send('error', { message: 'Provider init failed: ' + (e?.message || 'unknown'), error_type: 'provider_init' })
        return finish()
      }
      const tools = buildDefaultToolset(buildSelfEditScope())
      const priorMessages = await loadPriorMessages(db, chatId, userMessage.id)

      // Stream the agent loop
      let fullContent = ''
      let toolEventCount = 0
      let errored = false
      try {
        for await (const ev of runAgent({
          provider,
          systemPrompt: buildSelfEditSystemPrompt(),
          userMessage: content,
          priorMessages,
          tools,
          maxIterations: 25,
        })) {
          if (closed) break
          if (ev.type === 'text_delta') {
            fullContent += ev.content
            // Emit both the new 'text_delta' event and legacy 'token' so the
            // existing frontend renders without changes.
            send('token', { content: ev.content })
          } else if (ev.type === 'tool_use') {
            toolEventCount++
            send('status', { stage: 'tool_use', detail: `Calling ${ev.name}…` })
            send('tool_use', { name: ev.name, id: ev.id, args: ev.args })
          } else if (ev.type === 'tool_result') {
            send('tool_result', { name: ev.name, id: ev.id, content: ev.content })
          } else if (ev.type === 'done') {
            send('status', { stage: 'complete', detail: 'Done.' })
          } else if (ev.type === 'error') {
            errored = true
            send('error', { message: ev.message, error_type: 'agent_error' })
          }
        }
      } catch (e) {
        errored = true
        send('error', { message: 'Agent loop crashed: ' + (e?.message || 'unknown'), error_type: 'agent_crash' })
      }

      // Persist the assistant message
      try {
        if (!errored || fullContent) {
          const assistantMessage = await db.messages.create({
            chat_id: chatId,
            project_id: chat.project_id,
            role: 'assistant',
            content: fullContent || '(no response)',
            metadata: {
              streamed: true,
              agent_version: 'v2',
              provider: providerName,
              model: modelName,
              toolCalls: toolEventCount,
            },
          })
          send('done', { content: fullContent, messageId: assistantMessage.id })
          send('message_saved', { id: assistantMessage.id, generatedFiles: [] })

          // Deduct credits (fire-and-forget)
          creditsDb.deductCredits(dbUser.id, 'chat_message', { model: modelName }).then((result) => {
            if (!result.error) {
              send('credits_update', { balance: result.balance, cost: result.cost, model: modelName })
            }
          }).catch((e) => console.warn('[StreamV2] credit deduct failed:', e?.message))
        }
      } catch (e) {
        console.error('[StreamV2] persist failed:', e)
        send('error', { message: 'Failed to save assistant message: ' + (e?.message || 'unknown'), error_type: 'persist_failed' })
      }

      finish()
    },
  })

  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
  return handleCORS(response)
}
