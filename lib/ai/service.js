import { createProvider } from './providers/index.js'
import { assembleContext, formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS, detectToolMode, PLAN_ONLY_TOOLS } from './tools.js'
import { classifyIntent, getIntentWorkflow, getIntentSystemAddendum, shouldUsePlanMode, resolveTaskMode, classifyRequestMode } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache, validateFileOperations } from './filesystem.js'
import { formatDesignContextBlock, getLayoutPatternForPrompt, getComponentPatternsForPrompt } from './design-system.js'
import { ProviderError } from './errors.js'
import { loadFileContext, buildGroundedPromptBlock, extractTargetPaths } from './file-context-loader.js'
import { validatePlan, hashPlan, validatePatchGrounding, validateTaskMode, validateRequestModeOutput } from './plan-validator.js'
import { logPlanEvent } from './changelog.js'
import { inspectToolCalls, detectFileType, tryParseFilesFromResponse, buildDeleteDiffs, parseSpriteOpts, parseIconOpts, formatPlanResponse, formatProposedPlanResponse, formatSummaryResponse, formatDiffSummary, formatDeleteSummary } from './tool-executor.js'
import { compressContext, classifyStreamError, extractInsights, sanitizeLogPayload, buildSearchEntries } from './stream-helpers.js'
import { EMPTY_CANVAS_CONTENT, applyInsightsToCanvas, buildFilesSummaryText, buildErrorLogData } from './post-process.js'
import { findPendingDiffMessage, buildApplyDiffContent, buildDiscardContent, buildVerifyPrompt, buildCompletenessPrompt, parseCompletenessSteps, buildContinuationData, buildApplyDoneData, buildDiscardDoneData } from './pending-diff.js'
import { parseApiCall, isRouteAllowed, executeInternalApi, PARSE_ERROR_CONTENT, buildDeniedContent, buildExecResultContent, buildExecDoneData } from './internal-api-exec.js'
import { extractFileCandidates, resolveFromProjectFiles, resolveFromFilesystem, buildInspectedContentsBlock, fsContextHasRequestedFile, buildReadOnlyDirective, cleanRefusalHistory, collectEmbeddedFiles, buildAugmentedUserMessage } from './read-only-report.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'

const MAX_RECENT_MESSAGES = 20

/**
 * MyMergent AI Service — Multi-provider with verification
 */
export class AIService {
  constructor(providerName = 'openai', model = null) {
    this.providerName = providerName
    this.modelName = model || this._defaultModel(providerName)
    this.provider = this._buildProvider()
    this._fellBack = false
  }

  static FALLBACK_MAP = {}

  _defaultModel(provider) {
    const defaults = {
      openai: process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini',
      anthropic: process.env.ANTHROPIC_MODEL_CHAT || 'claude-sonnet-4-6',
    }
    return defaults[provider] || 'gpt-4o'
  }

