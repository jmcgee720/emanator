import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { AIService } from '@/lib/ai/service'
import { ProviderError } from '@/lib/ai/errors'
import { SELF_EDIT_PREFIX, getChatType, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { handleStreamMessage } from '@/lib/api/stream-handler'

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
    
    const chat = await db.chats.create({
      project_id: projectId,
      title: finalTitle
    })

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
    
    const userMessage = await db.messages.create({
      chat_id: chatId,
      project_id: chat.project_id,
      role,
      content,
      metadata
    })
    
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

        const aiService = new AIService(providerName, modelName)
        
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
        
        const isProviderError = aiError instanceof ProviderError || aiError.name === 'ProviderError'
        
        const userFacingContent = isProviderError
          ? aiError.user_message
          : `I encountered an error while processing your request. Please try again or rephrase your request.`
        
        const errorMeta = {
          error: true,
          providerError: isProviderError,
          error_type: isProviderError ? aiError.error_type : 'unknown',
          provider: isProviderError ? aiError.provider : (metadata.provider || 'unknown'),
          model: isProviderError ? aiError.model : (metadata.model || 'unknown'),
          provider_status_code: isProviderError ? aiError.status_code : null,
          raw_error: isProviderError ? aiError.raw_error : aiError.message,
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
            error_type: aiError.error_type,
            provider: aiError.provider,
            model: aiError.model,
            status_code: aiError.status_code,
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
      const sourceChat = await db.chats.findById(chatId)
      if (!sourceChat) {
        return handleCORS(NextResponse.json({ error: 'Source chat not found' }, { status: 404 }))
      }

      const messages = await db.messages.findByChatId(chatId)

      const aiService = new AIService()
      const compressed = aiService.compressContext(messages)
      const summaryText = compressed.length > 0 && compressed[0].role === 'system'
        ? compressed[0].content
        : `[Forked from chat "${sourceChat.title}" with ${messages.length} messages]`

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
        title: `Fork of: ${sourceChat.title}`
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
