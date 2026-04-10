// ── Message Processor (Non-Streaming) ──
import { buildProjectGroundingBlock } from './service.js'
// Extracted from service.js for modularity. Called via .call(this) from AIService.
import { formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS } from './tools.js'
import { classifyIntent, getIntentWorkflow } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache } from './filesystem.js'
import { formatDesignContextBlock } from './design-system.js'
import { inspectToolCalls, detectFileType, tryParseFilesFromResponse } from './tool-executor.js'
import { buildFilesSummaryText, buildErrorLogData } from './post-process.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'


export async function processMessageImpl({ projectId, chatId, userMessage, userId, scope: requestedScope }) {
    const startTime = Date.now()
    const runId = uuidv4()

    try {
      // 1. Classify intent
      const intent = classifyIntent(userMessage)
      const workflow = getIntentWorkflow(intent)

      // 2. Resolve scope (explicit > intent-driven > auto-classification)
      const autoScope = classifyScope(userMessage)
      let effectiveScope = requestedScope || autoScope
      if (!requestedScope && workflow.preferPlatformScope) {
        effectiveScope = 'platform'
      }

      // 3. Load context based on scope
      const context = await this.loadScopedContext(projectId, chatId, userId, effectiveScope)

      // 4. Build filesystem context (for project scope only)
      let fsContext = null
      if (effectiveScope === 'project' && projectId) {
        try {
          fsContext = await buildFilesystemContext(projectId, intent, userMessage)
        } catch (fsErr) {
          console.error('[AIService] Filesystem context error:', fsErr.message)
        }
      }

      // 5. Determine tool mode from workflow
      const toolMode = effectiveScope !== 'project'
        ? 'chat_only'
        : workflow.toolMode

      // 6. Build system message with intent addendum
      let systemMessage = formatContextAsSystemMessage(
        context,
        context.project?.type || 'app',
        effectiveScope
      )

      const intentAddendum = getIntentSystemAddendum(intent, workflow, fsContext)
      if (intentAddendum) {
        systemMessage += '\n\n' + intentAddendum
      }

      // ── Grounding Injection: project identity + strict file index ──
      if (effectiveScope === 'project' && projectId) {
        const groundingBlock = await buildProjectGroundingBlock(projectId)
        if (groundingBlock) systemMessage += '\n\n' + groundingBlock
      }

      // Add file tree for file-aware intents
      if (fsContext) {
        const fsBlock = formatFilesystemContextBlock(fsContext)
        if (fsBlock) systemMessage += '\n\n' + fsBlock
      }

      // Add design intelligence context (non-streaming path)
      if (effectiveScope === 'project' && projectId) {
        let activeDesignPrefs = null
        try {
          const proj = await db.projects.findById(projectId)
          activeDesignPrefs = proj?.settings?.design_prefs || null
        } catch {}
        const designBlock = formatDesignContextBlock(activeDesignPrefs)
        if (designBlock) systemMessage += '\n\n' + designBlock
        const layoutBlock = getLayoutPatternForPrompt(activeDesignPrefs?.interfaceType || 'website', userMessage)
        if (layoutBlock) systemMessage += '\n\n' + layoutBlock
        const componentBlock = getComponentPatternsForPrompt(userMessage)
        if (componentBlock) systemMessage += '\n\n' + componentBlock
      }

      const messages = [
        { role: 'system', content: systemMessage },
        ...context.chat?.messages?.map(m => ({
          role: m.role,
          content: m.content
        })) || [],
        { role: 'user', content: userMessage }
      ]

      // 4. Call AI
      let response
      let toolCalls = []
      let generatedFiles = []
      let planOutput = null

      if (toolMode === 'chat_only') {
        response = await this.provider.chat(messages, {
          temperature: 0.7,
          max_tokens: 4096
        })
      } else {
        const toolResponse = await this.provider.chatWithTools(
          messages,
          AI_TOOLS,
          { temperature: 0.7, max_tokens: 16384 }
        )

        response = toolResponse.content || ''
        toolCalls = toolResponse.tool_calls || []

        for (const toolCall of toolCalls) {
          try {
            const args = JSON.parse(toolCall.function.arguments)
            const toolName = toolCall.function.name

            if (toolName === 'create_files' || toolName === 'update_files') {
              const savedFiles = await this.saveFiles(
                projectId,
                args.files,
                toolName === 'update_files'
              )
              generatedFiles = savedFiles

              if (!response) {
                response = buildFilesSummaryText(toolName, savedFiles, args)
              }
            } else if (toolName === 'plan_project') {
              planOutput = args
              if (!response) response = formatPlanResponse(args)
            } else if (toolName === 'summarize_project') {
              if (!response) response = formatSummaryResponse(args)
            }
          } catch (toolErr) {
            console.error('[AIService] Tool call parse error:', toolErr.message)
          }
        }
      }

      // Try parsing files from response text if no tool calls
      if (generatedFiles.length === 0 && toolMode !== 'chat_only') {
        const parsed = tryParseFilesFromResponse(response)
        if (parsed.files?.length > 0) {
          const savedFiles = await this.saveFiles(projectId, parsed.files, false)
          generatedFiles = savedFiles
        }
      }

      // 5. Update canvas (with error isolation)
      let canvasUpdated = false
      try {
        canvasUpdated = await this.updateCanvasFromExchange(
          projectId, userMessage, response, generatedFiles, planOutput
        )
      } catch (canvasErr) {
        console.error('[AIService] Canvas update failed:', canvasErr.message)
      }

      // 6. Index for search
      try {
        await this.indexForSearch(projectId, chatId, userMessage, response, generatedFiles)
      } catch (searchErr) {
        console.error('[AIService] Search index failed:', searchErr.message)
      }

      // 7. Log generation run with provider metadata + intent + fs stats
      await this.logGenerationRun({
        id: runId,
        project_id: projectId,
        chat_id: chatId,
        user_id: userId,
        tool_mode: toolMode,
        scope: effectiveScope,
        intent_type: intent,
        files_generated: generatedFiles.length,
        files_scanned: fsContext?.scannedCount || 0,
        files_read: fsContext?.readCount || 0,
        files_matched: fsContext?.matchedCount || 0,
        duration: Date.now() - startTime,
        success: true,
        provider: this.providerName,
        model: this.modelName,
        canvas_updated: canvasUpdated,
        files_verified: generatedFiles.length > 0
      })

      return {
        content: response,
        files: generatedFiles,
        plan: planOutput,
        toolMode,
        scope: effectiveScope,
        intent: intent,
        runId,
        provider: this.providerName,
        model: this.modelName,
        canvasUpdated,
        filesVerified: generatedFiles.length > 0,
        fsStats: fsContext ? {
          scanned: fsContext.scannedCount,
          read: fsContext.readCount,
          matched: fsContext.matchedCount,
        } : null
      }
    } catch (error) {
      console.error('[AIService] Error:', error)

      const logData = buildErrorLogData({
        runId, projectId, chatId, userId,
        requestedScope, intentType: classifyIntent(userMessage),
        startTime, error, providerName: this.providerName, modelName: this.modelName
      })

      await this.logGenerationRun(logData)

      throw error
    }
  }

