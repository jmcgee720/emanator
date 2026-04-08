/**
 * Stream Handler — SSE streaming message endpoint.
 * Extracted from the catch-all route handler for maintainability.
 */
import { NextResponse } from 'next/server'
import { AIService } from '@/lib/ai/service'
import { ProviderError, classifyProviderError } from '@/lib/ai/errors'
import { SELF_EDIT_PREFIX, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { creditsDb, estimateRequestCost } from '@/lib/credits/service'

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

/**
 * Handle a streaming message request.
 * @param {Request} request
 * @param {{ chatId: string, authUser: object, dbUser: object, db: object }} ctx
 */
export async function handleStreamMessage(request, { chatId, authUser, dbUser, db }) {
  const body = await request.json()
  const { content, metadata = {} } = body
  if (!content) {
    return handleCORS(NextResponse.json({ error: 'Content required' }, { status: 400 }))
  }

  const chat = await db.chats.findById(chatId)
  if (!chat) {
    return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
  }

  // Conversation Lock: reject if request explicitly targets a different project
  if (metadata.projectId && metadata.projectId !== chat.project_id) {
    return handleCORS(NextResponse.json({ error: 'Chat belongs to a different project. Confirm project context.' }, { status: 403 }))
  }

  // Block child_monitored from self-edit chats
  if (isMonitored(getUserRole(dbUser)) && chat.title?.startsWith(SELF_EDIT_PREFIX)) {
    return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
  }

  // Core System Boundary: only owner can stream in self-edit chats
  if (chat.title?.startsWith(SELF_EDIT_PREFIX) && !hasPermission(getUserRole(dbUser), 'self_edit')) {
    return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
  }

  // Save user message immediately
  const userMessage = await db.messages.create({
    chat_id: chatId,
    project_id: chat.project_id,
    role: 'user',
    content,
    metadata
  })
  await db.chats.update(chatId, { updated_at: new Date().toISOString() })

  // Capture monitored-user prompt for review
  if (isMonitored(getUserRole(dbUser))) {
    const promptSummary = content.length > 200 ? content.slice(0, 200) + '…' : content
    db.changelog.create({
      project_id: chat.project_id,
      chat_id: chatId,
      user_id: dbUser.id,
      user_task: promptSummary,
      task_mode: 'monitored_prompt',
      plan_summary: `Monitored prompt in chat: ${chat.title || chatId}`,
    }).catch(e => console.warn('[changelog] monitored_prompt write failed:', e.message))
  }

  const providerName = metadata.provider || 'openai'
  const modelName = metadata.model || null
  const aiService = new AIService(providerName, modelName)

  // Create SSE stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      // ── SSE Heartbeat: prevents proxy/ingress from closing idle connections ──
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          closed = true
          clearInterval(heartbeat)
        }
      }, 10000) // every 10 seconds

      const send = (event, data) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      // Send the saved user message first
      send('user_message', { id: userMessage.id, content: userMessage.content, created_at: userMessage.created_at })

      // ── Credit pre-check ──
      const resolvedModel = aiService.modelName
      const estimatedCost = estimateRequestCost(resolvedModel, metadata.visualMode)
      let creditBalance = null
      try {
        creditBalance = await creditsDb.getBalance(dbUser.id)
      } catch (e) {
        console.warn('[Credits] Balance check failed, proceeding anyway:', e.message)
      }

      if (creditBalance && creditBalance.balance < estimatedCost) {
        // Inject conversational upsell — no provider call, no hard error
        const upsellContent = `I'd love to help, but you're out of credits. You need at least **${estimatedCost}** credits for this request (current balance: **${creditBalance.balance.toFixed(2)}**).\n\nTap **Buy Credits** to top up and keep building!`
        const upsellMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: upsellContent,
          metadata: { credits_exhausted: true, required: estimatedCost, balance: creditBalance.balance, streamed: true }
        })
        send('token', { content: upsellContent })
        send('credits_exhausted', { balance: creditBalance.balance, required: estimatedCost, messageId: upsellMessage.id })
        send('done', { content: upsellContent, messageId: upsellMessage.id, credits_exhausted: true })
        send('message_saved', { id: upsellMessage.id, credits_exhausted: true })
        if (!closed) controller.close()
        return
      }

      // Credit gate approved — unlock provider calls
      aiService.approveCreditGate()

      let fullContent = ''
      let streamMeta = {}
      let receivedError = false
      let usedFallback = false
      let fallbackInfo = null
      let lastErrorData = null

      try {
        const generator = aiService.processMessageStream({
          projectId: chat.project_id,
          chatId,
          userMessage: content,
          userId: dbUser.id,
          scope: metadata.scope || undefined,
          designPrefs: metadata.designPrefs || undefined,
          executePlan: metadata.executePlan || undefined,
          attachments: metadata.attachments || undefined,
          selfEditTarget: metadata.selfEditTarget || undefined,
          visualMode: metadata.visualMode || undefined
        })

        for await (const evt of generator) {
          if (closed) break
          // Intercept internal fallback signal
          if (evt.event === '_fallback_used') {
            usedFallback = true
            fallbackInfo = evt.data
            continue
          }
          send(evt.event, evt.data)
          if (evt.event === 'token') fullContent += evt.data?.content || ''
          if (evt.event === 'done') streamMeta = evt.data
          if (evt.event === 'error') {
            receivedError = true
            lastErrorData = evt.data // Capture the classified error details
          }
        }

        // Notify frontend if fallback was used
        if (usedFallback && fallbackInfo) {
          send('fallback_notice', { model: fallbackInfo.model, provider: fallbackInfo.provider })
        }

        // If generator ended without done or error, send a safety error
        if (!streamMeta.content && !streamMeta.toolMode && !receivedError && !fullContent && !closed) {
          console.warn('[StreamAPI] Generator ended without done/error event — sending safety error')
          send('error', { message: 'Stream ended unexpectedly. Please try again.', error_type: 'stream_incomplete' })
          receivedError = true
        }

        // If an error event was received with no content, save error message with full details
        if (receivedError && !fullContent) {
          const errType = lastErrorData?.error_type || 'unknown'
          const errMsg = lastErrorData?.message || 'An error occurred while generating the response. Please try again.'
          const limitSrc = errType === 'proxy_budget' ? 'universal_key_spending_cap'
            : errType === 'billing' ? 'platform_credits' : null
          const errorMessage = await db.messages.create({
            chat_id: chatId,
            project_id: chat.project_id,
            role: 'assistant',
            content: errMsg,
            metadata: {
              error: true,
              providerError: !!lastErrorData?.error_type,
              error_type: errType,
              limit_source: limitSrc,
              streamed: true,
              provider: lastErrorData?.provider || providerName,
              model: lastErrorData?.model || modelName
            }
          })
          send('message_saved', { id: errorMessage.id, error: true })
        } else {

        // Persist the completed assistant message
        const msgMetadata = {
          toolMode: streamMeta.toolMode,
          scope: streamMeta.scope,
          intent: streamMeta.intent,
          runId: streamMeta.runId,
          filesGenerated: streamMeta.files?.length || 0,
          provider: streamMeta.provider,
          model: streamMeta.model,
          canvasUpdated: streamMeta.canvasUpdated,
          fsStats: streamMeta.fsStats,
          streamed: true
        }

        // Store plan data in message metadata if a plan was proposed
        if (streamMeta.proposedPlan) {
          msgMetadata.proposedPlan = streamMeta.proposedPlan
          msgMetadata.planStatus = 'proposed'
          msgMetadata.planId = streamMeta.planId || null
        }
        if (streamMeta.planExecuted) {
          msgMetadata.planExecuted = true
        }
        if (streamMeta.diffFiles?.length > 0) {
          msgMetadata.diffFiles = streamMeta.diffFiles
          msgMetadata.diffStatus = 'pending'
          msgMetadata.diffId = streamMeta.diffId || null
          msgMetadata.planData = streamMeta.planData || null
          msgMetadata.planId = streamMeta.planId || msgMetadata.planId || null
        }
        if (streamMeta.generatedImage) {
          msgMetadata.generatedImage = streamMeta.generatedImage
        }

        const assistantMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: streamMeta.content || fullContent,
          metadata: msgMetadata
        })

        console.log('[StreamHandler] message_saved — generatedFiles:', (streamMeta.files || []).length, 'proposedPlan:', !!streamMeta.proposedPlan, 'directEditMode:', streamMeta.directEditMode)
        send('message_saved', {
          id: assistantMessage.id,
          generatedFiles: streamMeta.files || [],
          canvasUpdated: streamMeta.canvasUpdated,
          scope: streamMeta.scope,
          intent: streamMeta.intent,
          tool_mode: streamMeta.toolMode || null,
          proposedPlan: streamMeta.proposedPlan || null,
          planExecuted: streamMeta.planExecuted || false,
          diffFiles: streamMeta.diffFiles || null,
          diffStatus: streamMeta.diffFiles?.length > 0 ? 'pending' : null,
          planData: streamMeta.planData || null,
          directEditMode: streamMeta.directEditMode || false,
        })

        // ── Deduct credits after successful generation ──
        const finalModel = usedFallback ? fallbackInfo?.model : aiService.modelName
        const actualCost = estimateRequestCost(finalModel || resolvedModel)
        creditsDb.deductCredits(dbUser.id, 'chat_message').then(result => {
          if (!result.error) {
            send('credits_update', { balance: result.balance, cost: actualCost, model: finalModel })
          }
        }).catch(e => console.warn('[Credits] Post-generation deduct failed:', e.message))

        // Log discard events for rejected-pattern learning (fire-and-forget)
        if (streamMeta.toolMode === 'discard_pending_diff') {
          const discardedPaths = (streamMeta.diffFiles || []).map(d => d.path || d)
          import('@/lib/self_builder/change_log').then(({ logChange }) => {
            logChange({
              projectId: chat.project_id,
              chatId,
              userId: dbUser.id,
              userTask: content || '',
              taskMode: 'discard',
              result: 'discarded',
              filePaths: discardedPaths,
              fileActions: discardedPaths.map(p => ({ path: p, action: 'none' })),
              chatType: chat?.title?.startsWith(SELF_EDIT_PREFIX) ? 'self_edit' : 'builder',
            })
          }).catch(e => console.warn('[changelog] discard logChange failed:', e.message))
        }

        // Log apply events from streaming apply_pending_diff (fire-and-forget)
        if (streamMeta.toolMode === 'apply_pending_diff') {
          const appliedPaths = streamMeta.appliedFiles || streamMeta.written || []
          const deletedPaths = streamMeta.deletedFiles || streamMeta.deleted || []
          import('@/lib/self_builder/change_log').then(({ logChange }) => {
            logChange({
              projectId: chat.project_id,
              chatId,
              userId: dbUser.id,
              userTask: streamMeta.planData?.summary || content || '',
              taskMode: 'apply',
              result: streamMeta.rolledBack ? 'rolled_back' : 'applied',
              filePaths: [...appliedPaths, ...deletedPaths],
              fileActions: [
                ...appliedPaths.map(p => ({ path: p, action: 'write' })),
                ...deletedPaths.map(p => ({ path: p, action: 'delete' })),
              ],
              chatType: chat?.title?.startsWith(SELF_EDIT_PREFIX) ? 'self_edit' : 'builder',
            })
          }).catch(e => console.warn('[changelog] apply logChange failed:', e.message))
        }

        } // end else (non-error path)

      } catch (err) {
        console.error('[StreamAPI] Error:', err)
        // Classify raw SDK errors into safe ProviderError
        let classifiedErr = err
        if (!(err instanceof ProviderError) && err.name !== 'ProviderError') {
          classifiedErr = classifyProviderError(err, providerName, modelName)
        }
        const isProviderError = classifiedErr instanceof ProviderError || classifiedErr.name === 'ProviderError'

        // Build user-facing message that names the exact limit source
        let userFacing = isProviderError ? classifiedErr.user_message : 'An error occurred while generating the response.'
        const errorType = isProviderError ? classifiedErr.error_type : 'unknown'
        let limitSource = null
        if (errorType === 'proxy_budget') {
          limitSource = 'universal_key_spending_cap'
        } else if (errorType === 'billing') {
          limitSource = 'platform_credits'
        }

        // Save error as assistant message with partial content
        const errorContent = fullContent
          ? fullContent + '\n\n---\n*[Stream interrupted: ' + userFacing + ']*'
          : userFacing

        const errorMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: errorContent,
          metadata: {
            error: true,
            providerError: isProviderError,
            error_type: errorType,
            limit_source: limitSource,
            provider: isProviderError ? classifiedErr.provider : providerName,
            model: isProviderError ? classifiedErr.model : modelName,
            partial: fullContent.length > 0,
            streamed: true
          }
        })

        send('error', {
          message: userFacing,
          messageId: errorMessage.id,
          partial: fullContent.length > 0,
          error_type: errorType,
          limit_source: limitSource,
          provider: isProviderError ? classifiedErr.provider : providerName,
        })
      }

      clearInterval(heartbeat)
      if (!closed) controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*',
      'Access-Control-Allow-Credentials': 'true',
    }
  })
}
