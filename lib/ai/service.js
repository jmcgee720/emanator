import { createProvider } from './providers/index.js'
import { assembleContext, formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS, detectToolMode, PLAN_ONLY_TOOLS } from './tools.js'
import { classifyIntent, getIntentWorkflow, getIntentSystemAddendum, shouldUsePlanMode, resolveTaskMode, classifyRequestMode, detectTaskMode, isSimpleFrontendEdit, isRefinementRequest, findMainPagePath, isProceedSignal, isLargeAppBuild } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache, validateFileOperations } from './filesystem.js'
import { formatDesignContextBlock, getLayoutPatternForPrompt, getComponentPatternsForPrompt } from './design-system.js'
import { ProviderError } from './errors.js'
import { loadFileContext, buildGroundedPromptBlock, extractTargetPaths } from './file-context-loader.js'
import { validatePlan, hashPlan, validatePatchGrounding, validateTaskMode, validateRequestModeOutput } from './plan-validator.js'
import { logPlanEvent } from './changelog.js'
import { inspectToolCalls, detectFileType, tryParseFilesFromResponse, buildDeleteDiffs, parseSpriteOpts, parseIconOpts, formatPlanResponse, formatSummaryResponse, formatDiffSummary, formatDeleteSummary } from './tool-executor.js'
import { compressContext, classifyStreamError, extractInsights, sanitizeLogPayload, buildSearchEntries } from './stream-helpers.js'
import { EMPTY_CANVAS_CONTENT, applyInsightsToCanvas, buildFilesSummaryText, buildErrorLogData } from './post-process.js'
import { findPendingDiffMessage, buildApplyDiffContent, buildDiscardContent, buildVerifyPrompt, buildCompletenessPrompt, parseCompletenessSteps, buildContinuationData, buildApplyDoneData, buildDiscardDoneData } from './pending-diff.js'
import { parseApiCall, isRouteAllowed, executeInternalApi, PARSE_ERROR_CONTENT, buildDeniedContent, buildExecResultContent, buildExecDoneData } from './internal-api-exec.js'
import { detectImageCategories, hasVisualIntent, getStockPhotos, generateCustomImages, buildImagePromptContext } from './image-prefetch.js'
import { validateCodeCompleteness } from './code-validator.js'
import { extractFileCandidates, resolveFromProjectFiles, resolveFromFilesystem, buildInspectedContentsBlock, fsContextHasRequestedFile, buildReadOnlyDirective, cleanRefusalHistory, collectEmbeddedFiles, buildAugmentedUserMessage } from './read-only-report.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'

const MAX_RECENT_MESSAGES = 20

/**
 * Build a project grounding context block for injection into AI system prompts.
 * Provides the AI with the project identity and a strict file index so it never
 * hallucinates file paths that don't exist.
 */
