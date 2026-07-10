import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { AIService } from '@/lib/ai/service'
import { ProviderError, classifyProviderError } from '@/lib/ai/errors'
import { SELF_EDIT_PREFIX, getChatType, getUserRole, hasPermission, isMonitored } from '@/lib/constants'
import { handleStreamMessage } from '@/lib/api/stream-handler'
import { handleStreamMessageV2 } from '@/lib/api/stream-handler-v2'
import { creditsDb, estimateRequestCost } from '@/lib/credits/service'
import { generateForkTitle } from '@/lib/ai/token-counter'
import { extractDocumentText, supportsTextExtraction } from '@/lib/ai/document-extractor'

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
    
    // Check if this is a Core System project
    const project = await db.projects.findById(projectId)
    const isCoreProject = project?.settings?.is_core === true
    
    let chats = await db.chats.findByProjectId(projectId)
    
    // If this is a Core System project, also include orphaned self-edit chats
    // (chats with project_id = null and title starting with SELF_EDIT_PREFIX)
    // This handles legacy chats created before the Core System project existed
    if (isCoreProject && hasPermission(getUserRole(dbUser), 'self_edit')) {
      const orphanedChats = await db.chats.findCoreSystemChats()
      const selfEditOrphans = orphanedChats.filter(c => c.title?.startsWith(SELF_EDIT_PREFIX))
      
      // Migrate orphaned chats to the Core System project
      for (const orphan of selfEditOrphans) {
        try {
          await db.chats.update(orphan.id, { project_id: projectId })
          console.log(`[GetChats] Migrated orphaned Core System chat ${orphan.id} to project ${projectId}`)
        } catch (err) {
          console.error(`[GetChats] Failed to migrate chat ${orphan.id}:`, err.message)
        }
      }
      
      // Reload chats after migration
      chats = await db.chats.findByProjectId(projectId)
    }
    
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
    
    // ── Fork-on-first-open: auto-generate summary ──────────────────────
    // When a forked chat is opened for the first time (parent_chat_id set,
    // zero messages), auto-generate and persist a summary of the parent chat
    // with context, attachments, and metadata for the Proceed button.
    if (chat.parent_chat_id && messages.length === 0) {
      console.log('[GetMessages] Fork detected on first open, generating summary...')
      
      try {
        const { shouldAutoSendForkSummary, generateForkSummary } = await import('@/lib/ai/fork-summary')
        
        if (shouldAutoSendForkSummary(chat, messages)) {
          const parentChat = await db.chats.findById(chat.parent_chat_id)
          if (parentChat) {
            const parentMessages = await db.messages.findByChatId(chat.parent_chat_id)
            const summary = await generateForkSummary({
              chat,
              parentChat,
              parentMessages,
              db,
            })
            
            // Create and persist the fork summary message
            const summaryMessage = await db.messages.create({
              chat_id: chatId,
              project_id: chat.project_id,
              role: 'assistant',
              content: summary.content,
              metadata: summary.metadata,
            })
            
            console.log('[GetMessages] Fork summary created:', summaryMessage.id)
            
            // Return the summary as the first message
            const sanitized = [summaryMessage].map(m => {
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
        }
      } catch (err) {
        console.error('[GetMessages] Fork summary generation failed:', err)
        // Fall through to return empty messages array
      }
    }
    
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

  // v2 streaming endpoint — Emergent-style agent (see /lib/ai/agent-core.js)
  // Currently self-edit only; project chats fall through to v1.
  if (route.match(/^\/chats\/[^/]+\/messages\/stream-v2$/) && method === 'POST') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }
    return handleStreamMessageV2(request, { chatId, authUser, dbUser, db })
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
        const project = chat.project_id ? await db.projects.findById(chat.project_id) : null
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

  // Upload attachments and save to project files
  if (route.match(/^\/chats\/[^/]+\/upload$/) && method === 'POST') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const chat = await db.chats.findById(chatId)
    if (!chat) {
      return handleCORS(NextResponse.json({ error: 'Chat not found' }, { status: 404 }))
    }

    try {
      const body = await request.json()
      const files = body.files || []
      const uploads = []

      // Sanitize filename for safe filesystem paths
      const sanitizeFilename = (name) => {
        const ext = name.split('.').pop()
        const base = name.slice(0, -(ext.length + 1))
        const clean = base
          .toLowerCase()
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/^-+|-+$/g, '')
        return `${clean}.${ext}`
      }

      // Determine smart path based on file type
      const getSmartPath = (filename, mimeType) => {
        const ext = filename.split('.').pop()?.toLowerCase()
        if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp', 'ico'].includes(ext)) {
          return `public/images/${sanitizeFilename(filename)}`
        }
        if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'].includes(ext)) {
          return `public/docs/${sanitizeFilename(filename)}`
        }
        if (['mp3', 'wav', 'ogg'].includes(ext)) {
          return `public/audio/${sanitizeFilename(filename)}`
        }
        if (['zip', 'tar', 'gz'].includes(ext)) {
          return `public/uploads/${sanitizeFilename(filename)}`
        }
        if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
          return `src/components/${sanitizeFilename(filename)}`
        }
        return sanitizeFilename(filename)
      }

      for (const file of files) {
        try {
          const filePath = getSmartPath(file.filename, file.mime_type)
          let content = file.data || file.content || ''
          const ext = file.filename.split('.').pop()?.toLowerCase()
          
          // Categorize file type
          const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp', 'ico']
          const textExts = ['txt', 'md', 'json', 'csv', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sql', 'xml', 'yaml', 'yml', 'rtf']
          const documentExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']
          const archiveExts = ['zip', 'tar', 'gz']
          
          const isImage = imageExts.includes(ext)
          const isText = textExts.includes(ext)
          const isDocument = documentExts.includes(ext)
          const isArchive = archiveExts.includes(ext)
          
          let fileCategory = 'binary'
          if (isImage) fileCategory = 'image'
          else if (isText) fileCategory = 'text'
          else if (isDocument) fileCategory = 'document'
          else if (isArchive) fileCategory = 'archive'
          
          // Extract text from documents (PDF, DOCX, etc.)
          let extractedText = null
          let extractionMetadata = null
          if (isDocument && supportsTextExtraction(file.mime_type, file.filename)) {
            try {
              // Convert base64 data URL to buffer
              const base64Data = content.includes(',') ? content.split(',')[1] : content
              const buffer = Buffer.from(base64Data, 'base64')
              const extraction = await extractDocumentText(buffer, file.mime_type, file.filename)
              extractedText = extraction.text
              extractionMetadata = extraction.metadata
            } catch (extractErr) {
              console.warn('[Upload] Document extraction failed:', file.filename, extractErr.message)
              extractedText = `[Text extraction failed for ${file.filename}]`
            }
          }
          
          // Save to project_files
          await db.projectFiles.upsert(
            chat.project_id,
            filePath,
            content,
            isImage ? 'image' : 'text'
          )

          // ── Full attachment metadata returned to client (2026-05-28 fix) ──
          // Critical: the client merges this object into its
          // `uploadedAttachments` array and sends it as
          // metadata.attachments to the stream handler.
          // attachmentToContentBlock() in stream-handler-v2.js requires
          // file_category / mime_type / type / preview_data to convert
          // images into Anthropic vision content blocks. Prior to this
          // fix the response only had { filename, path, public_url,
          // success } — missing file_category, mime_type, preview_data.
          // attachmentToContentBlock therefore returned null for every
          // upload, NO vision block reached Claude, and the model
          // hallucinated screenshot contents from text context alone.
          // Days of fabrication-bug-hunting traced to this one
          // endpoint's response shape. Including the data URL itself
          // costs no extra bytes (the client already had it locally
          // via FileReader) but guarantees the server-merged object
          // is complete.
          uploads.push({
            filename: file.filename,
            path: filePath,
            public_url: filePath.startsWith('public/') ? `/${filePath.slice(7)}` : null,
            mime_type: file.mime_type || 'application/octet-stream',
            type: file.mime_type || 'application/octet-stream',
            file_category: fileCategory,
            preview_data: isImage ? content : null,
            content: isText ? content : null,
            extracted_text: extractedText,
            extraction_metadata: extractionMetadata,
            success: true,
          })
        } catch (err) {
          console.error(`[Upload] Failed to save ${file.filename}:`, err.message)
          uploads.push({
            filename: file.filename,
            success: false,
            error: err.message,
            error_code: err.code || 'UPLOAD_FAILED',
          })
        }
      }

      return handleCORS(NextResponse.json({ uploads }, { status: 200 }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
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
      console.log('[Fork] Starting fork for chat:', chatId)
      const body = await request.json().catch(() => ({}))
      const sourceChat = await db.chats.findById(chatId)
      if (!sourceChat) {
        console.error('[Fork] Source chat not found:', chatId)
        return handleCORS(NextResponse.json({ error: 'Source chat not found' }, { status: 404 }))
      }

      console.log('[Fork] Source chat found:', sourceChat.title, 'project:', sourceChat.project_id)
      const messages = await db.messages.findByChatId(chatId)
      console.log('[Fork] Loaded', messages.length, 'messages')

      // Generate short, descriptive title using pattern matching
      let forkTitle = body.title || generateForkTitle(messages, sourceChat.title)
      
      // Preserve self-edit mode indicator when forking a Core System chat
      // (fixes gear icon disappearing after fork — the UI checks title prefix)
      const isSelfEditChat = sourceChat.title?.startsWith(SELF_EDIT_PREFIX)
      if (isSelfEditChat && !forkTitle.startsWith(SELF_EDIT_PREFIX)) {
        forkTitle = `${SELF_EDIT_PREFIX}${forkTitle}`.trim()
      }
      
      // Build context for AI summary: last few user + assistant exchanges
      const recentExchanges = messages.slice(-10)
      const snippets = recentExchanges.map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant'
        const text = (m.content || '').slice(0, 200)
        return `${role}: ${text}`
      }).join('\n')

      // AI-generated summary for context (title is already set from pattern matching)
      let summaryText = ''
      try {
        const { createProvider } = await import('@/lib/ai/providers/index')
        const apiKey = process.env.OPENAI_API_KEY
        const provider = createProvider('openai', apiKey, 'gpt-4o-mini', {})
        const result = await provider.chat([
          { role: 'system', content: `You are writing a handoff summary for a continued conversation. Write 2-3 sentences covering: what was built/discussed, current project state, and what the user was working on last. Be concise and specific.` },
          { role: 'user', content: `Chat: "${sourceChat.title}"\nMessages: ${messages.length}\nLast exchanges:\n${snippets}` }
        ], { temperature: 0.3, max_tokens: 120 })

        summaryText = (result.content || '').trim()
      } catch (e) {
        console.warn('[Fork] AI summary failed:', e.message?.slice(0, 100))
      }

      // Fallback summary if AI fails
      if (!summaryText) {
        const userMsgs = messages.filter(m => m.role === 'user')
        const lastUserMsg = userMsgs.length > 0 ? (userMsgs[userMsgs.length - 1].content || '').slice(0, 300) : ''
        summaryText = `Continued from "${sourceChat.title}" (${messages.length} messages). Last request: ${lastUserMsg || 'N/A'}`
      }

      // Ensure summary ends with "shall I keep going?" prompt
      if (!summaryText.toLowerCase().includes('keep going') && !summaryText.toLowerCase().includes('continue')) {
        summaryText += '\n\nShall I keep going?'
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

      console.log('[Fork] Creating forked chat with title:', forkTitle)
      const forkedChat = await db.chats.create({
        project_id: sourceChat.project_id,
        title: forkTitle,
        parent_chat_id: chatId  // Track parent for fork summary generation
      })
      console.log('[Fork] Forked chat created:', forkedChat.id)

      // ── Fork summary now auto-sent on first open (stream-handler-v2.js) ──
      // The forked chat starts empty. When the user opens it, the stream
      // handler detects parent_chat_id + zero messages and auto-sends a
      // summary with attachments + Proceed button. This eliminates the
      // "what was I doing?" tax and makes fork-of-fork lineage tracking work.

      return handleCORS(NextResponse.json({
        id: forkedChat.id,
        title: forkedChat.title,
        project_id: forkedChat.project_id,
        forked_from: chatId,
        original_message_count: messages.length
      }, { status: 201 }))
    } catch (err) {
      console.error('[Fork] Error forking chat:', err)
      console.error('[Fork] Error stack:', err.stack)
      return handleCORS(NextResponse.json({ 
        error: 'Failed to fork chat', 
        details: err.message,
        error_name: err.name,
        error_code: err.code,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
      }, { status: 500 }))
    }
  }

  return null
}