  _apiKey(provider) {
    // Prefer Emergent Universal Key (pooled proxy) over direct keys
    const emergentKey = process.env.EMERGENT_LLM_KEY
    if (emergentKey) return emergentKey
    const keys = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
    }
    return keys[provider]
  }

  _proxyOptions() {
    if (process.env.EMERGENT_LLM_KEY && process.env.EMERGENT_PROXY_URL) {
      return { baseURL: process.env.EMERGENT_PROXY_URL }
    }
    return {}
  }

  _buildProvider() {
    const key = this._apiKey(this.providerName)
    const opts = this._proxyOptions()
    if (!key) {
      console.warn(`[AIService] No API key for provider "${this.providerName}", falling back to openai`)
      this.providerName = 'openai'
      this.modelName = this._defaultModel('openai')
      return createProvider('openai', process.env.EMERGENT_LLM_KEY || process.env.OPENAI_API_KEY, this.modelName, opts)
    }
    return createProvider(this.providerName, key, this.modelName, opts)
  }

  _switchToFallback() {
    return false
  }

  async *_streamWithFallback(makeStream) {
    const MAX_RETRIES = 1
    let lastErr = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        for await (const chunk of makeStream()) {
          yield chunk
        }
        this._rateLimitCount = 0
        return // success
      } catch (err) {
        lastErr = err
        const { isTransient, isRateLimit } = classifyStreamError(err)

        if (isTransient && attempt < MAX_RETRIES) {
          const delay = (attempt + 1) * 2000
          console.warn(`[StreamRetry] Attempt ${attempt + 1} failed (${String(err?.message || '').slice(0, 120)}), retrying in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }

        // Non-transient or retries exhausted
        if (attempt > 0) {
          console.error(`[StreamRetry] All ${attempt + 1} attempts failed: ${String(err?.message || '').slice(0, 120)}`)
        }

        if (isRateLimit) {
          this._rateLimitCount = (this._rateLimitCount || 0) + 1
          let waitTime = '60–90 seconds'
          if (this._rateLimitCount === 2) waitTime = '2–3 minutes'
          if (this._rateLimitCount >= 3) waitTime = '5 minutes + hard refresh'
          const waitSuffix = `\n\nPlease wait ${waitTime} before retrying.`
          err.message = `${err.message}${waitSuffix}`
          if (err.user_message) err.user_message = `${err.user_message}${waitSuffix}`
        }

        throw err
      }
    }
  }

  /**
   * Stream a user message response as SSE events (async generator)
   * Yields: { event: string, data: object }
   */
  async *processMessageStream({ projectId, chatId, userMessage, userId, scope: requestedScope, designPrefs, executePlan, attachments, selfEditTarget }) {
    const startTime = Date.now()
    const runId = uuidv4()

    // If executing an approved plan, delegate to executePlanStream
    if (executePlan) {
      yield* this.executePlanStream({ projectId, chatId, userMessage, userId, scope: requestedScope, designPrefs, planData: executePlan, runId, startTime, selfEditTarget })
      return
    };

    try {
      // ── Request-Mode Gate ──
      // Detect pending diffs and classify request mode before planner.
      let hasPendingDiff = false
      let pendingDiffMessage = null
      if (chatId) {
        try {
          const chatMessages = await db.messages.findByChatId(chatId)
          pendingDiffMessage = findPendingDiffMessage([...chatMessages])
          hasPendingDiff = !!pendingDiffMessage
        } catch {}
      }

      const requestMode = classifyRequestMode(userMessage, { hasPendingDiff })
      console.log('[RequestModeGate]', JSON.stringify({ request_mode: requestMode, has_pending_diff: hasPendingDiff, projectId: projectId || null, message: userMessage?.slice(0, 120) }))

      // ── apply_pending_diff bypass ──
      if (requestMode === 'apply_pending_diff' && pendingDiffMessage) {
        yield { event: 'status', data: { stage: 'applying_pending_diff', detail: 'Applying pending diff...' } }
        const diffFiles = pendingDiffMessage.metadata.diffFiles
        const planData = pendingDiffMessage.metadata.planData || null
        const results = await this.applyDiffs(projectId, chatId, userId, diffFiles, planData)

        // safeApplyDiffs now handles diffStatus transition internally;
        // only fall back to manual update if it didn't transition
        if (!results.diffStatusTransitioned) {
          try {
            await db.messages.update(pendingDiffMessage.id, {
              metadata: { ...pendingDiffMessage.metadata, diffStatus: 'applied' }
            })
          } catch {}
        }

        const content = buildApplyDiffContent(results)
        yield { event: 'token', data: { content } }

        // Post-apply verification: check if the result achieves the plan's goal
        let verificationPassed = true
        if (!results.rolledBack && planData?.next_steps?.length > 0) {
          try {
            yield { event: 'status', data: { stage: 'verifying', detail: 'Verifying applied changes...' } }
            let verifyContent = ''
            for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(buildVerifyPrompt(planData, results), { temperature: 0.2, max_tokens: 256 }))) {
              if (chunk.type === 'token') verifyContent += chunk.content
            }
            if (verifyContent.trim().toUpperCase().startsWith('NO')) {
              console.log('[PostApplyVerify] Verification failed:', verifyContent.slice(0, 200))
              verificationPassed = false
              yield { event: 'status', data: { stage: 'verification_failed', detail: verifyContent.trim().slice(0, 200) } }
            }
          } catch (err) {
            console.warn('[PostApplyVerify] Check failed, proceeding:', err.message)
          }
        }

        // Completeness check: when next_steps is empty, ask if the overall goal is done
        let synthesizedSteps = []
        if (!results.rolledBack && verificationPassed && (!planData?.next_steps || planData.next_steps.length === 0)) {
          try {
            yield { event: 'status', data: { stage: 'checking_completeness', detail: 'Checking if task is fully complete...' } }
            let completenessContent = ''
            for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(buildCompletenessPrompt(userMessage, planData, results), { temperature: 0.2, max_tokens: 512 }))) {
              if (chunk.type === 'token') completenessContent += chunk.content
            }
            synthesizedSteps = parseCompletenessSteps(completenessContent)
            if (synthesizedSteps.length > 0) {
              console.log('[CompletenessCheck] Task incomplete:', completenessContent.slice(0, 200))
              yield { event: 'status', data: { stage: 'continuation_discovered', detail: `${synthesizedSteps.length} remaining step(s) identified` } }
            }
          } catch (err) {
            console.warn('[CompletenessCheck] Failed, treating as complete:', err.message)
          }
        }

        const continuation = buildContinuationData(planData, verificationPassed, synthesizedSteps, results)
        yield { event: 'done', data: buildApplyDoneData(content, { requestedScope, runId, providerName: this.providerName, modelName: this.modelName, results, planData, continuation }) }
        return
      }

      // ── discard_pending_diff bypass ──
      if (requestMode === 'discard_pending_diff' && pendingDiffMessage) {
        yield { event: 'status', data: { stage: 'discarding_pending_diff', detail: 'Discarding pending diff...' } }

        const { discardDiffs } = await import('@/lib/self_builder/safe_apply')
        const discardResult = await discardDiffs(chatId, pendingDiffMessage.id, userId)
        if (!discardResult.discarded) {
          // Fallback to direct update if discardDiffs failed (e.g. self-edit gate)
          if (discardResult.error?.startsWith('FORBIDDEN')) {
            const content = `## Discard Blocked\n\n${discardResult.error}`
            yield { event: 'token', data: { content } }
            yield { event: 'done', data: buildDiscardDoneData(content, { requestedScope, runId, providerName: this.providerName, modelName: this.modelName, error: discardResult.error }) }
            return
          }
          try {
            await db.messages.update(pendingDiffMessage.id, {
              metadata: { ...pendingDiffMessage.metadata, diffStatus: 'discarded' }
            })
          } catch {}
        }

        const content = buildDiscardContent(pendingDiffMessage.metadata.diffFiles)
        yield { event: 'token', data: { content } }
        yield { event: 'done', data: buildDiscardDoneData(content, { requestedScope, runId, providerName: this.providerName, modelName: this.modelName }) }
        return
      }

      // ── internal_api_exec bypass ──
      if (requestMode === 'internal_api_exec') {
        yield { event: 'status', data: { stage: 'internal_api_exec', detail: 'Executing internal API call...' } }
        const doneOpts = { requestedScope, runId, providerName: this.providerName, modelName: this.modelName }

        const parsed = parseApiCall(userMessage, projectId)
        if (!parsed) {
          yield { event: 'token', data: { content: PARSE_ERROR_CONTENT } }
          yield { event: 'done', data: buildExecDoneData(PARSE_ERROR_CONTENT, doneOpts) }
          return
        }

        const { method, apiPath, body } = parsed

        if (!isRouteAllowed(method, apiPath)) {
          const content = buildDeniedContent(method, apiPath)
          yield { event: 'token', data: { content } }
          yield { event: 'done', data: buildExecDoneData(content, doneOpts) }
          return
        }

        const { status, responseBody } = await executeInternalApi(method, apiPath, body, projectId, db)
        const content = buildExecResultContent(method, apiPath, body, status, responseBody)
        yield { event: 'token', data: { content } }
        yield { event: 'done', data: buildExecDoneData(content, doneOpts) }
        return
      }

      // 1. Classify intent
      yield { event: 'status', data: { stage: 'classifying_intent', detail: 'Analyzing your request...' } }
      const intent = classifyIntent(userMessage)
      let workflow = getIntentWorkflow(intent)
      yield { event: 'status', data: { stage: 'intent_classified', detail: workflow.description, intent } }

      // ── HARD GUARD: Build/edit/refactor intents NEVER route to image generation ──
      if (shouldUsePlanMode(intent) && workflow.toolMode === 'image_gen') {
        console.warn('[AIService] Image generation blocked — build/edit intent detected, forcing build workflow')
        workflow = getIntentWorkflow('build')
      }

      // IMAGE GENERATION BRANCH — handle separately from text generation
      if (workflow.toolMode === 'image_gen') {
        yield* this.processImageGeneration({ projectId, chatId, userMessage, userId, intent, workflow, runId, startTime })
        return
      }

      // 2. Resolve scope
      const autoScope = classifyScope(userMessage)
      let effectiveScope = requestedScope || autoScope
      if (!requestedScope && workflow.preferPlatformScope) effectiveScope = 'platform'

      // 3. Select provider/model
      yield { event: 'status', data: { stage: 'selecting_provider', detail: `Using ${this.providerName}/${this.modelName}` } }

      // 4. Load context
      yield { event: 'status', data: { stage: 'loading_context', detail: 'Reading project files and context...' } }
      const context = await this.loadScopedContext(projectId, chatId, userId, effectiveScope)

      // 5. Filesystem context
      let fsContext = null
      if (effectiveScope === 'project' && projectId) {
        try {
          yield { event: 'status', data: { stage: 'scanning_files', detail: 'Scanning project files...' } }
          fsContext = await buildFilesystemContext(projectId, intent, userMessage)
          if (fsContext.scannedCount > 0) {
            yield { event: 'status', data: { stage: 'files_scanned', detail: `Scanned ${fsContext.scannedCount} files, ${fsContext.matchedCount} relevant, ${fsContext.readCount} loaded` } }
          }
          if (fsContext.relevantFiles?.length > 0) {
            yield { event: 'status', data: { stage: 'reading_files', detail: `Reading ${fsContext.relevantFiles.length} relevant file(s) for context...` } }
          }
        } catch (fsErr) {
          console.error('[AIService] Filesystem context error:', fsErr.message)
        }
      }

      // 6. Determine if plan-first mode applies
      // read_only_report forces chat_only — no plan, no file tools
      const usePlanMode = requestMode === 'read_only_report'
        ? false
        : (shouldUsePlanMode(intent) && effectiveScope === 'project')

      // 7. Determine tool mode
      const toolMode = requestMode === 'read_only_report'
        ? 'chat_only'
        : (effectiveScope !== 'project'
          ? 'chat_only'
          : workflow.toolMode)

      // 8. Build system message with filesystem context block
      let systemMessage = formatContextAsSystemMessage(
        context, context.project?.type || 'app', effectiveScope
      )
      const intentAddendum = getIntentSystemAddendum(intent, workflow, fsContext)
      if (intentAddendum) systemMessage += '\n\n' + intentAddendum

      // Inject full filesystem context block (file tree + relevant file contents + rules)
      if (fsContext) {
        const fsBlock = formatFilesystemContextBlock(fsContext)
        if (fsBlock) systemMessage += '\n\n' + fsBlock
      }

      // ── Direct file-read for read_only_report ──
      // Extract explicit file paths from the message and load them directly,
      // ensuring the AI always has the requested file contents.
      let directReadFiles = [] // hoisted for use in message augmentation below
      let requestedFileFound = false // tracks if the REQUESTED file (not just any file) was found
      if (requestMode === 'read_only_report' && projectId) {
        const candidates = extractFileCandidates(userMessage)
        const allFiles = await db.projectFiles.findByProjectId(projectId)

        const resolved = resolveFromProjectFiles(candidates, allFiles, fsContext)
        directReadFiles = resolved.directReadFiles
        requestedFileFound = resolved.requestedFileFound

        // Fallback: if not in project DB, check actual filesystem (self-builder use case)
        if (!requestedFileFound) {
          const fsResult = await resolveFromFilesystem(candidates)
          if (fsResult.found) {
            directReadFiles.push(...fsResult.files)
            requestedFileFound = true
          }
        }

        console.log('[DirectFileRead]', JSON.stringify({
          candidates, matched: directReadFiles.map(f => f.path),
          already_loaded: [...resolved.loadedPaths].filter(p => !directReadFiles.find(f => f.path === p)),
          total_project_files: allFiles.length,
          requestedFileFound,
          usedFilesystemFallback: directReadFiles.some(f => f.path && !allFiles.find(a => a.path === f.path)),
        }))

        systemMessage += buildInspectedContentsBlock(directReadFiles)
      }

      // ── Critical: Add read-only inspection directive ──
      if (requestMode === 'read_only_report' && projectId) {
        const candidates = extractFileCandidates(userMessage)
        const allFilesForDirective = await db.projectFiles.findByProjectId(projectId)
        const hasRequestedFileContent =
          requestedFileFound || directReadFiles.length > 0 ||
          fsContextHasRequestedFile(candidates, fsContext)

        systemMessage += buildReadOnlyDirective({ hasRequestedFileContent, candidates, allFiles: allFilesForDirective })
      }

      // Inject design intelligence context (Part 5 + Part 8)
      if (effectiveScope === 'project') {
        let activeDesignPrefs = designPrefs
        if (!activeDesignPrefs && projectId) {
          try {
            const proj = await db.projects.findById(projectId)
            activeDesignPrefs = proj?.settings?.design_prefs || null
          } catch {}
        }

        const designBlock = formatDesignContextBlock(activeDesignPrefs)
        if (designBlock) systemMessage += '\n\n' + designBlock

        const layoutBlock = getLayoutPatternForPrompt(activeDesignPrefs?.interfaceType || 'website', userMessage)
        if (layoutBlock) systemMessage += '\n\n' + layoutBlock

        const componentBlock = getComponentPatternsForPrompt(userMessage)
        if (componentBlock) systemMessage += '\n\n' + componentBlock
      }

      // Inject attachment context into the AI prompt
      if (attachments?.length > 0) {
        let attachBlock = '\n\n## Uploaded File Attachments\nThe user has uploaded the following files with this message. PRIORITIZE these uploaded files over existing project files when the user refers to "uploaded files", "the file I attached", etc.\n\n'
        let attachCount = 0
        for (const att of attachments) {
          // Load content from DB if not provided inline
          let fileContent = att.content || null
          let extractedText = att.extracted_text || null

          if (!fileContent && att.path && projectId) {
            try {
              const dbFile = await db.projectFiles.findByPath(projectId, att.path)
              if (dbFile?.content) {
                fileContent = dbFile.content
              }
            } catch (e) {
              console.error('[AIService] Failed to load attachment content:', att.path, e.message)
            }
          }

          if (att.file_category === 'text' && fileContent) {
            attachBlock += `### Uploaded File: ${att.filename} (${att.mime_type || 'text'})\n\`\`\`\n${fileContent.slice(0, 30000)}\n\`\`\`\n\n`
            attachCount++
          } else if (att.file_category === 'pdf') {
            const pdfText = extractedText || fileContent
            if (pdfText) {
              attachBlock += `### Uploaded File: ${att.filename} (PDF)\nExtracted text:\n${pdfText.slice(0, 30000)}\n\n`
              attachCount++
            }
          } else if (att.file_category === 'image') {
            attachBlock += `### Uploaded File: ${att.filename} (${att.mime_type || 'image'})\n[Image uploaded — stored at project path: ${att.path}. Reference this image when the user asks about uploaded screenshots or images.]\n\n`
            attachCount++
          }
        }
        if (attachCount > 0) {
          systemMessage += attachBlock
        }
      }

      // Inject adaptive learning context (user prefs + project prefs + learned rules)
      if (projectId) {
        try {
          const { buildAdaptiveContext, extractCorrections, recordLearningEvent } = await import('@/lib/ai/adaptive-learning')
          const adaptiveBlock = await buildAdaptiveContext(projectId)
          if (adaptiveBlock) systemMessage += '\n\n' + adaptiveBlock

          // Auto-extract corrections from current user message
          const corrections = extractCorrections(userMessage)
          for (const correction of corrections) {
            await recordLearningEvent(projectId, {
              user_id: userId,
              event_type: 'correction',
              source_text: userMessage.slice(0, 200),
              inferred_rule: correction,
              confidence: correction.confidence,
            })
          }
        } catch (err) {
          console.warn('[AdaptiveContext] Failed to load:', err.message)
        }
      }

      // ── Prompt pattern matching (adaptive intelligence) ──
      // Check if this input matches a previously successful prompt pattern
      // Active objective detection prevents "ask user" interruptions mid-task
      if (usePlanMode && projectId) {
        try {
          const { request_router } = await import('@/lib/self_builder/request_router')
          const routeResult = await request_router({ input: userMessage, projectId, userId })
          if (routeResult?.type === 'prompt_pattern_match') {
            console.log('[PromptRouter] pattern match:', routeResult.pattern?.key)
            systemMessage += `\n\n## Matched Prompt Pattern\nThis request matches a previously successful pattern: "${routeResult.pattern?._meta?.text || routeResult.pattern?.value}"\nReuse the same approach that worked before.`
            // Record usage (fire-and-forget)
            import('@/lib/self_builder/prompt_library').then(({ recordPatternUsage }) => {
              recordPatternUsage(routeResult.pattern)
            }).catch(() => {})
          }
          // Active objective continuation — inject context so planner stays on track
          if (routeResult?._continued_from) {
            const obj = routeResult._continued_from
            console.log('[PromptRouter] active objective continuation from', obj.source, ':', obj.task?.slice(0, 80))
            systemMessage += `\n\n## Active Objective (auto-continued)\nThere is an active system objective in progress. Continue executing — do NOT ask the user for priorities or clarification.\nObjective: ${obj.task}${obj.plan_summary ? `\nLast plan summary: ${obj.plan_summary}` : ''}`
          }
          // ambiguous_match with no active objective: fall through to planner (no early return)
          // match / no_match: fall through to planner
        } catch (err) {
          console.log('[PromptRouter] error:', err.message)
        }
      }

      // Plan-first addendum: instruct AI to propose plan, not write files
      // Now with grounded file context from FileContextLoader
      let groundedFileContext = null
      if (usePlanMode && projectId) {
        try {
          yield { event: 'status', data: { stage: 'grounding_context', detail: 'Loading real file contents for grounded planning...' } }

          // Extract target paths from user message + project file list
          const earlyFiles = await db.projectFiles.findByProjectId(projectId)
          const projectPaths = earlyFiles.map(f => f.path)
          const targetPaths = extractTargetPaths(userMessage, projectPaths)

          // If user didn't reference specific files, include all project files (up to reasonable limit)
          const pathsToLoad = targetPaths.length > 0 ? targetPaths : projectPaths.slice(0, 20)

          if (pathsToLoad.length > 0) {
            groundedFileContext = await loadFileContext(projectId, pathsToLoad)
            const groundedBlock = buildGroundedPromptBlock(groundedFileContext)
            systemMessage += '\n\n' + groundedBlock
            console.log('[FileContextLoader]', JSON.stringify({
              file_context_loaded: true,
              file_count: groundedFileContext.files.length,
              file_paths: groundedFileContext.files.map(f => f.path),
            }))
            yield { event: 'status', data: { stage: 'context_grounded', detail: `Loaded ${groundedFileContext.existingPaths.length} existing file(s), ${groundedFileContext.nonexistentPaths.length} new` } }
          }
        } catch (err) {
          console.error('[AIService] FileContextLoader error:', err.message)
        }

        systemMessage += `\n\n## IMPORTANT: Plan-First Mode — Grounded Planning
You MUST use the \`propose_plan\` tool to propose your implementation plan BEFORE writing any files.
Do NOT use create_files, update_files, or delete_files tools.

DECOMPOSITION (required for non-trivial tasks):
Before listing file_actions, break the task into discrete sub-problems.
Your "reasoning" array MUST start with sub-problem entries in the format:
  "SUB: <problem description> → <file(s) affected>"
Example:
  "SUB: State management for undo history → lib/undo-stack.js (create)"
  "SUB: Hook undo into existing save flow → lib/editor/save.js (update)"
Then follow with your implementation steps.

GROUNDING RULES:
- If a file EXISTS in the context above, you MUST use action: "update" (NOT "create")
- If a file is marked NONEXISTENT, use action: "create"
- Every file_action MUST include "grounded_on" — cite the exact code section or state you are basing the change on
- Do NOT use placeholder language: "assume", "existing code", "insert here", "where metadata is read"
- Keep patches MINIMAL — only change what the user asked for, do not rewrite unrelated code
- Include "constraints_checked" in your response to self-verify grounding
- "reasoning" must be an array of concrete steps, not vague descriptions

The user will review and approve, revise, or cancel your plan before any files are changed.`
      }

      if (!usePlanMode && shouldUsePlanMode(intent) && requestMode !== 'read_only_report') {
        // Non-project scope but plan-worthy intent — just inform
        systemMessage += `\n\nNote: Plan mode is available for project-scoped requests.`
      }

      let messages = [
        { role: 'system', content: systemMessage },
        ...context.chat?.messages?.map(m => ({ role: m.role, content: m.content })) || [],
        { role: 'user', content: userMessage }
      ]

      // ── read_only_report: harden message array against chat-history pollution ──
      // Prior assistant refusals ("I'm unable to access files") create a pattern the
      // model follows regardless of system directives. Fix: strip polluted history
      // and embed file content directly in the user message (highest attention weight).
      if (requestMode === 'read_only_report') {
        const cleanHistory = cleanRefusalHistory(context.chat?.messages)
        const embeddedFiles = collectEmbeddedFiles(fsContext, directReadFiles)
        const augmentedUserMsg = buildAugmentedUserMessage(userMessage, embeddedFiles)

        messages = [
          { role: 'system', content: systemMessage },
          ...cleanHistory.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: augmentedUserMsg }
        ]
      }

      // ── Diagnostic: log critical state for read_only debugging ──
      if (requestMode === 'read_only_report') {
        const sysMsgLen = systemMessage.length
        const hasInspectionDirective = systemMessage.includes('READ-ONLY INSPECTION MODE')
        const hasInspectedContents = systemMessage.includes('## Inspected File Contents')
        const chatHistoryCount = messages.length - 2 // minus system + user
        const userMsgLen = messages[messages.length - 1].content.length
        console.log('[ReadOnlyDiag]', JSON.stringify({
          requestMode, toolMode, usePlanMode, effectiveScope: effectiveScope,
          intent, projectId: projectId || null,
          sysMsgLen, hasInspectionDirective, hasInspectedContents,
          chatHistoryCount, userMsgLen,
          totalMessages: messages.length,
          fileContentEmbeddedInUserMsg: messages[messages.length - 1].content.includes('FILE CONTENTS'),
        }))
      }

      // 9. Stream AI response
      yield { event: 'status', data: { stage: usePlanMode ? 'proposing_plan' : 'generating', detail: usePlanMode ? 'Creating implementation plan...' : 'Generating response...' } }

      let fullContent = ''
      let toolCalls = []
      let generatedFiles = []
      let diffFiles = []
      let planOutput = null
      let proposedPlan = null

      // Pre-load project files for reliable existence checks with path normalization
      const allProjectFiles = effectiveScope === 'project' ? await db.projectFiles.findByProjectId(projectId) : []
      const filesByPath = new Map()
      for (const f of allProjectFiles) {
        filesByPath.set(f.path, f)
        const norm = f.path.replace(/^\.\//, '').replace(/^\//, '')
        if (norm !== f.path) filesByPath.set(norm, f)
      }
      const findExisting = (path) => {
        const norm = path.replace(/^\.\//, '').replace(/^\//, '')
        return filesByPath.get(path) || filesByPath.get(norm) || null
      }

      // Select tool set based on mode
      const toolSet = usePlanMode ? PLAN_ONLY_TOOLS : AI_TOOLS

      if (toolMode === 'chat_only' && !usePlanMode) {
        // Pure chat streaming
        for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(messages, { temperature: 0.7, max_tokens: 4096 }))) {
          if (chunk.type === 'status') {
            yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
          } else if (chunk.type === 'token') {
            fullContent += chunk.content
            yield { event: 'token', data: { content: chunk.content } }
          }
        }
      } else {
        // Tool-calling streaming — stream text, collect tool calls
        const toolOpts = { temperature: 0.7, max_tokens: 8192 }
        // Force the AI to call propose_plan when in plan mode
        if (usePlanMode) {
          toolOpts.tool_choice = { type: 'function', function: { name: 'propose_plan' } }
        }

        const MAX_PLAN_RETRIES = 2
        let planAttempt = 0
        let lastRejectedPlanHash = null
        if (usePlanMode && projectId) {
          try {
            const prev = await db.changelog.findLastRejectedForTask(projectId, userMessage)
            if (prev) lastRejectedPlanHash = prev.plan_hash
          } catch {}
        }

        // Multi-pass planning: run an analysis pass before proposing
        if (usePlanMode) {
          yield { event: 'status', data: { stage: 'analyzing', detail: 'Analyzing codebase before planning...' } }
          const analysisMessages = [
            ...messages.slice(0, -1),
            { role: 'user', content: `Before proposing a plan, analyze the following request. Output ONLY a short structured analysis — do NOT write code or call any tools.\n\nRequest: ${userMessage}\n\nProvide:\n1. **Affected files** — which existing files need changes and which are new\n2. **Dependencies** — what other files/modules depend on or are imported by the affected files\n3. **Risks** — what could break, edge cases, ordering concerns\n4. **Approach** — recommended step-by-step strategy\n\nKeep it concise (under 300 words).` }
          ]
          let analysisContent = ''
          try {
            for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(analysisMessages, { temperature: 0.4, max_tokens: 1024 }))) {
              if (chunk.type === 'token') analysisContent += chunk.content
            }
          } catch (err) {
            console.warn('[MultiPassPlanner] Analysis pass failed, proceeding without:', err.message)
          }
          if (analysisContent) {
            messages.push({ role: 'assistant', content: analysisContent })
            messages.push({ role: 'user', content: 'Good analysis. Now use the propose_plan tool to create the implementation plan based on your analysis above.' })
            yield { event: 'status', data: { stage: 'analysis_complete', detail: 'Analysis complete, creating plan...' } }
          }
        }

        while (true) {
          fullContent = ''
          toolCalls = []

          for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, toolSet, toolOpts))) {
            if (chunk.type === 'status') {
              yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
            } else if (chunk.type === 'token') {
              fullContent += chunk.content
              if (!usePlanMode) yield { event: 'token', data: { content: chunk.content } }
            } else if (chunk.type === 'tool_calls') {
              toolCalls = chunk.tool_calls
            }
          }

          // If plan mode: verify propose_plan was actually called
          if (usePlanMode) {
            const hasPlanCall = toolCalls.some(tc => {
              try { return tc.function.name === 'propose_plan' } catch { return false }
            })

            if (!hasPlanCall && planAttempt < MAX_PLAN_RETRIES) {
              planAttempt++
              console.warn(`[AIService] Plan mode: model returned text instead of propose_plan tool call (attempt ${planAttempt}/${MAX_PLAN_RETRIES}), retrying...`)
              // Append the failed text response and a correction nudge to force the tool
              messages.push({ role: 'assistant', content: fullContent })
              messages.push({ role: 'user', content: 'You MUST use the propose_plan tool. Do not respond with text. Call the propose_plan function now.' })
              continue
            }

            // Duplicate-plan loop breaker
            if (hasPlanCall && lastRejectedPlanHash && planAttempt < MAX_PLAN_RETRIES) {
              const planTC = toolCalls.find(tc => { try { return tc.function.name === 'propose_plan' } catch { return false } })
              if (planTC) {
                try {
                  const dupArgs = JSON.parse(planTC.function.arguments)
                  const dupHash = hashPlan(dupArgs)
                  if (dupHash === lastRejectedPlanHash) {
                    planAttempt++
                    lastRejectedPlanHash = dupHash
                    console.log('[PlanValidator] Duplicate plan rejected:', JSON.stringify({
                      event: 'duplicate_plan_rejected', task: userMessage?.slice(0, 200), plan_hash: dupHash,
                    }))
                    logPlanEvent({
                      projectId, chatId, userId, userTask: userMessage,
                      taskMode: 'duplicate_plan_rejected',
                      validatorResult: { valid: false, errors: ['Duplicate plan'], warnings: [], mode: 'duplicate_rejected' },
                      planHash: dupHash,
                      rejectionReasons: ['Plan identical to previously rejected plan'],
                      planSummary: dupArgs.summary,
                      fileActions: dupArgs.file_actions,
                      constraintsChecked: dupArgs.constraints_checked,
                    }).catch(() => {})
                    messages.push({ role: 'assistant', content: fullContent })
                    messages.push({ role: 'user', content: 'The previous plan was rejected because it was identical to a prior plan. Produce a different strategy and modify file_actions.' })
                    continue
                  }
                } catch {}
              }
            }

            // Emit the held-back tokens now that we know it's valid (or exhausted retries)
            if (fullContent) {
              yield { event: 'token', data: { content: fullContent } }
            }
          }

          break
        }

        // ── Task-Mode Enforcement ──
        const taskMode = resolveTaskMode(intent)
        if (toolCalls.length > 0) {
          const { hasFileContent, hasFileActions } = inspectToolCalls(toolCalls)
          const tmResult = validateTaskMode(taskMode, {
            hasFileActions,
            hasFileContent,
            hasGroundedContext: !!groundedFileContext,
            diffStatus: null,
          })
          if (!tmResult.valid) {
            console.log('[TaskModeEnforcer] Rejected:', JSON.stringify({ event: 'task_mode_rejected', mode: taskMode, errors: tmResult.errors }))
            logPlanEvent({
              projectId, chatId, userId, userTask: userMessage,
              taskMode: 'task_mode_rejected',
              validatorResult: tmResult,
              rejectionReasons: tmResult.errors,
              fileActions: proposedPlan?.file_actions || (Array.isArray(diffFiles) && diffFiles.length ? diffFiles.map(d => ({ action: d.action, path: d.path })) : null),
            }).catch(() => {})
            yield { event: 'status', data: { stage: 'task_mode_rejected', detail: `Task mode violation: ${tmResult.errors.join('; ')}` } }
            fullContent = `## Task Mode Violation\n\n${tmResult.errors.map(e => '- ' + e).join('\n')}`
            yield { event: 'token', data: { content: fullContent } }
            yield { event: 'done', data: { content: fullContent, toolMode: 'task_mode_rejected', scope: effectiveScope, intent, runId, provider: this.providerName, model: this.modelName } }
            return
          }
        }

        // Process tool calls
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              const toolName = toolCall.function.name

              if (toolName === 'propose_plan') {
                // Plan-first mode: enforce correctness then validate
                const { enforcePlanCorrectness } = await import('@/lib/self_builder/feature_planner')
                const { corrections } = enforcePlanCorrectness(args, groundedFileContext, userMessage)
                if (corrections.length > 0) {
                  console.log('[FeaturePlanner] Corrections:', corrections)
                }

                let validationResult = null
                // Always run plan validation — structural checks run even without grounded context
                validationResult = validatePlan(args, groundedFileContext, lastRejectedPlanHash, userMessage, { allowedPathPrefix: selfEditTarget?.path || null })

                if (!validationResult.valid) {
                  yield { event: 'status', data: { stage: 'plan_validation_failed', detail: `Plan rejected: ${validationResult.errors.join('; ')}` } }

                  console.log('[PlanValidator] Rejection:', JSON.stringify({
                    rejection_reason: validationResult.errors,
                    task: userMessage?.slice(0, 200),
                    plan_hash: validationResult.hash,
                  }))

                  // Log the rejection
                  logPlanEvent({
                    projectId, chatId, userId,
                    userTask: userMessage,
                    taskMode: 'plan',
                    contextPaths: groundedFileContext?.files?.map(f => f.path) || [],
                    validatorResult: validationResult,
                    planHash: validationResult.hash,
                    rejectionReasons: validationResult.errors,
                    planSummary: args.summary,
                    fileActions: args.file_actions,
                    constraintsChecked: args.constraints_checked,
                  }).catch(() => {})

                  // Update in-memory baseline so retries can't repeat this plan
                  lastRejectedPlanHash = validationResult.hash

                  // Feed rejection reasons back so the planner can learn on retry
                  messages.push({ role: 'assistant', content: fullContent || JSON.stringify(args) })
                  messages.push({ role: 'user', content: `Your plan was rejected for these reasons:\n${validationResult.errors.map(e => '- ' + e).join('\n')}\n\nFix these issues and call propose_plan again.` })
                  fullContent = ''

                  // HARD BLOCK — re-call AI with rejection feedback (cannot use continue — outside while loop)
                  yield { event: 'status', data: { stage: 'plan_revision', detail: 'Revising plan based on validation feedback...' } }
                  try {
                  let revContent = ''
                  let revToolCalls = []
                  for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, toolSet, toolOpts))) {
                    if (chunk.type === 'token') revContent += chunk.content
                    else if (chunk.type === 'tool_calls') revToolCalls = chunk.tool_calls
                  }

                  const revPlanCall = revToolCalls.find(tc => {
                    try { return tc.function.name === 'propose_plan' } catch { return false }
                  })
                  if (revPlanCall) {
                    try {
                      const revArgs = JSON.parse(revPlanCall.function.arguments)
                      proposedPlan = revArgs
                      yield { event: 'plan', data: revArgs }
                      fullContent = formatProposedPlanResponse(revArgs)
                      yield { event: 'token', data: { content: fullContent } }
                    } catch (parseErr) {
                      console.warn('[PlanValidator] Failed to parse revised plan:', parseErr.message)
                      if (revContent) {
                        fullContent = revContent
                        yield { event: 'token', data: { content: revContent } }
                      }
                    }
                  } else if (revContent) {
                    fullContent = revContent
                    yield { event: 'token', data: { content: revContent } }
                  }
                  break
                  } catch (retryErr) {
                    console.error('[PlanValidator] Retry stream failed:', retryErr.message?.slice(0, 120))
                    throw retryErr // propagate to top-level catch → yields error event
                  }
                }

                // Add warning if no grounded context was available
                if (!groundedFileContext) {
                  validationResult.warnings = validationResult.warnings || []
                  validationResult.warnings.push('No existing files loaded; validation ran without file existence checks')
                  validationResult.mode = 'empty_project'
                }

                // H7.7.1 Fast Mode — skip SelfCritique for simple prompts
                const planFileActions = args.file_actions || args.files || []
                const isSimplePrompt = (
                  planFileActions.length <= 2 ||
                  (userMessage.length < 200 && planFileActions.length <= 4)
                )
                if (isSimplePrompt) {
                  console.log(`[FastMode] Simple prompt (${planFileActions.length} files, ${userMessage.length} chars) — skipping SelfCritique`)
                }

                // Self-critique: AI reviews its own plan before emission
                if (!isSimplePrompt && planAttempt < MAX_PLAN_RETRIES) {
                  try {
                    yield { event: 'status', data: { stage: 'self_critique', detail: 'Reviewing plan for completeness...' } }
                    const critiqueMessages = [
                      { role: 'user', content: `User request: ${userMessage}\n\nProposed plan:\n${JSON.stringify(args, null, 2)}\n\nReview this plan. Start your response with exactly "ISSUES FOUND: yes" or "ISSUES FOUND: no".\n\nCheck:\n1. Does this plan fully solve the user's request?\n2. Are any files missing that should be changed?\n3. Are any changes unnecessary or wrong?\n\nIf issues exist, explain briefly what needs to change.` }
                    ]
                    let critiqueContent = ''
                    for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(critiqueMessages, { temperature: 0.3, max_tokens: 512 }))) {
                      if (chunk.type === 'token') critiqueContent += chunk.content
                    }
                    if (critiqueContent.trim().toLowerCase().startsWith('issues found: yes')) {
                      console.log('[SelfCritique] Issues found, revising plan:', critiqueContent.slice(0, 200))
                      planAttempt++
                      lastRejectedPlanHash = validationResult.hash
                      messages.push({ role: 'assistant', content: fullContent || JSON.stringify(args) })
                      messages.push({ role: 'user', content: `Your plan has issues:\n${critiqueContent}\n\nRevise the plan using propose_plan to fix these problems.` })
                      fullContent = ''
                      yield { event: 'status', data: { stage: 'plan_revision', detail: 'Revising plan based on self-review...' } }

                      // Re-call AI with critique feedback (cannot use continue — wrong loop scope)
                      let revisedContent = ''
                      let revisedToolCalls = []
                      for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, toolSet, toolOpts))) {
                        if (chunk.type === 'token') revisedContent += chunk.content
                        else if (chunk.type === 'tool_calls') revisedToolCalls = chunk.tool_calls
                      }

                      const revisedPlanCall = revisedToolCalls.find(tc => {
                        try { return tc.function.name === 'propose_plan' } catch { return false }
                      })
                      if (revisedPlanCall) {
                        try {
                          const revisedArgs = JSON.parse(revisedPlanCall.function.arguments)
                          proposedPlan = revisedArgs
                          yield { event: 'plan', data: revisedArgs }
                          fullContent = formatProposedPlanResponse(revisedArgs)
                          yield { event: 'token', data: { content: fullContent } }
                        } catch (parseErr) {
                          console.warn('[SelfCritique] Failed to parse revised plan:', parseErr.message)
                          if (revisedContent) {
                            fullContent = revisedContent
                            yield { event: 'token', data: { content: revisedContent } }
                          }
                        }
                      } else if (revisedContent) {
                        fullContent = revisedContent
                        yield { event: 'token', data: { content: revisedContent } }
                      }
                      // Skip original plan emission — revised plan already emitted above
                      break
                    }
                  } catch (err) {
                    console.warn('[SelfCritique] Failed, proceeding with plan:', err.message)
                  }
                }

                proposedPlan = args
                yield { event: 'plan', data: args }

                // Log successful plan
                logPlanEvent({
                  projectId, chatId, userId,
                  userTask: userMessage,
                  taskMode: 'plan',
                  contextPaths: groundedFileContext?.files?.map(f => f.path) || [],
                  validatorResult: validationResult,
                  planHash: hashPlan(args),
                  planSummary: args.summary,
                  fileActions: args.file_actions,
                  constraintsChecked: args.constraints_checked,
                }).catch(() => {})

                // Generate a readable summary as the message content
                if (!fullContent) {
                  fullContent = formatProposedPlanResponse(args)
                  yield { event: 'token', data: { content: fullContent } }
                }
              } else if (toolName === 'create_files' || toolName === 'update_files') {
                // Generate diffs for review instead of writing files directly
                yield { event: 'status', data: { stage: 'generating_diffs', detail: `Building diff preview for ${args.files?.length || 0} file(s)...` } }
                const { buildPendingDiffs } = await import('@/lib/self_builder/file_ops_bridge')
                const pendingDiffs = buildPendingDiffs(args.files, {
                  planFileActions: proposedPlan?.file_actions,
                  findExisting,
                  toolName,
                  detectFileType,
                })

                const patchResult = validatePatchGrounding(pendingDiffs, filesByPath, proposedPlan)
                if (!patchResult.valid) {
                  console.log('[PatchGroundingValidator] Rejected:', JSON.stringify({ event: 'patch_grounding_rejected', errors: patchResult.errors }))
                  logPlanEvent({
                    projectId, chatId, userId, userTask: userMessage,
                    taskMode: 'patch_grounding_rejected',
                    validatorResult: { valid: false, errors: patchResult.errors, warnings: [], mode: 'patch_grounding_rejected' },
                    planHash: proposedPlan ? hashPlan(proposedPlan) : null,
                    rejectionReasons: patchResult.errors,
                    planSummary: args.plan || args.summary || null,
                    fileActions: pendingDiffs.map(d => ({ action: d.action, path: d.path })),
                  }).catch(() => {})
                  yield { event: 'status', data: { stage: 'patch_grounding_failed', detail: `Patch rejected: ${patchResult.errors.join('; ')}` } }
                  fullContent = `## Patch Rejected\n\n${patchResult.errors.map(e => '- ' + e).join('\n')}\n\n*Please try again with a more specific prompt.*`
                  yield { event: 'token', data: { content: fullContent } }
                  continue
                }

                for (const d of pendingDiffs) {
                  diffFiles.push(d)
                  yield { event: 'diff_file', data: d }
                }
                if (!fullContent) {
                  fullContent = `## ${args.plan || 'File Changes'}\n\n**${diffFiles.length} file(s) ready for review:**\n`
                  for (const df of diffFiles) {
                    const icon = df.action === 'create' ? '+' : '~'
                    fullContent += `- \`${icon}\` **${df.path}** — ${df.description || 'Generated'}\n`
                  }
                  if (args.summary) fullContent += `\n**Summary:** ${args.summary}`
                  yield { event: 'token', data: { content: fullContent } }
                }
              } else if (toolName === 'delete_files') {
                yield { event: 'status', data: { stage: 'generating_diffs', detail: `Building delete diffs for ${args.files?.length || 0} file(s)...` } }
                for (const file of (args.files || [])) {
                  const existing = findExisting(file.path)
                  const diffEntry = {
                    path: file.path,
                    action: 'delete',
                    newContent: null,
                    oldContent: existing?.content || null,
                    description: file.reason || 'Deleted',
                    fileType: existing?.file_type || detectFileType(file.path),
                  }
                  diffFiles.push(diffEntry)
                  yield { event: 'diff_file', data: diffEntry }
                }

                if (!fullContent) {
                  fullContent = formatDeleteSummary(diffFiles, args)
                  yield { event: 'token', data: { content: fullContent } }
                }
              } else if (toolName === 'plan_project') {
                planOutput = args
                if (!fullContent) {
                  fullContent = formatPlanResponse(args)
                  yield { event: 'token', data: { content: fullContent } }
                }
              } else if (toolName === 'summarize_project') {
                if (!fullContent) {
                  fullContent = formatSummaryResponse(args)
                  yield { event: 'token', data: { content: fullContent } }
                }
              }
            } catch (toolErr) {
              console.error('[AIService] Tool call parse error:', toolErr.message)
            }
          }
        }
      }

      // Try parsing files from response text if no tool calls (skip in plan mode)
      if (!usePlanMode && diffFiles.length === 0 && generatedFiles.length === 0 && toolMode !== 'chat_only') {
        const parsed = tryParseFilesFromResponse(fullContent)
        if (parsed.files?.length > 0) {
          yield { event: 'status', data: { stage: 'generating_diffs', detail: `Found ${parsed.files.length} file(s) in response, building diffs...` } }
          const candidateDiffs = []
          for (const file of parsed.files) {
            const existing = findExisting(file.path)
            candidateDiffs.push({
              path: file.path,
              action: existing ? 'update' : 'create',
              newContent: file.content,
              oldContent: existing?.content || null,
              description: file.description || '',
              fileType: file.file_type || detectFileType(file.path),
            })
          }

          const patchResult = validatePatchGrounding(candidateDiffs, filesByPath, proposedPlan)
          if (!patchResult.valid) {
            console.log('[PatchGroundingValidator] Text-parsed diffs rejected:', JSON.stringify({ errors: patchResult.errors }))
            logPlanEvent({
              projectId, chatId, userId, userTask: userMessage,
              taskMode: 'patch_grounding_rejected',
              validatorResult: { valid: false, errors: patchResult.errors, warnings: [], mode: 'patch_grounding_rejected' },
              planHash: proposedPlan ? hashPlan(proposedPlan) : null,
              rejectionReasons: patchResult.errors,
              fileActions: candidateDiffs.map(d => ({ action: d.action, path: d.path })),
            }).catch(() => {})
            yield { event: 'status', data: { stage: 'patch_grounding_failed', detail: `Patch rejected: ${patchResult.errors.join('; ')}` } }
            fullContent = `## Patch Rejected\n\n${patchResult.errors.map(e => '- ' + e).join('\n')}\n\n*Please try again with a more specific prompt.*`
            yield { event: 'token', data: { content: fullContent } }
          } else {
            for (const d of candidateDiffs) {
              diffFiles.push(d)
              yield { event: 'diff_file', data: d }
            }
          }
        }
      }

      const hasDiffs = diffFiles.length > 0

      // Precompute fileActions for logging — prefer plan, fallback to diffFiles
      const loggedFileActions =
        proposedPlan?.file_actions?.length
          ? proposedPlan.file_actions
          : Array.isArray(diffFiles) && diffFiles.length
            ? diffFiles.map(d => ({ action: d.action, path: d.path }))
            : null

      // ── Request-Mode Output Validation (with one retry) ──
      if (requestMode !== 'plan_patch') {
        const outputSignals = {
          hasProposedPlan: !!proposedPlan,
          hasFileActions: !!(proposedPlan?.file_actions?.length > 0),
          hasFileContent: diffFiles.some(d => d.newContent),
          hasDiffFiles: hasDiffs,
        }
        const rmResult = validateRequestModeOutput(requestMode, outputSignals)
        if (!rmResult.valid) {
          console.log('[RequestModeGate] Output violation (attempt 1):', JSON.stringify({
            request_mode: requestMode,
            actual_output_type: proposedPlan ? 'proposed_plan' : hasDiffs ? 'diff_files' : 'text',
            rejection_reason: rmResult.errors,
          }))

          // ── Retry once with strict correction prompt ──
          yield { event: 'status', data: { stage: 'request_mode_retry', detail: 'Output violated mode contract, retrying...' } }
          const correctionMessages = [
            ...messages,
            { role: 'assistant', content: fullContent },
            { role: 'user', content: `SYSTEM OVERRIDE: Your previous response violated the "${requestMode}" mode contract. You MUST NOT produce file_actions, file contents, diffs, or a Proposed Plan. Return ONLY a plain text report. Do NOT use any file tools. Respond now.` },
          ]

          let retryContent = ''
          for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(correctionMessages, { temperature: 0.5, max_tokens: 4096 }))) {
            if (chunk.type === 'status') {
              yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
            } else if (chunk.type === 'token') {
              retryContent += chunk.content
            }
          }

          // Validate retry (text-only stream → signals all false)
          const retrySignals = { hasProposedPlan: false, hasFileActions: false, hasFileContent: false, hasDiffFiles: false }
          const retryResult = validateRequestModeOutput(requestMode, retrySignals)

          if (!retryResult.valid) {
            // Retry also failed — structured error
            console.log('[RequestModeGate] Output violation (attempt 2 — final):', JSON.stringify({
              request_mode: requestMode,
              actual_output_type: 'text',
              rejection_reason: retryResult.errors,
            }))
            logPlanEvent({
              projectId, chatId, userId, userTask: userMessage,
              taskMode: 'request_mode_rejected',
              validatorResult: retryResult,
              rejectionReasons: retryResult.errors,
              planSummary: proposedPlan?.summary || null,
              fileActions: loggedFileActions,
            }).catch(() => {})
            fullContent = `## Request Mode Violation\n\nRequest classified as \`${requestMode}\` but the AI could not produce a compliant response after retry.\n\n${retryResult.errors.map(e => '- ' + e).join('\n')}\n\n*Please rephrase your request.*`
            yield { event: 'token', data: { content: fullContent } }
            yield { event: 'done', data: { content: fullContent, toolMode: 'request_mode_rejected', scope: effectiveScope, intent, runId, provider: this.providerName, model: this.modelName } }
            return
          }

          // Retry succeeded — log original violation and use retry output
          logPlanEvent({
            projectId, chatId, userId, userTask: userMessage,
            taskMode: 'request_mode_retried',
            validatorResult: rmResult,
            rejectionReasons: rmResult.errors,
            planSummary: proposedPlan?.summary || null,
            fileActions: loggedFileActions,
          }).catch(() => {})
          fullContent = retryContent
          proposedPlan = null
          diffFiles = []
          yield { event: 'token', data: { content: retryContent } }
        }
      }

      // 10. Update canvas (skip when diffs are pending review or plan mode)
      let canvasUpdated = false
      if (!proposedPlan && !hasDiffs) {
        try {
          yield { event: 'status', data: { stage: 'updating_canvas', detail: 'Updating project knowledge...' } }
          canvasUpdated = await this.updateCanvasFromExchange(projectId, userMessage, fullContent, generatedFiles, planOutput)
        } catch (canvasErr) {
          console.error('[AIService] Canvas update failed:', canvasErr.message)
        }
      }

      // 11. Index for search
      try {
        await this.indexForSearch(projectId, chatId, userMessage, fullContent, generatedFiles)
      } catch {}

      // 12. Log run
      const effectiveToolMode = proposedPlan ? 'plan_proposed' : hasDiffs ? 'diff_generated' : toolMode
      yield { event: 'status', data: { stage: hasDiffs ? 'diff_ready' : 'complete', detail: proposedPlan ? 'Plan proposed — awaiting approval' : hasDiffs ? `${diffFiles.length} file(s) ready for review` : 'Generation complete' } }
      await this.logGenerationRun({
        id: runId, project_id: projectId, chat_id: chatId, user_id: userId,
        tool_mode: effectiveToolMode, files_generated: generatedFiles.length + diffFiles.length,
        duration: Date.now() - startTime, success: true,
        provider: this.providerName, model: this.modelName,
      })

      // Record prompt run for adaptive learning
      if (projectId) {
        try {
          const { recordPromptRun } = await import('@/lib/ai/prompt-library')
          await recordPromptRun(projectId, {
            prompt_text: userMessage.slice(0, 500),
            provider: this.providerName,
            model: this.modelName,
            intent,
            success: true,
            duration_ms: Date.now() - startTime,
          })
        } catch {}
      }

      // Log execute event when diffs are generated (diffStatus='pending')
      if (hasDiffs) {
        logPlanEvent({
          projectId, chatId, userId,
          userTask: userMessage,
          taskMode: 'execute',
          contextPaths: groundedFileContext?.files?.map(f => f.path) || [],
          validatorResult: { valid: true, errors: [], warnings: [], mode: 'diffs_pending' },
          planHash: proposedPlan ? hashPlan(proposedPlan) : null,
          planSummary: proposedPlan?.summary || null,
          fileActions: loggedFileActions,
          constraintsChecked: proposedPlan?.constraints_checked || null,
        }).catch(() => {})
      }

            // 13. Done event with metadata
      yield {
        event: 'done',
        data: {
          content: fullContent,
          files: generatedFiles.map(f => ({ path: f.path, action: f.action, id: f.id })),
          diffFiles: hasDiffs ? diffFiles : null,
          planId: proposedPlan ? crypto.randomUUID() : null,
          planStatus: proposedPlan ? 'proposed' : null,
          diffId: hasDiffs ? crypto.randomUUID() : null,
          diffStatus: hasDiffs ? 'pending' : null,
          plan: planOutput,
          proposedPlan: proposedPlan || null,
          toolMode: effectiveToolMode,
          scope: effectiveScope,
          intent,
          runId,
          provider: this.providerName,
          model: this.modelName,
          canvasUpdated,
          fsStats: fsContext
            ? {
                scanned: fsContext.scannedCount,
                read: fsContext.readCount,
                matched: fsContext.matchedCount,
              }
            : null
        }
      }
    } catch (error) {
      console.error('[AIService] Stream error:', error)
      await this.logGenerationRun({
        id: runId,
        project_id: projectId,
        chat_id: chatId,
        user_id: userId,
        tool_mode: 'error',
        files_generated: 0,
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
        provider: this.providerName,
        model: this.modelName,
      })
       yield {
        event: 'error',
        data: {
          message: error.user_message || error.message,
          error_type: error.error_type || 'unknown',
          provider: error.provider || this.providerName,
          model: error.model || this.modelName
        }
      }
    }
  }

  /**
   * Execute an approved plan — generate diffs for review (don't write files yet)
   */
  async *executePlanStream({ projectId, chatId, userMessage, userId, scope, designPrefs, planData, runId, startTime, selfEditTarget }) {
    try {
      // Defense-in-depth: validate planData before executing
      const validationResult = validatePlan(planData, null, null, userMessage, { allowedPathPrefix: selfEditTarget?.path || null })
      if (!validationResult.valid) {
        console.log('[executePlanStream] Plan rejected:', validationResult.errors)
        yield { event: 'status', data: { stage: 'plan_validation_failed', detail: `Plan rejected: ${validationResult.errors.join('; ')}` } }
        yield { event: 'error', data: { message: `Invalid plan: ${validationResult.errors.join('; ')}` } }
        return
      }

      yield { event: 'status', data: { stage: 'executing_plan', detail: 'Generating file changes for review...' } }

      // Load context for the AI to generate actual file contents
      const context = await this.loadScopedContext(projectId, chatId, userId, scope || 'project')

      // Build filesystem context
      let fsContext = null
      try {
        fsContext = await buildFilesystemContext(projectId, planData.intent || 'build', userMessage)
      } catch {}

      // Build system message that instructs the AI to execute the plan exactly
      let systemMessage = formatContextAsSystemMessage(context, context.project?.type || 'app', 'project')

      if (fsContext) {
        const fsBlock = formatFilesystemContextBlock(fsContext)
        if (fsBlock) systemMessage += '\n\n' + fsBlock
      }

      // Design context
      let activeDesignPrefs = designPrefs
      if (!activeDesignPrefs && projectId) {
        try {
          const proj = await db.projects.findById(projectId)
          activeDesignPrefs = proj?.settings?.design_prefs || null
        } catch {}
      }
      const designBlock = formatDesignContextBlock(activeDesignPrefs)
      if (designBlock) systemMessage += '\n\n' + designBlock

      // Plan execution instructions
      const planSummary = planData.file_actions?.map(a => `- ${a.action}: ${a.path} — ${a.reason || a.description || ''}`).join('\n') || ''
      systemMessage += `\n\n## EXECUTE PLAN
The user has approved the following plan. Implement it exactly using the appropriate file tools (create_files, update_files, delete_files).

### Approved Plan Summary
${planData.summary}

### File Actions
${planSummary}

${planData.reasoning ? `### Reasoning\n${planData.reasoning}` : ''}

Execute ALL file actions listed above. Use create_files for new files, update_files for modifications, and delete_files for removals. Generate complete, production-ready code.`

      const messages = [
        { role: 'system', content: systemMessage },
        ...context.chat?.messages?.slice(-10).map(m => ({ role: m.role, content: m.content })) || [],
        { role: 'user', content: `Execute the approved plan: ${planData.summary}` }
      ]

      yield { event: 'status', data: { stage: 'generating', detail: 'Generating files from plan...' } }

      let fullContent = ''
      let toolCalls = []
      let diffFiles = []

      // Pre-load all project files for reliable existence checks (avoids path normalization issues)
      const allProjectFiles = await db.projectFiles.findByProjectId(projectId)
      const filesByPath = new Map()
      for (const f of allProjectFiles) {
        filesByPath.set(f.path, f)
        const norm = f.path.replace(/^\.\//, '').replace(/^\//, '')
        if (norm !== f.path) filesByPath.set(norm, f)
      }
      const findExisting = (path) => {
        const norm = path.replace(/^\.\//, '').replace(/^\//, '')
        return filesByPath.get(path) || filesByPath.get(norm) || null
      }

      // Build plan action hints: trust the plan's action labels for files not yet in DB
      const planActionHints = new Map()
      if (planData?.file_actions) {
        for (const fa of planData.file_actions) {
          if (fa.path) {
            const norm = fa.path.replace(/^\.\//, '').replace(/^\//, '')
            planActionHints.set(fa.path, fa.action)
            planActionHints.set(norm, fa.action)
          }
        }
      }
      const resolveAction = (path) => {
        const existing = findExisting(path)
        if (existing) return 'update'
        const norm = path.replace(/^\.\//, '').replace(/^\//, '')
        const hint = planActionHints.get(path) || planActionHints.get(norm)
        if (hint === 'update' || hint === 'modify') return 'update'
        return 'create'
      }

      // Use full AI_TOOLS (not plan-only) for execution
      for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, AI_TOOLS, { temperature: 0.7, max_tokens: 8192 }))) {
        if (chunk.type === 'status') {
          yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
        } else if (chunk.type === 'token') {
          fullContent += chunk.content
          yield { event: 'token', data: { content: chunk.content } }
        } else if (chunk.type === 'tool_calls') {
          toolCalls = chunk.tool_calls
        }
      }

      // ── Task-Mode Enforcement — patch mode ──
      {
        const taskMode = 'patch'
        const hasFileContent = toolCalls.some(tc => {
          try { return ['create_files', 'update_files'].includes(tc.function.name) } catch { return false }
        })
        const tmResult = validateTaskMode(taskMode, {
          hasFileActions: false,
          hasFileContent,
          hasGroundedContext: !!fsContext,
          diffStatus: null,
        })
        if (!tmResult.valid) {
          console.log('[TaskModeEnforcer] Rejected:', JSON.stringify({ event: 'task_mode_rejected', mode: taskMode, errors: tmResult.errors }))
          logPlanEvent({
            projectId, chatId, userId, userTask: userMessage,
            taskMode: 'task_mode_rejected',
            validatorResult: tmResult,
            rejectionReasons: tmResult.errors,
            planHash: planData ? hashPlan(planData) : null,
            planSummary: planData?.summary || null,
          }).catch(() => {})
          yield { event: 'status', data: { stage: 'task_mode_rejected', detail: `Patch mode violation: ${tmResult.errors.join('; ')}` } }
          fullContent = `## Patch Mode Violation\n\n${tmResult.errors.map(e => '- ' + e).join('\n')}`
          yield { event: 'token', data: { content: fullContent } }
          yield { event: 'done', data: { content: fullContent, toolMode: 'task_mode_rejected', scope: scope || 'project', intent: planData.intent || 'build', runId, provider: this.providerName, model: this.modelName } }
          return
        }
      }

      // Process tool calls — generate diffs instead of writing files
      if (toolCalls.length > 0) {
        yield { event: 'status', data: { stage: 'generating_diffs', detail: 'Building diff preview...' } }
        for (const toolCall of toolCalls) {
          try {
            const args = JSON.parse(toolCall.function.arguments)
            const toolName = toolCall.function.name

            if (toolName === 'create_files' || toolName === 'update_files') {
              const { buildPendingDiffs } = await import('@/lib/self_builder/file_ops_bridge')
              const pendingDiffs = buildPendingDiffs(args.files, {
                planFileActions: planData?.file_actions,
                findExisting,
                toolName,
                detectFileType: (p) => detectFileType(p),
              })

              const patchResult = validatePatchGrounding(pendingDiffs, filesByPath, planData)
              if (!patchResult.valid) {
                console.log('[PatchGroundingValidator] Rejected:', JSON.stringify({ event: 'patch_grounding_rejected', errors: patchResult.errors }))
                logPlanEvent({
                  projectId, chatId, userId, userTask: userMessage,
                  taskMode: 'patch_grounding_rejected',
                  validatorResult: { valid: false, errors: patchResult.errors, warnings: [], mode: 'patch_grounding_rejected' },
                  planHash: planData ? hashPlan(planData) : null,
                  rejectionReasons: patchResult.errors,
                  planSummary: planData?.summary || null,
                  fileActions: pendingDiffs.map(d => ({ action: d.action, path: d.path })),
                }).catch(() => {})
                yield { event: 'status', data: { stage: 'patch_grounding_failed', detail: `Patch rejected: ${patchResult.errors.join('; ')}` } }
                fullContent = `## Patch Rejected\n\n${patchResult.errors.map(e => '- ' + e).join('\n')}\n\n*Please try again with a more specific prompt.*`
                yield { event: 'token', data: { content: fullContent } }
                continue
              }

              for (const d of pendingDiffs) {
                diffFiles.push(d)
                yield { event: 'diff_file', data: d }
              }
            } else if (toolName === 'delete_files') {
              for (const file of (args.files || [])) {
                const existing = findExisting(file.path)
                const diffEntry = {
                  path: file.path,
                  action: 'delete',
                  newContent: null,
                  oldContent: existing?.content || null,
                  description: file.reason || 'Deleted',
                  fileType: existing?.file_type || detectFileType(file.path),
                }
                diffFiles.push(diffEntry)
                yield { event: 'diff_file', data: diffEntry }
              }
            }
          } catch (toolErr) {
            console.error('[AIService] Tool call parse error:', toolErr.message)
          }
        }
      }

      // Try parsing files from response text if no tool calls produced diffs
      if (diffFiles.length === 0) {
        const parsed = tryParseFilesFromResponse(fullContent)
        if (parsed.files?.length > 0) {
          const candidateDiffs = []
          for (const file of parsed.files) {
            const existing = findExisting(file.path)
            candidateDiffs.push({
              path: file.path,
              action: resolveAction(file.path),
              newContent: file.content,
              oldContent: existing?.content || null,
              description: file.description || '',
              fileType: file.file_type || detectFileType(file.path),
            })
          }

          const patchResult = validatePatchGrounding(candidateDiffs, filesByPath, planData)
          if (!patchResult.valid) {
            console.log('[PatchGroundingValidator] Text-parsed diffs rejected:', JSON.stringify({ errors: patchResult.errors }))
            logPlanEvent({
              projectId, chatId, userId, userTask: userMessage,
              taskMode: 'patch_grounding_rejected',
              validatorResult: { valid: false, errors: patchResult.errors, warnings: [], mode: 'patch_grounding_rejected' },
              planHash: planData ? hashPlan(planData) : null,
              rejectionReasons: patchResult.errors,
              fileActions: candidateDiffs.map(d => ({ action: d.action, path: d.path })),
            }).catch(() => {})
            yield { event: 'status', data: { stage: 'patch_grounding_failed', detail: `Patch rejected: ${patchResult.errors.join('; ')}` } }
            fullContent = `## Patch Rejected\n\n${patchResult.errors.map(e => '- ' + e).join('\n')}\n\n*Please try again with a more specific prompt.*`
            yield { event: 'token', data: { content: fullContent } }
          } else {
            for (const d of candidateDiffs) {
              diffFiles.push(d)
              yield { event: 'diff_file', data: d }
            }
          }
        }
      }

      if (!fullContent && diffFiles.length > 0) {
        fullContent = `## Diff Preview\n\n${diffFiles.length} file(s) ready for review.\n`
        for (const df of diffFiles) {
          const icon = df.action === 'create' ? '+' : df.action === 'delete' ? '-' : '~'
          fullContent += `- \`${icon}\` **${df.path}** — ${df.description}\n`
        }
        yield { event: 'token', data: { content: fullContent } }
      }

      // Log run
      yield { event: 'status', data: { stage: 'diff_ready', detail: `${diffFiles.length} file(s) ready for review` } }
      await this.logGenerationRun({
        id: runId, project_id: projectId, chat_id: chatId, user_id: userId,
        tool_mode: 'diff_generated', files_generated: diffFiles.length,
        duration: Date.now() - startTime, success: true,
        provider: this.providerName, model: this.modelName,
      })

      // Log execute event when diffs are generated (diffStatus='pending')
      if (diffFiles.length > 0) {
        logPlanEvent({
          projectId, chatId, userId,
          userTask: userMessage,
          taskMode: 'execute',
          contextPaths: fsContext?.files?.map(f => f.path) || [],
          validatorResult: { valid: true, errors: [], warnings: [], mode: 'diffs_pending' },
          planHash: planData ? hashPlan(planData) : null,
          planSummary: planData?.summary || null,
          fileActions: diffFiles.map(d => ({ action: d.action, path: d.path })),
          constraintsChecked: planData?.constraints_checked || null,
        }).catch(() => {})
      }

      yield {
        event: 'done',
        data: {
          content: fullContent,
          diffFiles,
          diffId: diffFiles.length > 0 ? crypto.randomUUID() : null,
          diffStatus: diffFiles.length > 0 ? 'pending' : null,
          toolMode: 'diff_preview',
          scope: scope || 'project', intent: planData.intent || 'build', runId,
          provider: this.providerName, model: this.modelName,
          planData,
          planId: planData?._planId || null,
        }
      }
    } catch (error) {
      console.error('[AIService] Plan execution error:', error)
      yield { event: 'error', data: { message: error.user_message || error.message, error_type: error.error_type || 'unknown', provider: error.provider || this.providerName, model: error.model || this.modelName } }
    }
  }

  /**
   * Apply approved diffs — write files, create snapshot, log events
   */
  async applyDiffs(projectId, chatId, userId, approvedFiles, planData) {
    const results = { snapshot: null, written: [], skipped: [], deleted: [], errors: [] }

    // 1. Create snapshot of current state BEFORE applying
    try {
      const currentFiles = await db.projectFiles.findByProjectId(projectId)
      const canvas = await db.projectCanvas.findByProjectId(projectId)
      results.snapshot = await db.snapshots.create({
        project_id: projectId,
        name: `Pre-diff: ${planData?.summary?.slice(0, 60) || 'Diff apply'}`,
        files_snapshot: currentFiles.map(f => ({ path: f.path, content: f.content, file_type: f.file_type })),
        canvas_snapshot: canvas?.canvas_content || null,
      })
    } catch (snapErr) {
      console.error('[AIService] Snapshot creation failed:', snapErr.message)
    }

    // 2. Apply each approved file atomically via safe_apply
    const { safeApplyDiffs } = await import('@/lib/self_builder/safe_apply')
    const applyResult = await safeApplyDiffs(projectId, approvedFiles, detectFileType, { chatId, userId })
    results.written = applyResult.written
    results.deleted = applyResult.deleted
    results.errors = applyResult.errors
    results.rolledBack = applyResult.rolledBack || false
    results.rollbackDetails = applyResult.rollbackDetails || null
    results.diffStatusTransitioned = applyResult.diffStatusTransitioned || null
    if (applyResult.rolledBack) {
      console.log(`[AIService] Diffs rolled back due to error: ${applyResult.errors.join('; ')}`)
    }

    // 3. Invalidate cache and update project timestamp
    if (results.written.length > 0 || results.deleted.length > 0) {
      invalidateCache(projectId)
      await db.projects.update(projectId, { updated_at: new Date().toISOString() })
    }

    // 4. Update canvas
    try {
      const userMsg = planData?.summary || 'Applied diffs'
      const responseMsg = `Applied ${results.written.length} file(s), deleted ${results.deleted.length} file(s)`
      await this.updateCanvasFromExchange(projectId, userMsg, responseMsg, results.written.map(p => ({ path: p })), null)
    } catch {}

    return results
  }

  /**
   * Process a user message and generate a response (non-streaming)
   */
  async processMessage({ projectId, chatId, userMessage, userId, scope: requestedScope }) {
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
          { temperature: 0.7, max_tokens: 8192 }
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

  /**
   * Load context based on scope
   */
  async loadScopedContext(projectId, chatId, userId, scope) {
    if (scope === 'platform') {
      return this.loadPlatformContext(chatId)
    }
    if (scope === 'workspace') {
      return this.loadWorkspaceContext(projectId, chatId, userId)
    }
    return this.loadContext(projectId, chatId)
  }

  /**
   * Platform scope: only chat history + platform knowledge (injected via system message)
   */
  async loadPlatformContext(chatId) {
    const [chat, messages] = await Promise.all([
      db.chats.findById(chatId),
      db.messages.findByChatId(chatId),
    ])
    const compressedMessages = compressContext(messages)
    return {
      project: null,
      chat: chat ? { id: chat.id, title: chat.title, messages: compressedMessages.slice(-MAX_RECENT_MESSAGES).map(m => ({ role: m.role, content: m.content, created_at: m.created_at })) } : null,
      files: [],
      canvas: null,
    }
  }

  /**
   * Workspace scope: cross-project data for the user
   */
  async loadWorkspaceContext(projectId, chatId, userId) {
    const [chat, messages, userProjects] = await Promise.all([
      db.chats.findById(chatId),
      db.messages.findByChatId(chatId),
      db.projects.findByUserId(userId),
    ])
    const compressedMessages = compressContext(messages)

    // Gather cross-project data (limited)
    const projectSummaries = []
    const allFiles = []
    const allCanvas = []

    for (const proj of (userProjects || []).slice(0, 20)) {
      const [files, canvasDoc] = await Promise.all([
        db.projectFiles.findByProjectId(proj.id),
        db.projectCanvas.findByProjectId(proj.id),
      ])
      projectSummaries.push({ ...proj, file_count: files?.length || 0 })
      if (files?.length) {
        for (const f of files.slice(0, 5)) {
          allFiles.push({ ...f, project_name: proj.name })
        }
      }
      if (canvasDoc?.canvas_content) {
        allCanvas.push({
          project_name: proj.name,
          overview: canvasDoc.canvas_content.project_overview || null,
        })
      }
    }

    return {
      project: null,
      chat: chat ? { id: chat.id, title: chat.title, messages: compressedMessages.slice(-MAX_RECENT_MESSAGES).map(m => ({ role: m.role, content: m.content, created_at: m.created_at })) } : null,
      files: [],
      canvas: null,
      workspaceProjects: projectSummaries,
      workspaceFiles: allFiles,
      workspaceCanvas: allCanvas,
    }
  }

  async loadContext(projectId, chatId) {
    const [project, chat, messages, files, canvasDoc, memory] = await Promise.all([
      db.projects.findById(projectId),
      db.chats.findById(chatId),
      db.messages.findByChatId(chatId),
      db.projectFiles.findByProjectId(projectId),
      db.projectCanvas.findByProjectId(projectId),
      db.projectMemory.findByProjectId(projectId)
    ])

    // Context compression: trim old messages if too many
    const compressedMessages = compressContext(messages)

    return assembleContext({
      project,
      chat,
      messages: compressedMessages,
      files,
      canvas: canvasDoc?.canvas_content,
      memory
    })
  }

  /**
   * Context compression — keep recent messages, summarize old ones
   */
  async saveFiles(projectId, files, isUpdate) {
    const savedFiles = []

    // Validate operations before applying
    try {
      const operations = files.map(f => ({
        action: isUpdate ? 'update' : 'create',
        path: f.path,
      }))
      const validation = await validateFileOperations(projectId, operations)
      if (validation.warnings.length > 0) {
        console.warn('[AIService] File operation warnings:', validation.warnings)
      }
    } catch (valErr) {
      console.error('[AIService] Validation error:', valErr.message)
    }

    for (const file of files) {
      try {
        const existing = await db.projectFiles.findByPath(projectId, file.path)

        if (existing) {
          const updated = await db.projectFiles.update(existing.id, {
            content: file.content,
            version: existing.version + 1,
            change_source: 'ai_generation'
          })

          await db.fileChangeEvents.create({
            project_id: projectId,
            file_id: existing.id,
            file_path: file.path,
            action: 'update',
            changes: file.changes || file.description
          })

          savedFiles.push({ ...updated, action: 'updated', description: file.description || file.changes })
        } else {
          const newFile = await db.projectFiles.create({
            project_id: projectId,
            path: file.path,
            content: file.content,
            file_type: file.file_type || detectFileType(file.path),
            version: 1,
            change_source: 'ai_generation'
          })

          await db.fileChangeEvents.create({
            project_id: projectId,
            file_id: newFile.id,
            file_path: file.path,
            action: 'create',
            changes: file.description
          })

          savedFiles.push({ ...newFile, action: 'created', description: file.description })
        }
      } catch (fileErr) {
        console.error(`[AIService] Failed to save file ${file.path}:`, fileErr.message)
      }
    }

    if (savedFiles.length > 0) {
      await db.projects.update(projectId, { updated_at: new Date().toISOString() })
      // Invalidate filesystem cache so next request sees updated tree
      invalidateCache(projectId)
    }

    // VERIFICATION: confirm files exist in DB
    for (const file of savedFiles) {
      const check = await db.projectFiles.findByPath(projectId, file.path)
      if (!check) {
        console.error(`[AIService] VERIFICATION FAILED: File ${file.path} not found after save`)
      }
    }

    return savedFiles
  }

  /**
   * Delete files from the project (for refactoring)
   */
  async deleteFiles(projectId, files) {
    const deleted = []
    for (const file of files) {
      try {
        const existing = await db.projectFiles.findByPath(projectId, file.path)
        if (existing) {
          await db.fileChangeEvents.create({
            project_id: projectId,
            file_id: existing.id,
            file_path: file.path,
            action: 'delete',
            changes: file.reason || 'Deleted by AI refactor'
          })
          await db.projectFiles.delete(existing.id)
          deleted.push({ path: file.path, reason: file.reason })
        }
      } catch (err) {
        console.error(`[AIService] Failed to delete file ${file.path}:`, err.message)
      }
    }
    if (deleted.length > 0) {
      invalidateCache(projectId)
    }
    return deleted
  }


  /**
   * Update canvas after exchange — FIXED: always updates, logs errors
   */
  async updateCanvasFromExchange(projectId, userMessage, response, files, plan) {
    let canvasDoc = await db.projectCanvas.findByProjectId(projectId)

    if (!canvasDoc) {
      canvasDoc = await db.projectCanvas.create({
        project_id: projectId,
        canvas_content: { ...EMPTY_CANVAS_CONTENT }
      })
    }

    const insights = extractInsights(userMessage, response, files, plan)
    const { canvas, changed, changeSummary } = applyInsightsToCanvas(
      canvasDoc.canvas_content,
      insights,
      { files, providerTag: `${this.providerName}/${this.modelName}`, userMessage }
    )

    if (changed) {
      await db.projectCanvas.update(projectId, canvas)
      await db.canvasEvents.create({ project_id: projectId, change_summary: changeSummary })

      const verify = await db.projectCanvas.findByProjectId(projectId)
      if (!verify || !verify.canvas_content) {
        console.error('[AIService] CANVAS VERIFICATION FAILED: Canvas not found after update')
        return false
      }
    }

    return changed
  }

  async indexForSearch(projectId, chatId, userMessage, response, files) {
    const entries = buildSearchEntries(projectId, chatId, response, files)
    if (entries.length > 0) {
      await db.searchIndex.bulkInsert(entries)
    }
  }

  async logGenerationRun(data) {
    try {
      await db.generationRuns.create(sanitizeLogPayload(data))
    } catch (error) {
      console.error('[AIService] Failed to log run:', error.message)
    }
  }

  /**
   * Process image generation — detect intent, parse opts, close stream fast.
   * Actual image generation is done by the frontend calling POST /api/projects/{id}/generate-image.
   * This avoids the ~60s proxy timeout killing the SSE stream.
   */
  async *processImageGeneration({ projectId, chatId, userMessage, userId, intent, workflow, runId, startTime }) {
    try {
      // Hard guard: block image generation if prompt contains explicit BUILD intent or code/architecture signals
      const buildIntentGuard = /\bINTENT:\s*BUILD\b/i
      const codeSignals = /\.(js|jsx|ts|tsx|mjs)\b|\b(route\.js|Dashboard\.jsx|server\.js|constants\.js|intents\.js|service\.js)\b|\b(lib|app|src|components|api|hooks|services)\s*[/\\]|\b(router|handler|validator|planner|changelog|file_actions|middleware|endpoint|pipeline|rollback|snapshot|sandbox|promote|diff)\b/i
      if (buildIntentGuard.test(userMessage) || codeSignals.test(userMessage)) {
        console.warn('[AIService] Image generation blocked — BUILD intent or code/architecture prompt detected')
        yield { event: 'token', data: { content: userMessage } }
        yield { event: 'done', data: { content: userMessage, toolMode: 'build', intent: 'build', runId, provider: this.providerName, model: this.modelName } }
        return
      }

      // Determine mode and parse sprite opts from message
      let mode = workflow.imageMode || 'image'
      let spriteOpts = null
      let prompt = userMessage

      if (intent === 'sprite_generation' || /\bsprite\b/i.test(userMessage)) {
        mode = 'sprite'
        spriteOpts = parseSpriteOpts(userMessage)
      } else if (userMessage.match(/icon/i)) {
        mode = 'icon'
        spriteOpts = parseIconOpts(userMessage)
      } else if (userMessage.match(/background|scene|environment|landscape/i)) {
        mode = 'background'
      } else if (userMessage.match(/prop|item|object|weapon|tool/i)) {
        mode = 'props'
      }

      // Follow-up / variation detection — enhanced for natural language follow-ups
      const variationPatterns = [
        /\b(variation|variant|same\s+style|similar|like\s+(the\s+)?last|another|redo|again|modify|tweak|adjust)\b/i,
        /\bdifferent\s+(pose|color|action|style|angle|view|background)\b/i,
        /\buse\s+the\s+(last|previous|uploaded|reference)\b/i,
        /\bsame\s+(character|style|look|design|outfit)\b/i,
        /\bpreserve\s+(the\s+)?(style|character|look|design|palette)\b/i,
        /\b(pose|state)\s+variations?\b/i,
        /\b(idle|walk|run|jump|attack|hurt|celebrate|crouch)\s+(version|state|animation|pose)\b/i,
        /\bmake\s+\d+\s+(pose|style|color)\s+variations?\b/i,
        /\bcreate\s+(idle|walk|run|jump|attack).*\b(versions?|states?)\b/i,
      ]
      const isVariation = variationPatterns.some(p => p.test(userMessage))

      let variationContext = null
      if (isVariation && projectId) {
        try {
          const allFiles = await db.projectFiles.findByProjectId(projectId)
          const generatedImages = allFiles
            .filter(f => f.path?.startsWith('_generated/'))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

          // Check if user mentions "uploaded" reference
          const wantsUploadedRef = /\b(uploaded|upload)\s*(reference|image|ref)\b/i.test(userMessage)
          let refImage = null
          if (wantsUploadedRef) {
            refImage = allFiles.find(f => f.path?.startsWith('_uploads/') && f.file_type === 'image')
          }
          if (!refImage && generatedImages.length > 0) {
            refImage = generatedImages[0]
          }

          if (refImage) {
            const refName = refImage.path.replace(/^_(?:generated|uploads)\//, '')
            prompt = `${userMessage}\n\n[REFERENCE: This is a follow-up/variation request. The reference image is "${refName}" at path "${refImage.path}". Maintain similar style, color palette, and composition unless explicitly asked to change.]`

            // Build variation metadata for the generation pipeline
            variationContext = {
              variationType: /\bpose\b/i.test(userMessage) ? 'pose_variation'
                : /\baction|state\b/i.test(userMessage) ? 'action_variation'
                : /\bstyle\b/i.test(userMessage) ? 'style_variation'
                : /\bcolor|palette\b/i.test(userMessage) ? 'color_variation'
                : /\bicon\b/i.test(userMessage) ? 'icon_variant'
                : /\bsprite|idle|walk|run|jump\b/i.test(userMessage) ? 'sprite_states'
                : /\bbackground|scene\b/i.test(userMessage) ? 'background_variation'
                : 'pose_variation',
              sourceImage: { id: refImage.id, path: refImage.path },
              references: [{ id: refImage.id, path: refImage.path, role: 'character' }],
              locks: ['preserve_style'],
            }
          }
        } catch {}
      }

      // Emit intent with all info the frontend needs to call generate-image endpoint
      yield { event: 'image_intent', data: {
        projectId,
        chatId,
        prompt,
        mode,
        spriteOpts,
        size: '1024x1024',
        intent,
        variation: variationContext || undefined,
      }}

      // Close stream immediately — content placeholder
      const content = `Generating ${mode}...`
      yield { event: 'token', data: { content } }
      yield { event: 'done', data: {
        content,
        toolMode: 'image_gen',
        intent,
        runId,
        provider: 'openai',
        model: process.env.OPENAI_MODEL_IMAGE || 'gpt-image-1',
        imageGenerationPending: true,
      }}
    } catch (error) {
      console.error('[AIService] Image intent error:', error)
      yield { event: 'error', data: {
        message: error.message || 'Image generation failed',
        error_type: 'image_generation_error',
        provider: 'openai',
      }}
    }
  }
}
