import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { AIService } from '@/lib/ai/service'
import { ProviderError, classifyProviderError } from '@/lib/ai/errors'
import { SELF_EDIT_PREFIX, getChatType, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { handleStreamMessage } from '@/lib/api/stream-handler'
import { creditsDb, estimateRequestCost } from '@/lib/credits/service'

export async function handle(route, method, path, request) {
  // Get chats for project
  if (route.match(/^\/projects\/[^/]+\/chats$/) && method === 'GET') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    
    const chats = await db.chats.findByProjectId(projectId)
    const enriched = chats.map(c => ({ ...c, chat_type: getChatType(c) }))
    return handleCORS(NextResponse.json(enriched))
  }

  // Create chat
  if (route.match(/^\/projects\/[^/]+\/chats$/) && method === 'POST') {
    const projectId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    
    const body = await request.json()
    const { title = 'New Chat', is_self_edit = false } = body

    const titleLooksSelfEdit = title.startsWith(SELF_EDIT_PREFIX)
    if (titleLooksSelfEdit || is_self_edit) {
      if (!hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
      }
    }

    let finalTitle = title
    if (is_self_edit && !titleLooksSelfEdit) {
      finalTitle = `${SELF_EDIT_PREFIX}${title}`.trim()
    } else if (titleLooksSelfEdit && !is_self_edit) {
      finalTitle = title.replace(SELF_EDIT_PREFIX, '').trim() || 'New Chat'
    }
    
    let chat
    try {
      chat = await db.chats.create({
        project_id: projectId,
        title: finalTitle
      })
    } catch (dbErr) {
      console.error('[CreateChat] DB error:', dbErr.message, dbErr.code)
      return handleCORS(NextResponse.json({ error: `Failed to create chat: ${dbErr.message}` }, { status: 500 }))
    }

    if (finalTitle.startsWith(SELF_EDIT_PREFIX)) {
      db.changelog.create({
        project_id: projectId,
        chat_id: chat.id,
        user_id: dbUser.id,
        user_task: `Self-edit chat created: ${title}`,
        task_mode: 'self_edit_chat',
        plan_summary: title,
      }).catch(e => console.warn('[changelog] self_edit_chat write failed:', e.message))
    }
    
    return handleCORS(NextResponse.json({ ...chat, chat_type: getChatType(chat) }, { status: 201 }))
  }

  // Get messages for chat
  if (route.match(/^\/chats\/[^/]+\/messages$/) && method === 'GET') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }

    const chat = await db.chats.findById(chatId)
    if (chat?.title?.startsWith(SELF_EDIT_PREFIX)) {
      const dbUser = await checkAllowlist(authUser.email)
      if (!dbUser || !hasPermission(getUserRole(dbUser), 'self_edit')) {
        return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
      }
    }
    
    const messages = await db.messages.findByChatId(chatId)
    const sanitized = messages.map(m => {
      if (m.metadata?.generatedImage?.imageData) {
        return {
          ...m,
          metadata: {
            ...m.metadata,
            generatedImage: { ...m.metadata.generatedImage, imageData: undefined }
          }
        }
      }
      return m
    })
    return handleCORS(NextResponse.json(sanitized))
  }

  // Update message metadata
  if (route.match(/^\/messages\/[^/]+\/metadata$/) && method === 'PATCH') {
    const messageId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    try {
      const body = await request.json()
      const existing = await db.messages.findById(messageId)
      if (!existing) {
        return handleCORS(NextResponse.json({ error: 'Message not found' }, { status: 404 }))
      }
      const updatedMeta = { ...(existing.metadata || {}), ...body }
      await db.messages.update(messageId, { metadata: updatedMeta })
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      console.error('[Messages] Metadata update error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to update metadata' }, { status: 500 }))
    }
  }

  // Streaming message endpoint
  if (route.match(/^\/chats\/[^/]+\/messages\/stream$/) && method === 'POST') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    return handleStreamMessage(request, { chatId, authUser, dbUser, db })
  }

  // Send message (with AI response) — non-streaming fallback
  if (route.match(/^\/chats\/[^/]+\/messages$/) && method === 'POST') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const body = await request.json()
    const { content, role = 'user', metadata = {} } = body
    const isSilent = body.silent === true || metadata?.silent === true
    
    if (!content) {
      return handleCORS(NextResponse.json({ error: 'Content required' }, { status: 400 }))
    }
    
    const chat = await db.chats.findById(chatId)
    if (!chat) {
      return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    if (isMonitored(getUserRole(dbUser)) && chat.title?.startsWith(SELF_EDIT_PREFIX)) {
      return handleCORS(NextResponse.json({ error: 'Monitored accounts cannot use self-edit chats' }, { status: 403 }))
    }

    if (chat.title?.startsWith(SELF_EDIT_PREFIX) && !hasPermission(getUserRole(dbUser), 'self_edit')) {
      return handleCORS(NextResponse.json({ error: 'Self-edit chats are owner-only' }, { status: 403 }))
    }
    
    // Silent messages: skip saving user message to DB (used by auto-follow-up after Apply to Live)
    let userMessage
    if (isSilent) {
      userMessage = { id: `silent-${Date.now()}`, chat_id: chatId, project_id: chat.project_id, role, content, created_at: new Date().toISOString() }
    } else {
      userMessage = await db.messages.create({
        chat_id: chatId,
        project_id: chat.project_id,
        role,
        content,
        metadata
      })
    }
    
    await db.chats.update(chatId, { updated_at: new Date().toISOString() })

    if (role === 'user' && isMonitored(getUserRole(dbUser))) {
      const promptSummary = content.length > 200 ? content.slice(0, 200) + '\u2026' : content
      db.changelog.create({
        project_id: chat.project_id,
        chat_id: chatId,
        user_id: dbUser.id,
        user_task: promptSummary,
        task_mode: 'monitored_prompt',
        plan_summary: `Monitored prompt in chat: ${chat.title || chatId}`,
      }).catch(e => console.warn('[changelog] monitored_prompt write failed:', e.message))
    }
    
    if (role === 'user') {
      try {
        const project = await db.projects.findById(chat.project_id)
        const providerName = metadata.provider || project?.settings?.provider || 'openai'
        const modelName = metadata.model || project?.settings?.model || null

        // Credit pre-check before AI call
        const estimatedCost = estimateRequestCost(modelName)
        try {
          const creditBalance = await creditsDb.getBalance(dbUser.id)
          if (creditBalance.balance < estimatedCost) {
            const insufficientMsg = `I'd love to help, but you're out of credits. You need at least **${estimatedCost}** credits for this request (current balance: **${creditBalance.balance.toFixed(2)}**).\n\nTap **Buy Credits** to top up and keep building!`
            const errMessage = await db.messages.create({
              chat_id: chatId, project_id: chat.project_id, role: 'assistant',
              content: insufficientMsg,
              metadata: { credits_exhausted: true, required: estimatedCost, balance: creditBalance.balance }
            })
            return handleCORS(NextResponse.json({
              userMessage, assistantMessage: errMessage, error: insufficientMsg
            }, { status: 201 }))
          }
        } catch (creditErr) {
          console.warn('[Credits] Balance check failed, proceeding:', creditErr.message)
        }

        const aiService = new AIService(providerName, modelName)
        aiService.approveCreditGate()
        
        const aiResult = await aiService.processMessage({
          projectId: chat.project_id,
          chatId: chatId,
          userMessage: content,
          userId: dbUser.id,
          scope: metadata.scope || undefined
        })
        
        const assistantMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: aiResult.content,
          metadata: {
            toolMode: aiResult.toolMode,
            scope: aiResult.scope,
            intent: aiResult.intent,
            runId: aiResult.runId,
            filesGenerated: aiResult.files?.length || 0,
            provider: aiResult.provider,
            model: aiResult.model,
            canvasUpdated: aiResult.canvasUpdated,
            filesVerified: aiResult.filesVerified,
            fsStats: aiResult.fsStats
          }
        })
        
        // Deduct credits after successful generation
        creditsDb.deductCredits(dbUser.id, 'chat_message').catch(e =>
          console.warn('[Credits] Post-generation deduct failed:', e.message)
        )

        return handleCORS(NextResponse.json({
          userMessage,
          assistantMessage,
          generatedFiles: aiResult.files || [],
          plan: aiResult.plan,
          canvasUpdated: aiResult.canvasUpdated,
          scope: aiResult.scope,
          intent: aiResult.intent
        }, { status: 201 }))
        
      } catch (aiError) {
        console.error('AI generation error:', aiError)
        
        // Classify raw errors into safe ProviderError when possible
        let providerErr = aiError
        if (!(aiError instanceof ProviderError) && aiError.name !== 'ProviderError') {
          providerErr = classifyProviderError(aiError, metadata.provider || 'openai', metadata.model || 'unknown')
        }

        const isProviderError = providerErr instanceof ProviderError || providerErr.name === 'ProviderError'
        
        const userFacingContent = isProviderError
          ? providerErr.user_message
          : `I encountered an error while processing your request. Please try again or rephrase your request.`
        
        const errorMeta = {
          error: true,
          providerError: isProviderError,
          error_type: isProviderError ? providerErr.error_type : 'unknown',
          provider: isProviderError ? providerErr.provider : (metadata.provider || 'unknown'),
          model: isProviderError ? providerErr.model : (metadata.model || 'unknown'),
          provider_status_code: isProviderError ? providerErr.status_code : null,
          user_message: userFacingContent,
        }
        
        const errorMessage = await db.messages.create({
          chat_id: chatId,
          project_id: chat.project_id,
          role: 'assistant',
          content: userFacingContent,
          metadata: errorMeta
        })
        
        return handleCORS(NextResponse.json({
          userMessage,
          assistantMessage: errorMessage,
          providerError: isProviderError ? {
            error_type: providerErr.error_type,
            provider: providerErr.provider,
            model: providerErr.model,
            status_code: providerErr.status_code,
            user_message: userFacingContent,
          } : null,
          error: userFacingContent
        }, { status: 201 }))
      }
    }
    
    return handleCORS(NextResponse.json(userMessage, { status: 201 }))
  }

  // Delete chat
  if (route.match(/^\/chats\/[^/]+$/) && method === 'DELETE') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    await db.chats.delete(chatId)
    
    return handleCORS(NextResponse.json({ success: true }))
  }

  // Rename a chat
  if (route.match(/^\/chats\/[^/]+$/) && method === 'PATCH') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const body = await request.json()
    const title = (body.title || '').trim()
    if (!title) {
      return handleCORS(NextResponse.json({ error: 'Title required' }, { status: 400 }))
    }
    const updated = await db.chats.update(chatId, { title })
    return handleCORS(NextResponse.json({ success: true, chat: updated }))
  }

  // Session forking
  if (route.match(/^\/chats\/[^/]+\/fork$/) && method === 'POST') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json().catch(() => ({}))
      const sourceChat = await db.chats.findById(chatId)
      if (!sourceChat) {
        return handleCORS(NextResponse.json({ error: 'Source chat not found' }, { status: 404 }))
      }

      const messages = await db.messages.findByChatId(chatId)

      // Build context for AI summary: last few user + assistant exchanges
      const recentExchanges = messages.slice(-10)
      const snippets = recentExchanges.map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant'
        const text = (m.content || '').slice(0, 200)
        return `${role}: ${text}`
      }).join('\n')

      // Single AI call for both title and summary
      let forkTitle = body.title
      let summaryText = ''
      try {
        const { createProvider } = await import('@/lib/ai/providers/index')
        const apiKey = process.env.OPENAI_API_KEY || process.env.EMERGENT_LLM_KEY
        const opts = (!process.env.OPENAI_API_KEY && process.env.EMERGENT_LLM_KEY && process.env.EMERGENT_PROXY_URL)
          ? { baseURL: process.env.EMERGENT_PROXY_URL } : {}
        const provider = createProvider('openai', apiKey, 'gpt-4o-mini', opts)
        const result = await provider.chat([
          { role: 'system', content: `You are generating a handoff for a continued conversation. Respond in EXACTLY this format with no extra text:
TITLE: [1-3 word topic summary]
SUMMARY: [2-3 sentence summary of what was built/discussed, what state the project is in, and what the user was working on last]` },
          { role: 'user', content: `Chat name: "${sourceChat.title}"\nTotal messages: ${messages.length}\n\nLast exchanges:\n${snippets}` }
        ], { temperature: 0.3, max_tokens: 150 })

        const output = result.content || ''
        const titleMatch = output.match(/TITLE:\s*(.+)/i)
        const summaryMatch = output.match(/SUMMARY:\s*([\s\S]+)/i)

        if (titleMatch && !forkTitle) {
          forkTitle = titleMatch[1].trim().replace(/['"]/g, '').slice(0, 40)
        }
        if (summaryMatch) {
          summaryText = summaryMatch[1].trim()
        }
      } catch (e) {
        console.warn('[Fork] AI generation failed:', e.message?.slice(0, 100))
      }

      // Fallbacks
      if (!forkTitle) {
        const base = sourceChat.title || 'Chat'
        forkTitle = base.length > 20 ? base.slice(0, 17) + '...' : base + ' (cont.)'
      }
      if (!summaryText) {
        const userMsgs = messages.filter(m => m.role === 'user')
        const lastUserMsg = userMsgs.length > 0 ? (userMsgs[userMsgs.length - 1].content || '').slice(0, 300) : ''
        summaryText = `Continued from "${sourceChat.title}" (${messages.length} messages). Last request: ${lastUserMsg || 'N/A'}`
      }

      let latestMeta = {}
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'assistant' && m.metadata) {
          const { proposedPlan, diffStatus, diffFiles, planData, planId } = m.metadata
          if (proposedPlan || diffFiles || planData) {
            latestMeta = { proposedPlan, diffStatus, diffFiles, planData, planId }
            break
          }
        }
      }

      const forkedChat = await db.chats.create({
        project_id: sourceChat.project_id,
        title: forkTitle
      })

      await db.messages.create({
        chat_id: forkedChat.id,
        project_id: sourceChat.project_id,
        role: 'system',
        content: summaryText,
        metadata: {
          forked_from: chatId,
          original_message_count: messages.length,
          ...latestMeta
        }
      })

      return handleCORS(NextResponse.json({
        id: forkedChat.id,
        title: forkedChat.title,
        project_id: forkedChat.project_id,
        forked_from: chatId,
        original_message_count: messages.length
      }, { status: 201 }))
    } catch (err) {
      console.error('[Fork] Error forking chat:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to fork chat' }, { status: 500 }))
    }
  }

  return null
}