async function buildProjectGroundingBlock(projectId) {
  if (!projectId) return null
  try {
    const [project, fileIndex] = await Promise.all([
      db.projects.findById(projectId),
      db.projectFiles.findIndexByProjectId(projectId),
    ])
    if (!project) return null

    const mode = project.settings?.is_core ? 'core' : 'project'
    const fileList = fileIndex.map(f => `  - ${f.path} (${f.file_type}, ${f.size} bytes)`).join('\n')

    console.log('[ProjectGrounding]', JSON.stringify({ projectId, name: project.name, mode, fileCount: fileIndex.length }))

    return `## PROJECT GROUNDING CONTEXT
PROJECT: ${project.name} (${project.id})
MODE: ${mode}
FILES IN PROJECT (${fileIndex.length} total):
${fileList || '  (no files yet)'}

RULES:
- You must ONLY reference files from the list above when discussing existing files.
- If you need to create a new file, explicitly state it is NEW and does not yet exist.
- Do NOT invent or hallucinate file paths that are not in this project's file index.
- When updating files, confirm the path matches an entry in the list above.`
  } catch (err) {
    console.warn('[ProjectGrounding] Failed to build context:', err.message)
    return null
  }
}

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

  static FALLBACK_MAP = {
    'gpt-4o':            { provider: 'openai',    model: 'gpt-4o-mini' },
    'o3':                { provider: 'openai',    model: 'gpt-4o' },
    'claude-sonnet-4-6': { provider: 'openai',    model: 'gpt-4o' },
    'claude-opus-4-6':   { provider: 'openai',    model: 'gpt-4o' },
    'claude-haiku-4-5':  { provider: 'openai',    model: 'gpt-4o-mini' },
  }

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
    const fb = AIService.FALLBACK_MAP[this.modelName]
    if (!fb || this._fellBack) return false
    console.warn(`[AIService] Falling back from ${this.providerName}/${this.modelName} → ${fb.provider}/${fb.model}`)
    this.providerName = fb.provider
    this.modelName = fb.model
    this.provider = this._buildProvider()
    this._fellBack = true
    return true
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

        // Try model fallback before giving up
        if (this._switchToFallback()) {
          console.warn(`[StreamRetry] Attempting fallback model ${this.providerName}/${this.modelName}`)
          try {
            for await (const chunk of makeStream()) {
              yield chunk
            }
            // Emit a metadata signal that fallback was used
            yield { event: '_fallback_used', data: { provider: this.providerName, model: this.modelName } }
            return
          } catch (fbErr) {
            console.error(`[StreamRetry] Fallback also failed: ${String(fbErr?.message || '').slice(0, 120)}`)
            lastErr = fbErr
          }
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
  async *processMessageStream({ projectId, chatId, userMessage, userId, scope: requestedScope, designPrefs, executePlan, attachments, selfEditTarget, visualMode }) {
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

      let requestMode = classifyRequestMode(userMessage, { hasPendingDiff })

      // ── Task Mode Gate ──
      // Detect system-wide task mode BEFORE any planning/build logic.
      // This is the single authoritative mode for the entire request pipeline.
      const taskMode = detectTaskMode(userMessage)
      console.log('[TaskModeGate]', JSON.stringify({ task_mode: taskMode, request_mode: requestMode, has_pending_diff: hasPendingDiff, projectId: projectId || null, message: userMessage?.slice(0, 120) }))

      // ── Config mode: handle and return early — never enter build pipeline ──
      if (taskMode === 'config') {
        yield { event: 'status', data: { stage: 'config_mode', detail: 'Processing configuration change...' } }

        // Load project context for the config response
        const configContext = await this.loadScopedContext(projectId, chatId, userId, 'project')
        let configSystemMsg = formatContextAsSystemMessage(configContext, configContext.project?.type || 'app', 'project')
        configSystemMsg += `\n\n## TASK MODE: CONFIG
You are in CONFIG mode. The user wants to change Emanator system behavior or settings.

RULES:
- ACKNOWLEDGE what the user wants to change
- EXPLAIN what the setting controls and its current state if you know it
- If the change requires editing Emanator host files, describe WHERE the change would go and WHAT to change — but do NOT produce file_actions, plans, or code blocks that would trigger the autonomous build pipeline
- If the change is a runtime preference (model selection, theme, etc.), confirm it and explain how it takes effect
- NEVER output file_actions, proposed plans, or "Ready to build" prompts
- NEVER continue into autonomous code generation after this response
- Keep the response focused on the configuration request only`

        const configMessages = [
          { role: 'system', content: configSystemMsg },
          ...configContext.chat?.messages?.map(m => ({ role: m.role, content: m.content })) || [],
          { role: 'user', content: userMessage }
        ]

        let configContent = ''
        for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(configMessages, { temperature: 0.3, max_tokens: 1024 }))) {
          if (chunk.type === 'token') {
            configContent += chunk.content
            yield { event: 'token', data: { content: chunk.content } }
          }
        }

        yield { event: 'done', data: { content: configContent, requestedScope, runId, providerName: this.providerName, modelName: this.modelName, taskMode: 'config' } }
        return
      }

      // ── Inspect mode: force read_only_report — no files, no plans, no build ──
      if (taskMode === 'inspect') {
        requestMode = 'read_only_report'
      }

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
            const content = `I couldn't discard those changes — ${discardResult.error}`
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

      // 6. Simple Frontend Direct-Edit detection
      // BLOCKED in inspect mode — inspect is strictly read-only
      let directEditMode = false
      let directEditTarget = null
      let directEditFileAction = null
      let directEditRetry = 0
      let refinementMode = false
      let refinementFileContent = null
      if (taskMode === 'build' && effectiveScope === 'project' && projectId && isSimpleFrontendEdit(userMessage)) {
        const earlyIndex = await db.projectFiles.findIndexByProjectId(projectId)
        directEditTarget = findMainPagePath(earlyIndex.map(f => f.path))
        directEditMode = true
        // Pre-compute which tool to force so we can set tool_choice later
        const existingFile = await db.projectFiles.findByPath(projectId, directEditTarget)
        directEditFileAction = existingFile ? 'update_files' : 'create_files'
        console.log('[DirectEdit]', JSON.stringify({ detected: true, target: directEditTarget, fileCount: earlyIndex.length, toolForced: directEditFileAction }))
        yield { event: 'status', data: { stage: 'direct_edit', detail: `Direct edit mode → ${directEditTarget}` } }
      }

      // 6a. Follow-up Refinement detection
      // If the project has a main page and the request is a visual/content/layout refinement,
      // route through direct-edit with the existing file content injected.
      if (taskMode === 'build' && effectiveScope === 'project' && projectId && !directEditMode) {
        const earlyIndex = await db.projectFiles.findIndexByProjectId(projectId)
        if (earlyIndex.length > 0 && isRefinementRequest(userMessage)) {
          const mainPage = findMainPagePath(earlyIndex.map(f => f.path))
          const existingFile = await db.projectFiles.findByPath(projectId, mainPage)
          if (existingFile && existingFile.content) {
            directEditMode = true
            refinementMode = true
            directEditTarget = mainPage
            directEditFileAction = 'update_files'
            refinementFileContent = existingFile.content
            console.log('[Refinement]', JSON.stringify({ detected: true, target: mainPage, contentLength: refinementFileContent.length }))
            yield { event: 'status', data: { stage: 'direct_edit', detail: `Refining ${mainPage}` } }
          }
        }
      }

      // 6b. Project Manager conversational mode
      // Only for genuinely large/complex app builds (full apps, multi-page, with auth/db).
      // Medium-safe builds (single pages, screens, dashboards) go straight to direct-edit.
      let projectManagerMode = false
      if (taskMode === 'build' && intent === 'build' && effectiveScope === 'project' && !directEditMode
          && isLargeAppBuild(userMessage) && !isProceedSignal(userMessage)) {
        projectManagerMode = true
        console.log('[ProjectManager] Large app detected — conversational mode')
      }

      // 7. Determine if plan-first mode applies
      // direct edit mode, project manager mode, and read_only_report force no plan
      const usePlanMode = directEditMode || projectManagerMode
        ? false
        : requestMode === 'read_only_report'
        ? false
        : requestMode === 'plan_only'
        ? true
        : requestMode === 'patch_only'
        ? false
        : (shouldUsePlanMode(intent) && effectiveScope === 'project')

      // 7b. Determine tool mode
      // Project manager mode uses chat_only — no tools, just conversation
      let toolMode = projectManagerMode
        ? 'chat_only'
        : requestMode === 'read_only_report'
        ? 'chat_only'
        : (effectiveScope !== 'project'
          ? 'chat_only'
          : workflow.toolMode)

      // 7c. Image Prefetch — detect visual needs and prepare image URLs for system prompt
      let prefetchedImageContext = ''
      let prefetchedImages = []
      const effectiveVisualMode = visualMode || 'stock' // default to stock
      if (effectiveScope === 'project' && (taskMode === 'build' || taskMode === 'refine_page' || taskMode === 'edit')) {
        const imageCategories = detectImageCategories(userMessage)
        const needsImages = imageCategories.length > 0 || hasVisualIntent(userMessage)

        if (needsImages) {
          const defaultCategories = imageCategories.length > 0 ? imageCategories : ['nature', 'abstract']

          if (effectiveVisualMode === 'custom') {
            // Premium tier: generate AI images
            yield { event: 'status', data: { stage: 'generating_images', detail: 'Generating custom images for your design...' } }
            try {
              const customImages = await generateCustomImages(this.provider, userMessage, defaultCategories, 3)
              if (customImages.length > 0) {
                prefetchedImages = customImages
                prefetchedImageContext = buildImagePromptContext(customImages, true)
                yield { event: 'status', data: { stage: 'images_ready', detail: `Generated ${customImages.length} custom image(s)` } }
              }
            } catch (err) {
              console.error('[ImagePrefetch] Custom generation failed, falling back to stock:', err.message)
              const stockImages = getStockPhotos(defaultCategories, 3)
              if (stockImages.length > 0) {
                prefetchedImages = stockImages
                prefetchedImageContext = buildImagePromptContext(stockImages, false)
              }
            }
          } else {
            // Stock tier: use curated Unsplash URLs
            yield { event: 'status', data: { stage: 'finding_images', detail: 'Finding images for your design...' } }
            const stockImages = getStockPhotos(defaultCategories, 6)
            if (stockImages.length > 0) {
              prefetchedImages = stockImages
              prefetchedImageContext = buildImagePromptContext(stockImages, false)
              yield { event: 'status', data: { stage: 'images_ready', detail: `Found ${stockImages.length} image(s)` } }
            }
          }
          // Store on instance for saveFiles post-processing
          this._prefetchedImages = prefetchedImages
        }
      }

      // 8. Build system message with filesystem context block
      let systemMessage = formatContextAsSystemMessage(
        context, context.project?.type || 'app', effectiveScope
      )
      const intentAddendum = getIntentSystemAddendum(intent, workflow, fsContext)
      if (intentAddendum) systemMessage += '\n\n' + intentAddendum

      // ── Grounding Injection: project identity + strict file index ──
      if (effectiveScope === 'project' && projectId) {
        const groundingBlock = await buildProjectGroundingBlock(projectId)
        if (groundingBlock) systemMessage += '\n\n' + groundingBlock
      }

      // ── Project Manager Mode: conversational persona ──
      if (projectManagerMode) {
        systemMessage += `\n\n## PROJECT MANAGER MODE

You are a friendly, expert project manager helping the user plan their project. The user has described what they want to build. Your job is to DISCUSS and PLAN — not to write code yet.

RESPOND WITH:
1. A warm, brief acknowledgment of what they want to build (1-2 sentences)
2. A clear, numbered PLAN OF ACTION in plain language — describe what you'll build and how, broken into phases or steps. Use everyday words. Example:
   - "Step 1: We'll create the main page with a form where you enter your income, deductions, and filing status"
   - "Step 2: We'll add the tax calculation engine that applies the current tax brackets"
   - "Step 3: We'll build a results dashboard showing your estimated taxes, refund, and breakdown"
3. Any quick clarifying questions (1-2 max) about their preferences or requirements
4. End with something like: "Want me to start building this, or would you like to adjust anything first?"

RULES:
- Do NOT use any tools. Do NOT generate code. Do NOT create files.
- Do NOT show file paths, component names, or technical architecture.
- Do NOT use developer jargon — no "React component", "API endpoint", "state management", "CRUD", etc.
- Write like you're talking to a smart friend who doesn't code.
- Keep it concise — the whole response should be under 300 words.
- Be specific to what they asked for — no generic filler.
- The plan should feel actionable and customizable — the user should feel they can say "change step 2" or "skip pricing".`
      }

      // ── Direct Edit Mode: single-file generation instructions ──
      if (directEditMode && directEditTarget) {
        const ext = directEditTarget.split('.').pop()
        const isHtml = ext === 'html'
        const fileAction = directEditFileAction || 'create_files'

        if (refinementMode && refinementFileContent) {
          // ── REFINEMENT MODE: edit existing page ──
          systemMessage += `\n\n## REFINEMENT MODE — Edit Existing Page
Target file: \`${directEditTarget}\` (use \`update_files\` tool)

You are EDITING an existing page file. The user wants to refine the current design — NOT regenerate from scratch.

### CURRENT FILE CONTENT:
\`\`\`${ext}
${refinementFileContent}
\`\`\`

### REFINEMENT RULES:
1. **Preserve the existing structure** — do NOT throw away the current page and start over. Keep all existing sections, components, and logic unless the user explicitly asks to remove them.
2. **Apply the requested change precisely** — if the user says "add plants", add plant elements/decorations. If they say "change colors", update the color palette. If they say "make buttons bigger", increase button sizes.
3. **Output the COMPLETE updated file** — include the ENTIRE file content with your modifications applied, not just a diff or snippet.
4. **Maintain code quality** — keep the same coding style, framework, and patterns as the existing file.
5. **Use the \`update_files\` tool** with the full updated file content in one call.${isHtml ? '' : `
6. Keep the same import style and component structure. Use only React hooks (useState, useEffect, useRef) — no new npm packages.`}

### VISUAL ASSET RULES — CRITICAL:
When the user requests concrete real-world visual objects (plants, flowers, leaves, trees, animals, cars, people, products, food, buildings, furniture, landscapes, etc.), you MUST represent them concretely. NEVER substitute abstract CSS shapes (circles, blobs, gradients, generic rounded divs) for concrete objects. NEVER say "I can't add images" — you absolutely can and must.

**Priority order for visual assets:**
1. **Real stock photos from Unsplash** — use direct Unsplash URLs. Format: \`https://images.unsplash.com/photo-{ID}?w={WIDTH}&h={HEIGHT}&fit=crop\`. Examples:
   - Plants/houseplants: \`https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=400&h=500&fit=crop\`, \`https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=400&h=600&fit=crop\`, \`https://images.unsplash.com/photo-1501004318855-ed801e3abe65?w=400&h=500&fit=crop\`
   - Nature/landscapes: \`https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=500&fit=crop\`
   - People/portraits: \`https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop\`
   - Food: \`https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=400&fit=crop\`
   - Architecture: \`https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&h=500&fit=crop\`
   You can also use Unsplash search URLs: \`https://images.unsplash.com/photo-{any-valid-ID}?w=WIDTH&h=HEIGHT&fit=crop\`
2. **Inline SVG illustrations** — draw actual recognizable shapes. For plants: leaf shapes, stems, fronds. For flowers: petals, stamens. For trees: trunk + canopy silhouette. Use SVG \`<path>\`, \`<circle>\`, \`<ellipse>\` composed into recognizable forms.
3. **Unicode/emoji characters** — use real botanical/object emoji as decorative elements: styled with \`font-size\`, \`position: absolute\`, \`opacity\`, \`transform: rotate()\` for organic, intentional placement.
4. **Placeholder images** — use \`https://placehold.co/WxH/color/text\` with descriptive labels.

**Explicitly FORBIDDEN for concrete object requests:**
- Single-color circles or rounded rectangles pretending to be plants/flowers/objects
- Generic gradient blobs as stand-ins for real things
- Empty placeholder divs with only a background-color
- The word "plant" or "flower" as text inside a colored circle

**When abstract decoration IS acceptable:**
- User explicitly asks for "abstract shapes", "geometric patterns", "background decoration"
- User asks for "gradient", "blur", "glow", or other explicitly abstract effects
- Accent/background elements that supplement (not replace) concrete visuals

### CRITICAL — YOUR TEXT RESPONSE:
- Your chat message must be SHORT (1-2 sentences). Just say what you changed.
- NEVER include code in your text response — write it only via the tool.
- NEVER show file paths or technical details in your text response.`
        } else {
          // ── NEW BUILD MODE: generate from scratch ──
          systemMessage += `\n\n## DIRECT EDIT MODE — Premium Single-Page Generation
Target file: \`${directEditTarget}\` (use \`${fileAction}\` tool)

You are generating a COMPLETE, PRODUCTION-READY, PREMIUM marketing page — not a placeholder, not a wireframe, not a minimal starter. The output must look like a real, shipped landing page from a well-funded startup.

### MANDATORY PAGE STRUCTURE (generate ALL of these sections, in order):

1. **Sticky Navigation Bar** — logo/brand name on the left, 4–6 nav links on the right, mobile hamburger menu via useState toggle. Semi-transparent or blurred background (backdrop-blur).
2. **Hero Section** — large bold headline (text-5xl/6xl), compelling subheading (text-xl, text-gray-300 or muted), TWO call-to-action buttons (primary filled + secondary outline/ghost), visual background treatment (gradient, radial glow, or layered shapes — NEVER plain white).
3. **Logos / Social Proof Strip** — "Trusted by" or "Featured in" row with 4–6 placeholder brand names styled as muted text or simple pill badges.
4. **Features / Value Props Section** — 3–6 feature cards in a responsive grid (md:grid-cols-2 lg:grid-cols-3), each with an icon (use a simple SVG inline or emoji-free text symbol like ◆ ● ▸), title, and 1–2 sentence description. Cards should have subtle borders, rounded corners, and hover states.
5. **Stats / Metrics Strip** — 3–4 large numbers with labels (e.g., "10K+ Users", "99.9% Uptime", "$2M+ Saved") in a horizontal row, large font for numbers (text-4xl font-bold).
6. **Product Showcase / How It Works** — a visual explanation section. Use a numbered step flow (Step 1 → Step 2 → Step 3) or a feature deep-dive with alternating left/right layout. Include descriptive text per step.
7. **Testimonials or Quotes** — 2–3 testimonial cards with quote text, person name, and role/company. Use a card grid or horizontal layout.
8. **Pricing Section** (if relevant to the product) — 2–3 pricing tiers in cards, with tier name, price, feature bullet list, and CTA button per tier. Highlight the recommended tier with a ring or badge.
9. **Final CTA Section** — a bold, full-width banner section with headline, subtext, and a large CTA button. Use a contrasting background (gradient or dark).
10. **Footer** — multi-column layout with brand name, link groups (Product, Company, Resources, Legal), and a copyright line.

### VISUAL QUALITY REQUIREMENTS:

- **Spacing**: Every major section uses py-16 sm:py-20 lg:py-24 or more. Never less than py-12.
- **Container**: Use max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 for content width.
- **Color palette**: Pick a cohesive palette. For dark themes use slate/zinc-900 backgrounds with colored accents. For light themes use white/gray-50 backgrounds with bold accent colors. Apply the accent consistently to CTAs, highlights, and active states.
- **Typography hierarchy**: Hero headline text-4xl sm:text-5xl lg:text-6xl font-bold. Section headings text-3xl sm:text-4xl font-bold. Body text-base sm:text-lg. Muted text uses opacity or gray tones.
- **Layout**: Use Tailwind grid and flex composition — grid-cols-1 md:grid-cols-2 lg:grid-cols-3, flex items-center gap-8, etc. Avoid plain stacked text blocks.
- **Depth & polish**: Use rounded-xl or rounded-2xl on cards, ring-1 or border with opacity for card edges, shadow-lg or shadow-xl on hover, bg-gradient-to-br for hero/CTA backgrounds, backdrop-blur for nav.
- **Responsive**: Every section must work on mobile (single column) through desktop (multi-column). Use sm:/md:/lg: breakpoints.
- **Transitions**: Add transition-all duration-300 and hover:scale-105 or hover:shadow-xl to interactive cards and buttons.

### BRAND EXPRESSION:

When the user provides a theme, product name, or industry:
- Reflect it in ALL copy — headlines, subheadings, feature descriptions, CTAs. Do NOT use generic "Welcome to our platform" filler.
- Match the visual tone: futuristic products → dark gradients + neon accents; organic/wellness → warm earth tones + soft shapes; finance → clean navy/white + sharp edges; creative → bold colors + playful layout.
- Invent realistic, on-brand placeholder content (company stats, feature names, testimonial quotes) that feels authentic to the product.

### EXECUTION RULES:
- Generate ONLY this one file. Do NOT create package.json, config files, or additional files.
- Output the COMPLETE file content — not a partial snippet. The file will typically be 200–500 lines.${isHtml ? `
- Create a complete HTML document with inline CSS and JS.
- Include Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>` : `
- Export a default React function component.
- Use Tailwind CSS utility classes for all styling (loaded via CDN in preview).
- Use only React hooks (useState, useEffect, useRef) — no external npm packages.
- Do NOT include import statements for React — they are provided by the preview runtime.`}
- Use the ${fileAction} tool to write the file. Do NOT use propose_plan.
- This is a SINGLE TOOL CALL. Write the full page in one ${fileAction} call.

### VISUAL ASSET RULES:
When the design calls for real-world visual objects (product images, illustrations, people, nature, plants), represent them concretely. NEVER say "I can't add images" — you CAN and MUST use real image URLs:
1. **Real stock photos**: Use Unsplash URLs like \`https://images.unsplash.com/photo-{ID}?w=WIDTH&h=HEIGHT&fit=crop\`. For plants: \`https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=400&h=500&fit=crop\`. For nature: \`https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=500&fit=crop\`.
2. Use inline SVG illustrations with recognizable shapes (not anonymous circles/blobs)
3. Use \`https://placehold.co/WxH\` for photo-realistic content when specific Unsplash IDs aren't available
NEVER use single-color circles or plain gradient blobs as substitutes for concrete objects.

### CRITICAL — YOUR TEXT RESPONSE:
- Your chat message must be SHORT (2-3 sentences max). Just say what you built and that it's ready in the preview.
- NEVER include code, JSON, file contents, file paths, or technical details in your text response.
- NEVER wrap tool arguments in a code block in your response.
- NEVER show the user what you're writing to the file — just do it silently via the tool.
- Example good response: "I've built your fintech dashboard with a metrics overview, transaction feed, and financial charts. Check the Preview tab to see it live!"
- Example BAD response: anything containing \`\`\`, {, "path":, "content":, or code of any kind.`
        } // end new build mode
      }

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
      let activeDesignPrefs = null
      if (effectiveScope === 'project') {
        activeDesignPrefs = designPrefs
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

      // Inject prefetched image context
      if (prefetchedImageContext) {
        systemMessage += prefetchedImageContext
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
      let contentWasSanitized = false
      let toolCalls = []
      let generatedFiles = []
      let diffFiles = []
      let planOutput = null

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
        // Force the AI to call the correct file tool in direct-edit mode
        if (directEditMode && directEditFileAction) {
          toolOpts.tool_choice = { type: 'function', function: { name: directEditFileAction } }
        }

        // Stage boundary: filter available tools by request mode
        let effectiveToolSet = toolSet
        if (requestMode === 'plan_only') {
          effectiveToolSet = toolSet.filter(t => t.function?.name === 'propose_plan')
        } else if (requestMode === 'patch_only') {
          effectiveToolSet = toolSet.filter(t => t.function?.name !== 'propose_plan')
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

          // ── Live preview streaming state (direct-edit only) ──
          let toolArgsAccum = ''
          let lastPreviewLen = 0
          const PREVIEW_LEN_STEP = 300 // Emit every ~300 chars of new content

          for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, effectiveToolSet, toolOpts))) {
            if (chunk.type === 'status') {
              yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
            } else if (chunk.type === 'token') {
              fullContent += chunk.content
              if (!usePlanMode) yield { event: 'token', data: { content: chunk.content } }
            } else if (chunk.type === 'tool_calls') {
              toolCalls = chunk.tool_calls
            } else if (chunk.type === 'tool_args_delta' && (chunk.name === 'create_files' || chunk.name === 'update_files')) {
              // Accumulate tool call argument deltas for live preview
              toolArgsAccum += chunk.delta
              if (toolArgsAccum.length - lastPreviewLen >= PREVIEW_LEN_STEP) {
                const partial = this._extractPartialFileContent(toolArgsAccum)
                const previewPath = directEditTarget || 'app/page.jsx'
                if (partial && partial.length > 50) {
                  lastPreviewLen = toolArgsAccum.length
                  console.log('[LivePreview] Emitting partial, content length:', partial.length)
                  yield { event: 'preview_partial', data: { path: previewPath, content: partial } }
                }
              }
            }
          }

          // Emit one final partial before tool calls are processed (catches last gap)
          if (toolArgsAccum) {
            const finalPartial = this._extractPartialFileContent(toolArgsAccum)
            const previewPath = directEditTarget || 'app/page.jsx'
            if (finalPartial && finalPartial.length > 50) {
              yield { event: 'preview_partial', data: { path: previewPath, content: finalPartial } }
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

          // ── Guardrail: Direct-edit tool call enforcement (Req 2+6) ──
          if (directEditMode) {
            const hasFileToolCall = toolCalls.some(tc => {
              try { return tc.function.name === 'create_files' || tc.function.name === 'update_files' } catch { return false }
            })
            if (!hasFileToolCall && directEditRetry < 1) {
              directEditRetry++
              console.warn('[Guardrail] Direct-edit: model returned text instead of file tool call — retrying', JSON.stringify({ attempt: directEditRetry, textLen: fullContent.length }))
              messages.push({ role: 'assistant', content: fullContent })
              messages.push({ role: 'user', content: `You MUST call the ${directEditFileAction} tool now. Do not respond with text — generate the code and call the tool.` })
              fullContent = ''
              toolCalls = []
              continue
            }
            if (!hasFileToolCall) {
              console.error('[Guardrail] REGRESSION: Direct-edit produced no file tool call after retry', JSON.stringify({ toolCalls: toolCalls.length, textLen: fullContent.length }))
            }
          }

          break
        }

        // ── Task-Mode Enforcement (skip for direct-edit — trusted fast path) ──
        if (!directEditMode) {
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
                fileActions: (Array.isArray(diffFiles) && diffFiles.length ? diffFiles.map(d => ({ action: d.action, path: d.path })) : null),
              }).catch(() => {})
              yield { event: 'status', data: { stage: 'task_mode_rejected', detail: `Task mode violation: ${tmResult.errors.join('; ')}` } }
              fullContent = `I couldn't complete that request as described. Could you try rephrasing it?`
              yield { event: 'token', data: { content: fullContent } }
              yield { event: 'done', data: { content: fullContent, toolMode: 'task_mode_rejected', scope: effectiveScope, intent, runId, provider: this.providerName, model: this.modelName } }
              return
            }
          }
        } // end task-mode enforcement

        // Process tool calls
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              const toolName = toolCall.function.name

              if (toolName === 'propose_plan') {
                // Stamp active projectId onto plan before any validation
                args.projectId = projectId

                // Plan-first mode: enforce correctness then validate
                const { enforcePlanCorrectness } = await import('@/lib/self_builder/feature_planner')
                const { corrections } = enforcePlanCorrectness(args, groundedFileContext, userMessage)
                if (corrections.length > 0) {
                  console.log('[FeaturePlanner] Corrections:', corrections)
                }

                let validationResult = null
                // Always run plan validation — structural checks run even without grounded context
                validationResult = validatePlan(args, groundedFileContext, lastRejectedPlanHash, userMessage, { allowedPathPrefix: selfEditTarget?.path || null, activeProjectId: projectId })

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

                  // Project Resolver: check if missing file exists in another user project
                  let resolverHint = ''
                  try {
                    const notFoundError = validationResult.errors.find(e => e.includes('file not found in current project'))
                    if (notFoundError) {
                      const pathMatch = notFoundError.match(/^"([^"]+)"/)
                      if (pathMatch) {
                        const missingPath = pathMatch[1]
                        const crossResults = await db.projectFiles.findByPathAcrossProjects(userId, missingPath)
                        const otherProject = crossResults.find(r => r.project_id !== projectId)
                        if (otherProject) {
                          resolverHint = `\n\nFile found in project "${otherProject.project_name}". Switch?`
                        }
                      }
                    }
                  } catch {}

                  // Update in-memory baseline so retries can't repeat this plan
                  lastRejectedPlanHash = validationResult.hash

                  // Feed rejection reasons back so the planner can learn on retry
                  messages.push({ role: 'assistant', content: fullContent || JSON.stringify(args) })
                  messages.push({ role: 'user', content: `Your plan was rejected for these reasons:\n${validationResult.errors.map(e => '- ' + e).join('\n')}\n\nFix these issues and call propose_plan again.${resolverHint}` })
                  fullContent = ''

                  // HARD BLOCK — re-call AI with rejection feedback (cannot use continue — outside while loop)
                  yield { event: 'status', data: { stage: 'plan_revision', detail: 'Revising plan based on validation feedback...' } }
                  try {
                  let revContent = ''
                  let revToolCalls = []
                  for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, effectiveToolSet, toolOpts))) {
                    if (chunk.type === 'token') revContent += chunk.content
                    else if (chunk.type === 'tool_calls') revToolCalls = chunk.tool_calls
                  }

                  const revPlanCall = revToolCalls.find(tc => {
                    try { return tc.function.name === 'propose_plan' } catch { return false }
                  })
                  if (revPlanCall) {
                    try {
                      const revArgs = JSON.parse(revPlanCall.function.arguments)
                      const revSafe = (revArgs.file_actions || []).length <= 3 && !isLargeAppBuild(userMessage)
                      if (revSafe) {
                        // Auto-execute revised plan inline
                        yield { event: 'status', data: { stage: 'auto_executing', detail: 'Building (revised)...' } }
                        const revSaved = []
                        try {
                          for await (const evt of this.executePlanStream({ projectId, chatId, userMessage, userId, scope: effectiveScope, designPrefs: activeDesignPrefs, planData: revArgs, runId, startTime, selfEditTarget: null })) {
                            if (evt.event === 'diff_file' && evt.data?.newContent) {
                              const saved = await this.saveFiles(projectId, [{ path: evt.data.path, content: evt.data.newContent, file_type: evt.data.fileType || 'text' }], evt.data.action === 'update')
                              for (const f of saved) { generatedFiles.push(f); revSaved.push(f) }
                            } else if (evt.event === 'status') { yield evt }
                          }
                        } catch (e) { console.error('[AutoExecute:Revised]', e.message) }
                        if (revSaved.length > 0) {
                          fullContent = `Done — I built ${revSaved.map(f => f.path).join(', ')} and updated the preview.`
                        } else {
                          fullContent = `I tried a revised approach but couldn't complete it. Could you try rephrasing?`
                        }
                        yield { event: 'token', data: { content: fullContent } }
                      } else {
                        console.log('[propose_plan] Non-executable revised plan suppressed — failing explicitly')
                        fullContent = 'PATCH FAILED: no executable changes produced'
                        toolMode = 'patch_failed'
                        yield { event: 'token', data: { content: fullContent } }
                      }
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
                      for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, effectiveToolSet, toolOpts))) {
                        if (chunk.type === 'token') revisedContent += chunk.content
                        else if (chunk.type === 'tool_calls') revisedToolCalls = chunk.tool_calls
                      }

                      const revisedPlanCall = revisedToolCalls.find(tc => {
                        try { return tc.function.name === 'propose_plan' } catch { return false }
                      })
                      if (revisedPlanCall) {
                        try {
                          const revisedArgs = JSON.parse(revisedPlanCall.function.arguments)
                          const revSafe2 = (revisedArgs.file_actions || []).length <= 3 && !isLargeAppBuild(userMessage)
                          if (revSafe2) {
                            yield { event: 'status', data: { stage: 'auto_executing', detail: 'Building (revised)...' } }
                            const revSaved2 = []
                            try {
                              for await (const evt of this.executePlanStream({ projectId, chatId, userMessage, userId, scope: effectiveScope, designPrefs: activeDesignPrefs, planData: revisedArgs, runId, startTime, selfEditTarget: null })) {
                                if (evt.event === 'diff_file' && evt.data?.newContent) {
                                  const saved = await this.saveFiles(projectId, [{ path: evt.data.path, content: evt.data.newContent, file_type: evt.data.fileType || 'text' }], evt.data.action === 'update')
                                  for (const f of saved) { generatedFiles.push(f); revSaved2.push(f) }
                                } else if (evt.event === 'status') { yield evt }
                              }
                            } catch (e) { console.error('[AutoExecute:SelfCritique]', e.message) }
                            fullContent = revSaved2.length > 0
                              ? `Done — I built ${revSaved2.map(f => f.path).join(', ')} and updated the preview.`
                              : `I tried a revised approach but couldn't complete it. Could you try rephrasing?`
                            yield { event: 'token', data: { content: fullContent } }
                          } else {
                            console.log('[propose_plan] Non-executable self-critique revised plan suppressed — failing explicitly')
                            fullContent = 'PATCH FAILED: no executable changes produced'
                            toolMode = 'patch_failed'
                            yield { event: 'token', data: { content: fullContent } }
                          }
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

                // Tag plan: safe plans auto-execute inline without showing approval card
                const planActions = args.file_actions || []
                const isSafePlan = planActions.length <= 3 && !isLargeAppBuild(userMessage)

                if (isSafePlan) {
                  // ── Auto-execute inline: run plan, save files directly, then emit success ──
                  yield { event: 'status', data: { stage: 'auto_executing', detail: 'Building...' } }
                  console.log('[AutoExecute] Safe plan — executing inline:', args.summary)

                  const savedFiles = []
                  let execError = null
                  try {
                    for await (const evt of this.executePlanStream({
                      projectId, chatId, userMessage, userId,
                      scope: effectiveScope, designPrefs: activeDesignPrefs,
                      planData: args, runId, startTime, selfEditTarget: null,
                    })) {
                      if (evt.event === 'diff_file' && evt.data?.newContent) {
                        // Save file directly instead of emitting as diff for review
                        const saved = await this.saveFiles(projectId, [{
                          path: evt.data.path,
                          content: evt.data.newContent,
                          file_type: evt.data.fileType || 'text',
                          description: evt.data.description || '',
                        }], evt.data.action === 'update')
                        for (const f of saved) {
                          generatedFiles.push(f)
                          savedFiles.push(f)
                        }
                      } else if (evt.event === 'status') {
                        yield evt
                      } else if (evt.event === 'error') {
                        execError = evt.data?.message || 'Unknown error'
                      }
                      // Swallow: token, done, plan events from inner stream
                    }
                  } catch (err) {
                    execError = err.message
                    console.error('[AutoExecute] Error:', err.message)
                  }

                  if (savedFiles.length > 0) {
                    const paths = savedFiles.map(f => f.path).join(', ')
                    fullContent = `Done — I built ${paths} and updated the preview.`
                    yield { event: 'token', data: { content: fullContent } }
                    console.log('[AutoExecute] Saved', savedFiles.length, 'file(s):', paths)
                  } else {
                    fullContent = execError
                      ? `I ran into an issue building that: ${execError}. Could you try rephrasing?`
                      : refinementMode
                        ? `I couldn't safely update the current page layout on that pass. I can retry with a simpler edit — try breaking it into smaller changes.`
                        : `I tried to build that but couldn't generate the files. Could you try a more specific request?`
                    yield { event: 'token', data: { content: fullContent } }
                  }
                  // Skip plan emission — files are already saved
                  continue
                }

                // Large/risky plan — suppressed; fail explicitly instead of showing approval card
                console.log('[propose_plan] Large plan suppressed — no executable changes:', args.summary)

                // Log the suppressed plan for diagnostics
                logPlanEvent({
                  projectId, chatId, userId,
                  userTask: userMessage,
                  taskMode: 'plan_suppressed',
                  contextPaths: groundedFileContext?.files?.map(f => f.path) || [],
                  validatorResult: validationResult,
                  planHash: hashPlan(args),
                  planSummary: args.summary,
                  fileActions: args.file_actions,
                  constraintsChecked: args.constraints_checked,
                }).catch(() => {})

                fullContent = 'PATCH FAILED: no executable changes produced'
                toolMode = 'patch_failed'
                yield { event: 'token', data: { content: fullContent } }
              } else if (toolName === 'create_files' || toolName === 'update_files') {
                // ── Direct Edit Mode: save files immediately, skip diff pipeline ──
                if (directEditMode) {
                  yield { event: 'status', data: { stage: 'saving_files', detail: `Saving ${args.files?.length || 0} file(s) directly...` } }
                  const savedFiles = await this.saveFiles(projectId, args.files, toolName === 'update_files')
                  for (const f of savedFiles) generatedFiles.push(f)
                  console.log('[DirectEdit] Saved', savedFiles.length, 'file(s):', savedFiles.map(f => f.path).join(', '))

                  // ── Guardrail 1: Direct-build integrity check ──
                  if (savedFiles.length === 0) {
                    console.error('[Guardrail] REGRESSION: Direct-edit produced 0 saved files', JSON.stringify({ toolName, argsFileCount: args.files?.length }))
                    // Auto-retry once: re-enter the while loop
                    if (directEditRetry < 1) {
                      directEditRetry++
                      console.warn('[Guardrail] Direct-edit integrity: retrying build (0 files saved)')
                      messages.push({ role: 'assistant', content: fullContent || '(no output)' })
                      messages.push({ role: 'user', content: refinementMode
                        ? 'The file write failed. Please read the existing file content provided above and apply the requested changes. Use the update_files tool with the COMPLETE updated file.'
                        : 'The file write failed. Please try generating the code again and call the tool.'
                      })
                      fullContent = ''
                      toolCalls = []
                      continue
                    }
                    // Retry exhausted — conversational error
                    fullContent = refinementMode
                      ? `I couldn't safely update the current page layout on that pass. I can retry with a simpler edit — try breaking it into smaller changes.`
                      : `I tried to build that but couldn't generate the files. Could you try a more specific request?`
                    yield { event: 'token', data: { content: fullContent } }
                    continue
                  }

                  // ── Guardrail 3: Success message truth — only if files actually saved ──
                  if (savedFiles.length > 0 && !fullContent) {
                    const paths = savedFiles.map(f => f.path).join(', ')
                    fullContent = refinementMode
                      ? `Done — I updated ${paths} with your changes. Check the preview!`
                      : `Done — I built the page in ${paths} and updated the preview.`
                    yield { event: 'token', data: { content: fullContent } }
                  }
                  continue
                }

                // Stage boundary: block diff generation in non-execution modes
                if (requestMode === 'plan_only' || requestMode === 'read_only_report') {
                  yield { event: 'status', data: { stage: 'blocked_by_mode', detail: `File changes blocked in ${requestMode} mode` } }
                  continue
                }
                if (resolveTaskMode(intent) === 'inspect') {
                  yield { event: 'status', data: { stage: 'blocked_by_task_mode', detail: 'File changes blocked in inspect mode' } }
                  continue
                }

                // Stage boundary: plan and diff cannot coexist in the same cycle
                if (hasPlanCall) {
                  yield { event: 'status', data: { stage: 'deferred_to_plan', detail: 'Plan proposed — file changes deferred to execution phase' } }
                  continue
                }

                // Generate diffs for review instead of writing files directly
                yield { event: 'status', data: { stage: 'generating_diffs', detail: `Building diff preview for ${args.files?.length || 0} file(s)...` } }
                const { buildPendingDiffs } = await import('@/lib/self_builder/file_ops_bridge')
                const pendingDiffs = buildPendingDiffs(args.files, {
                  planFileActions: null,
                  findExisting,
                  toolName,
                  detectFileType,
                })

                const patchResult = validatePatchGrounding(pendingDiffs, filesByPath, null)
                if (!patchResult.valid) {
                  console.log('[PatchGroundingValidator] Rejected:', JSON.stringify({ event: 'patch_grounding_rejected', errors: patchResult.errors }))
                  logPlanEvent({
                    projectId, chatId, userId, userTask: userMessage,
                    taskMode: 'patch_grounding_rejected',
                    validatorResult: { valid: false, errors: patchResult.errors, warnings: [], mode: 'patch_grounding_rejected' },
                    planHash: null,
                    rejectionReasons: patchResult.errors,
                    planSummary: args.plan || args.summary || null,
                    fileActions: pendingDiffs.map(d => ({ action: d.action, path: d.path })),
                  }).catch(() => {})

                  // Fallback: save as full file rewrites instead of discarding
                  const rewriteFiles = pendingDiffs.filter(d => d.newContent && d.path).map(d => ({
                    path: d.path,
                    content: d.newContent,
                    file_type: d.fileType || detectFileType(d.path),
                    description: d.description || 'Full rewrite (grounding fallback)',
                  }))
                  if (rewriteFiles.length > 0) {
                    console.log('[PatchGroundingValidator] Falling back to full file rewrite for', rewriteFiles.map(f => f.path).join(', '), '| content lengths:', rewriteFiles.map(f => f.content?.length || 0))
                    yield { event: 'status', data: { stage: 'saving_fallback', detail: 'Applying changes as full rewrite...' } }
                    try {
                      const saved = await this.saveFiles(projectId, rewriteFiles, true)
                      console.log('[PatchGroundingValidator] saveFiles returned', saved.length, 'file(s)')
                      for (const f of saved) generatedFiles.push(f)
                      if (saved.length > 0) {
                        const paths = saved.map(f => f.path).join(', ')
                        fullContent = `Done — I updated ${paths} and refreshed the preview.`
                        yield { event: 'token', data: { content: fullContent } }
                      }
                    } catch (saveErr) {
                      console.error('[PatchGroundingValidator] saveFiles threw:', saveErr.message, saveErr.stack?.split('\n').slice(0, 3).join(' | '))
                    }
                  } else {
                    console.warn('[PatchGroundingValidator] No rewriteFiles — pendingDiffs:', pendingDiffs.map(d => ({ path: d.path, hasContent: !!d.newContent, contentLen: d.newContent?.length || 0 })))
                  }
                  if (generatedFiles.length === 0) {
                    fullContent = `I ran into an issue applying that change. Could you try rephrasing your request?`
                    yield { event: 'token', data: { content: fullContent } }
                  }
                  continue
                }

                for (const d of pendingDiffs) {
                  diffFiles.push(d)
                  yield { event: 'diff_file', data: d }
                }
                if (!fullContent) {
                  const count = diffFiles.length
                  fullContent = count === 1
                    ? `Done — I updated 1 file. Review the changes below.`
                    : `Done — I updated ${count} files. Review the changes below.`
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

      // ── Direct-edit safety net: if tool_choice was forced but generatedFiles is still empty,
      //    try to parse file content from the response text and save directly ──
      if (directEditMode && generatedFiles.length === 0 && fullContent) {
        console.log('[DirectEdit] No files generated via tool call — attempting text-parse fallback')
        const parsed = tryParseFilesFromResponse(fullContent)
        if (parsed.files?.length > 0) {
          yield { event: 'status', data: { stage: 'saving_files', detail: `Recovered ${parsed.files.length} file(s) from response, saving...` } }
          const savedFiles = await this.saveFiles(projectId, parsed.files, false)
          for (const f of savedFiles) generatedFiles.push(f)
          console.log('[DirectEdit] Fallback saved', savedFiles.length, 'file(s):', savedFiles.map(f => f.path).join(', '))
          if (savedFiles.length > 0) {
            const paths = savedFiles.map(f => f.path).join(', ')
            fullContent = `Done — I built the page in ${paths} and updated the preview.`
          }
        }
        // If still empty, synthesize a file from the full text content as last resort
        if (generatedFiles.length === 0 && directEditTarget) {
          console.log('[DirectEdit] Text-parse fallback also empty — synthesizing from fullContent is not possible, notifying user')
          fullContent = `I wasn't able to generate the file. Could you try again with a more specific request?`
          yield { event: 'token', data: { content: fullContent } }
        }
      }

      // Try parsing files from response text if no tool calls (skip in plan mode and direct-edit — handled above)
      if (!directEditMode && !usePlanMode && diffFiles.length === 0 && generatedFiles.length === 0 && toolMode !== 'chat_only' && requestMode !== 'plan_only' && requestMode !== 'read_only_report') {
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

          const patchResult = validatePatchGrounding(candidateDiffs, filesByPath, null)
          if (!patchResult.valid) {
            console.log('[PatchGroundingValidator] Text-parsed diffs rejected:', JSON.stringify({ errors: patchResult.errors }))
            logPlanEvent({
              projectId, chatId, userId, userTask: userMessage,
              taskMode: 'patch_grounding_rejected',
              validatorResult: { valid: false, errors: patchResult.errors, warnings: [], mode: 'patch_grounding_rejected' },
              planHash: null,
              rejectionReasons: patchResult.errors,
              fileActions: candidateDiffs.map(d => ({ action: d.action, path: d.path })),
            }).catch(() => {})

            // Fallback: save as full file rewrites instead of discarding
            const rewriteFiles = candidateDiffs.filter(d => d.newContent && d.path).map(d => ({
              path: d.path,
              content: d.newContent,
              file_type: d.fileType || detectFileType(d.path),
              description: d.description || 'Full rewrite (grounding fallback)',
            }))
            if (rewriteFiles.length > 0) {
              console.log('[PatchGroundingValidator] Falling back to full file rewrite for', rewriteFiles.map(f => f.path).join(', '))
              const saved = await this.saveFiles(projectId, rewriteFiles, true)
              for (const f of saved) generatedFiles.push(f)
              if (saved.length > 0) {
                const paths = saved.map(f => f.path).join(', ')
                fullContent = `Done — I updated ${paths} and refreshed the preview.`
                yield { event: 'token', data: { content: fullContent } }
              }
            }
            if (generatedFiles.length === 0) {
              fullContent = `I ran into an issue applying that change. Could you try rephrasing your request?`
              yield { event: 'token', data: { content: fullContent } }
            }
          } else {
            for (const d of candidateDiffs) {
              diffFiles.push(d)
              yield { event: 'diff_file', data: d }
            }
          }
        }
      }

      // ── Leaked JSON Sanitizer — catch model dumping tool-call JSON as plain text ──
      if (generatedFiles.length === 0 && diffFiles.length === 0 && fullContent) {
        const trimmed = fullContent.trim()
        let leakedJSON = null

        // Try JSON inside a ```json code fence
        const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (jsonBlockMatch) {
          try { leakedJSON = JSON.parse(jsonBlockMatch[1]) } catch {}
        }

        // Try raw JSON (entire content or embedded in surrounding text)
        if (!leakedJSON && trimmed.includes('"files"') && trimmed.includes('"path"') && trimmed.includes('"content"')) {
          const jsonStart = trimmed.indexOf('{')
          const jsonEnd = trimmed.lastIndexOf('}')
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            try { leakedJSON = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) } catch {}
          }
        }

        if (leakedJSON?.files && Array.isArray(leakedJSON.files) && leakedJSON.files.length > 0) {
          console.log('[JSONSanitizer] Intercepted leaked JSON with', leakedJSON.files.length, 'file(s) — executing as file writes')
          const sanitizedSaved = []
          for (const file of leakedJSON.files) {
            if (file.path && file.content) {
              try {
                const isUpdate = file.action === 'update' || !!findExisting(file.path)
                const saved = await this.saveFiles(projectId, [{
                  path: file.path,
                  content: file.content,
                  file_type: file.file_type || detectFileType(file.path),
                  description: file.description || '',
                }], isUpdate)
                for (const f of saved) { generatedFiles.push(f); sanitizedSaved.push(f) }
              } catch (e) {
                console.error('[JSONSanitizer] Failed to save:', file.path, e.message)
              }
            }
          }
          fullContent = sanitizedSaved.length > 0
            ? `Done — I updated ${sanitizedSaved.map(f => f.path).join(', ')} and refreshed the preview.`
            : `I wasn't able to apply those changes. Could you try rephrasing?`
          contentWasSanitized = true
          yield { event: 'token', data: { content: fullContent } }
        }
      }

      const hasDiffs = diffFiles.length > 0

      // Precompute fileActions for logging — prefer plan, fallback to diffFiles
      const loggedFileActions =
        Array.isArray(diffFiles) && diffFiles.length
          ? diffFiles.map(d => ({ action: d.action, path: d.path }))
          : null

      // ── Request-Mode Output Validation (with one retry) ──
      if (requestMode !== 'plan_patch') {
        const outputSignals = {
          hasProposedPlan: false,
          hasFileActions: false,
          hasFileContent: diffFiles.some(d => d.newContent),
          hasDiffFiles: hasDiffs,
        }
        const rmResult = validateRequestModeOutput(requestMode, outputSignals)
        if (!rmResult.valid) {
          console.log('[RequestModeGate] Output violation (attempt 1):', JSON.stringify({
            request_mode: requestMode,
            actual_output_type: hasDiffs ? 'diff_files' : 'text',
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
              planSummary: null,
              fileActions: loggedFileActions,
            }).catch(() => {})
            fullContent = `I had trouble processing that request. Could you try rephrasing it differently?`
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
            planSummary: null,
            fileActions: loggedFileActions,
          }).catch(() => {})
          fullContent = retryContent
          diffFiles = []
          yield { event: 'token', data: { content: retryContent } }
        }
      }

      // 10. Update canvas (skip when diffs are pending review or plan mode)
      let canvasUpdated = false
      if (!hasDiffs) {
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
      const effectiveToolMode = hasDiffs ? 'diff_generated' : toolMode
      yield { event: 'status', data: { stage: hasDiffs ? 'diff_ready' : 'complete', detail: hasDiffs ? `${diffFiles.length} file(s) ready for review` : 'Generation complete' } }
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
          planHash: null,
          planSummary: null,
          fileActions: loggedFileActions,
          constraintsChecked: null,
        }).catch(() => {})
      }

            // 13. Done event with metadata
      // ── Guardrail 6: Regression logging ──
      if (directEditMode) {
        if (generatedFiles.length === 0) console.error('[Guardrail] REGRESSION: Direct-edit done with 0 generated files')
        if (generatedFiles.length > 0 && !toolArgsAccum) console.warn('[Guardrail] Direct-edit generated files but no preview_partial was emitted (no tool_args_delta received)')
        if (toolCalls.length === 0) console.error('[Guardrail] REGRESSION: Direct-edit done with 0 tool calls')
      }
      console.log('[Done] generatedFiles:', generatedFiles.length, 'diffFiles:', diffFiles.length, 'directEditMode:', directEditMode)
      if (generatedFiles.length > 0) console.log('[Done] files:', generatedFiles.map(f => ({ path: f.path, action: f.action, id: f.id })))
      yield {
        event: 'done',
        data: {
          content: fullContent,
          contentOverride: contentWasSanitized ? fullContent : undefined,
          files: generatedFiles.map(f => ({ path: f.path, action: f.action, id: f.id })),
          diffFiles: hasDiffs ? diffFiles : null,
          planId: null,
          planStatus: null,
          diffId: hasDiffs ? crypto.randomUUID() : null,
          diffStatus: hasDiffs ? 'pending' : null,
          plan: planOutput,
          proposedPlan: null,
          toolMode: effectiveToolMode,
          scope: effectiveScope,
          intent,
          runId,
          provider: this.providerName,
          model: this.modelName,
          canvasUpdated,
          directEditMode: directEditMode || false,
          fsStats: fsContext
            ? {
                scanned: fsContext.scannedCount,
                read: fsContext.readCount,
                matched: fsContext.matchedCount,
              }
            : null
        }
      }
      // Clean up prefetched images after request completes
      this._prefetchedImages = null
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
      const validationResult = validatePlan(planData, null, null, userMessage, { allowedPathPrefix: selfEditTarget?.path || null, activeProjectId: projectId })
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

      // ── Grounding Injection: project identity + strict file index ──
      if (projectId) {
        const groundingBlock = await buildProjectGroundingBlock(projectId)
        if (groundingBlock) systemMessage += '\n\n' + groundingBlock
      }

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

                // Fallback: save as full file rewrites
                const rewriteFiles = pendingDiffs.filter(d => d.newContent && d.path).map(d => ({
                  path: d.path,
                  content: d.newContent,
                  file_type: d.fileType || detectFileType(d.path),
                  description: d.description || 'Full rewrite (grounding fallback)',
                }))
                if (rewriteFiles.length > 0) {
                  console.log('[PatchGroundingValidator] Falling back to full file rewrite for', rewriteFiles.map(f => f.path).join(', '))
                  yield { event: 'status', data: { stage: 'saving_fallback', detail: 'Applying changes as full rewrite...' } }
                  // Emit as diff_file events so the auto-execute consumer can save them
                  for (const d of pendingDiffs.filter(d => d.newContent && d.path)) {
                    const rewriteDiff = { ...d, action: 'create', description: d.description || 'Full rewrite (grounding fallback)' }
                    diffFiles.push(rewriteDiff)
                    yield { event: 'diff_file', data: rewriteDiff }
                  }
                }
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
            fullContent = `I ran into an issue applying that change and I'm retrying with a safer approach. Could you try rephrasing your request?`
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
        fullContent = `Done — ${diffFiles.length} file${diffFiles.length === 1 ? '' : 's'} updated and ready for review.`
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
   * Extract partial file content from streaming tool call arguments.
   * The accumulated JSON looks like: {"files":[{"path":"app/page.jsx","content":"...partial...
   * We extract the content value even though the JSON is incomplete.
   */
  _extractPartialFileContent(accum) {
    // Find the start of the "content" value
    const marker = '"content"'
    const idx = accum.indexOf(marker)
    if (idx === -1) return null

    // Find the colon after "content"
    const colonIdx = accum.indexOf(':', idx + marker.length)
    if (colonIdx === -1) return null

    // Find the opening quote of the value
    const quoteIdx = accum.indexOf('"', colonIdx + 1)
    if (quoteIdx === -1) return null

    // Everything after the opening quote is partial content (JSON-escaped)
    let raw = accum.slice(quoteIdx + 1)

    // Strip any trailing complete JSON closure
    raw = raw.replace(/"\s*,?\s*"file_type[\s\S]*$/, '')
    raw = raw.replace(/"\s*}\s*]\s*}\s*$/, '')

    // Remove trailing incomplete escape sequence
    if (raw.endsWith('\\') && !raw.endsWith('\\\\')) {
      raw = raw.slice(0, -1)
    }

    // Unescape JSON string
    try {
      return JSON.parse('"' + raw + '"')
    } catch {
      // Fallback: manual unescape for common sequences
      return raw
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\r/g, '\r')
    }
  }

  /**
   * Context compression — keep recent messages, summarize old ones
   */
  async saveFiles(projectId, files, isUpdate) {
    console.log(`[saveFiles] Called with ${files.length} file(s), isUpdate=${isUpdate}, paths:`, files.map(f => f.path))
    const savedFiles = []

    // ── Code Completeness Validation — auto-repair truncated files ──
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const result = validateCodeCompleteness(file.content, file.path)
      if (!result.valid && result.repairPrompt) {
        console.warn(`[CodeValidator] Incomplete file detected: ${file.path} — ${result.reason}. Attempting auto-repair...`)
        try {
          const repairMessages = [
            { role: 'system', content: 'You are a code completion assistant. Output ONLY the complete file content. No markdown fences, no explanation.' },
            { role: 'user', content: result.repairPrompt },
          ]
          const repairResponse = await this.provider.chat(repairMessages, { temperature: 0.2, max_tokens: 16000 })
          const repairedContent = repairResponse?.content?.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
          if (repairedContent && repairedContent.length > file.content.length * 0.8) {
            const recheck = validateCodeCompleteness(repairedContent, file.path)
            if (recheck.valid) {
              console.log(`[CodeValidator] Auto-repair succeeded for ${file.path}`)
              files[i] = { ...file, content: repairedContent }
            } else {
              console.warn(`[CodeValidator] Auto-repair still incomplete for ${file.path}: ${recheck.reason}. Saving original.`)
            }
          }
        } catch (repairErr) {
          console.error(`[CodeValidator] Auto-repair failed for ${file.path}:`, repairErr.message)
        }
      }
    }

    // ── Placeholder Image Replacement — swap placeholder URLs with real stock photos ──
    const prefetchedImages = this._prefetchedImages || []
    if (prefetchedImages.length > 0) {
      const placeholderPattern = /(?:https?:\/\/(?:via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com)[^\s"'`>)]*|(?:https?:\/\/[^\s"'`>)]*placeholder[^\s"'`>]*))/gi
      let imgIndex = 0
      for (let i = 0; i < files.length; i++) {
        const ext = files[i].path?.split('.').pop()?.toLowerCase() || ''
        if (!['jsx', 'tsx', 'js', 'ts', 'html', 'htm', 'css'].includes(ext)) continue
        const original = files[i].content
        if (!original) continue
        const replaced = original.replace(placeholderPattern, () => {
          const img = prefetchedImages[imgIndex % prefetchedImages.length]
          imgIndex++
          return img.url
        })
        if (replaced !== original) {
          console.log(`[ImagePostProcessor] Replaced ${imgIndex} placeholder URL(s) in ${files[i].path} with real stock photos`)
          files[i] = { ...files[i], content: replaced }
        }
      }
    }

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
