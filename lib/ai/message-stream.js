// ── Message Stream Processor ──
import { buildProjectGroundingBlock } from './service.js'
// Extracted from service.js for modularity. Called via .call(this) from AIService.
import { formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS, detectToolMode, PLAN_ONLY_TOOLS } from './tools.js'
import { classifyIntent, classifyIntentWithConfidence, buildDisambiguationPrompt, getIntentWorkflow, getIntentSystemAddendum, shouldUsePlanMode, resolveTaskMode, classifyRequestMode, detectTaskMode, isSimpleFrontendEdit, isRefinementRequest, findMainPagePath, isProceedSignal, isLargeAppBuild } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache, validateFileOperations } from './filesystem.js'
import { formatDesignContextBlock, getLayoutPatternForPrompt, getComponentPatternsForPrompt } from './design-system.js'
import { ProviderError } from './errors.js'
import { loadFileContext, buildGroundedPromptBlock, extractTargetPaths } from './file-context-loader.js'
import { validatePlan, hashPlan, validatePatchGrounding, validateTaskMode, validateRequestModeOutput } from './plan-validator.js'
import { logPlanEvent } from './changelog.js'
import { inspectToolCalls, detectFileType, tryParseFilesFromResponse, buildDeleteDiffs, formatPlanResponse, formatSummaryResponse, formatDiffSummary, formatDeleteSummary } from './tool-executor.js'
import { classifyStreamError } from './stream-helpers.js'
import { buildFilesSummaryText, buildErrorLogData } from './post-process.js'
import { findPendingDiffMessage, buildApplyDiffContent, buildDiscardContent, buildVerifyPrompt, buildCompletenessPrompt, parseCompletenessSteps, buildContinuationData, buildApplyDoneData, buildDiscardDoneData } from './pending-diff.js'
import { parseApiCall, isRouteAllowed, executeInternalApi, PARSE_ERROR_CONTENT, buildDeniedContent, buildExecResultContent, buildExecDoneData } from './internal-api-exec.js'
import { detectImageCategories, hasVisualIntent, getStockPhotos, generateArtDirectedImages, buildImagePromptContext, buildDesignIntelligencePrompt, parseCreativeBrief } from './image-prefetch.js'
import { extractFileCandidates, resolveFromProjectFiles, resolveFromFilesystem, buildInspectedContentsBlock, fsContextHasRequestedFile, buildReadOnlyDirective, cleanRefusalHistory, collectEmbeddedFiles, buildAugmentedUserMessage } from './read-only-report.js'
import { buildProjectManagerPrompt, buildRefinementPrompt, buildNewPagePrompt } from './prompt-builder.js'
import { verifyPatchResult, buildVerifiedPatchResponse, generateRuntimeTestScript, generateInteractionTests } from './patch-verification.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'


/**
 * Build verified response with runtime test data.
 * Returns { text, runtimeEvent } — caller yields the runtimeEvent if present.
 */
function buildVerifiedResponseWithRuntime(savedFiles, userMessage, isRefinement) {
  const vResult = verifyPatchResult(savedFiles, userMessage)
  const interactionTests = generateInteractionTests(savedFiles, userMessage)
  const runtimeScript = generateRuntimeTestScript(vResult.checks || [], { interactionTests })
  // If runtime tests exist and code passed, mark as CODE_VERIFIED_ONLY
  if (runtimeScript && vResult.status === 'VERIFIED') {
    vResult.runtimeStatus = 'CODE_VERIFIED_ONLY'
  }
  const text = buildVerifiedPatchResponse(vResult, isRefinement)
  const runtimeEvent = runtimeScript
    ? { event: 'runtime_tests', data: { script: runtimeScript, checks: (vResult.checks || []).map(c => ({ type: c.type, value: c.value })) } }
    : null
  return { text, runtimeEvent }
}


export async function* processMessageStreamImpl({ projectId, chatId, userMessage, userId, scope: requestedScope, designPrefs, executePlan, attachments, selfEditTarget, visualMode }) {
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

      // 1. Classify intent (with confidence scoring)
      yield { event: 'status', data: { stage: 'classifying_intent', detail: 'Analyzing your request...' } }
      const classification = classifyIntentWithConfidence(userMessage)
      let intent = classification.intent

      // ── LLM Disambiguation for ambiguous/low-confidence prompts ──
      if (classification.confidence === 'low' && classification.isAmbiguous) {
        const disambigPrompt = buildDisambiguationPrompt(userMessage, classification)
        if (disambigPrompt) {
          try {
            const disambigResult = await this.provider.chat(
              [{ role: 'user', content: disambigPrompt }],
              { temperature: 0, max_tokens: 20 }
            )
            const resolvedIntent = disambigResult?.content?.trim()?.toLowerCase()?.replace(/[^a-z_]/g, '')
            const validIntents = ['build', 'edit', 'refactor', 'bug_fix', 'explain', 'image_generation', 'sprite_generation', 'asset_generation', 'deployment', 'export', 'research', 'chat', 'architecture_analysis']
            if (resolvedIntent && validIntents.includes(resolvedIntent)) {
              console.log(`[IntentDisambiguation] Resolved "${userMessage.slice(0, 60)}..." from "${intent}" → "${resolvedIntent}" (LLM)`)
              intent = resolvedIntent
            }
          } catch (disambigErr) {
            console.warn('[IntentDisambiguation] LLM call failed, using regex result:', disambigErr.message)
          }
        }
      }

      let workflow = getIntentWorkflow(intent)
      yield { event: 'status', data: { stage: 'intent_classified', detail: workflow.description, intent, confidence: classification.confidence } }

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

      // 7. Determine if plan-first mode applies
      // Force plan mode for Creative Brief builds and new projects
      const existingFiles = fsContext?.scannedCount || 0
      const isBriefBuild = userMessage.includes('Build this project now with COMPLETE')
      const isNewProjectBuild = (existingFiles === 0 || isBriefBuild) && !directEditMode
      console.log('[ModeDecision]', JSON.stringify({ directEditMode, isBriefBuild, isNewProjectBuild, existingFiles, messageLen: userMessage?.length }))
      const usePlanMode = directEditMode
        ? false
        : requestMode === 'read_only_report'
        ? false
        : requestMode === 'plan_only'
        ? true
        : requestMode === 'patch_only'
        ? false
        : isNewProjectBuild
        ? true
        : (shouldUsePlanMode(intent) && effectiveScope === 'project')

      // 7b. Determine tool mode
      // The AI always has tools available for project-scoped build intents.
      // It decides itself whether to plan, build, or just respond conversationally.
      let toolMode = requestMode === 'read_only_report'
        ? 'chat_only'
        : (effectiveScope !== 'project'
          ? 'chat_only'
          : workflow.toolMode)

      // 7c. Image Prefetch & Design Intelligence
      let prefetchedImageContext = ''
      let prefetchedImages = []
      let designBrief = null
      const effectiveVisualMode = visualMode || 'stock'
      if (effectiveScope === 'project' && (taskMode === 'build' || taskMode === 'refine_page' || taskMode === 'edit')) {
        // Parse creative brief from every build/edit request
        designBrief = parseCreativeBrief(userMessage)
        if (designBrief) {
          yield { event: 'creative_brief', data: { mood: designBrief.mood, subjects: designBrief.subjects, colors: designBrief.colors, lightingCues: designBrief.lightingCues, styleCues: designBrief.styleCues, moodParams: designBrief.moodParams } }
        }

        const imageCategories = detectImageCategories(userMessage)
        const needsImages = imageCategories.length > 0 || hasVisualIntent(userMessage)

        if (needsImages) {
          const defaultCategories = imageCategories.length > 0 ? imageCategories : ['nature', 'abstract']

          if (effectiveVisualMode === 'custom' && designBrief) {
            // Premium: AI art-directed image generation
            yield { event: 'status', data: { stage: 'generating_images', detail: 'Art-directing custom images for your design...' } }
            try {
              const artImages = await generateArtDirectedImages(this.provider, designBrief, 4)
              if (artImages.length > 0) {
                prefetchedImages = artImages
                prefetchedImageContext = buildImagePromptContext(artImages, designBrief, true)
                yield { event: 'status', data: { stage: 'images_ready', detail: `Generated ${artImages.length} art-directed image(s)` } }
              }
            } catch (err) {
              console.error('[ArtDirection] Custom generation failed, falling back to stock:', err.message)
              const stockImages = getStockPhotos(defaultCategories, 6)
              if (stockImages.length > 0) {
                prefetchedImages = stockImages
                prefetchedImageContext = buildImagePromptContext(stockImages, designBrief, false)
              }
            }
          } else {
            // Stock: curated Unsplash URLs
            yield { event: 'status', data: { stage: 'finding_images', detail: 'Finding images for your design...' } }
            const stockImages = getStockPhotos(defaultCategories, 6)
            if (stockImages.length > 0) {
              prefetchedImages = stockImages
              prefetchedImageContext = buildImagePromptContext(stockImages, designBrief, false)
              yield { event: 'status', data: { stage: 'images_ready', detail: `Found ${stockImages.length} image(s)` } }
            }
          }
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

      // ── Direct Edit Mode: single-file generation instructions ──
      if (directEditMode && directEditTarget) {
        const ext = directEditTarget.split('.').pop()
        const isHtml = ext === 'html'
        const fileAction = directEditFileAction || 'create_files'

        if (refinementMode && refinementFileContent) {
          // ── REFINEMENT MODE: edit existing page ──
          systemMessage += buildRefinementPrompt({
            target: directEditTarget,
            ext,
            isHtml,
            fileContent: refinementFileContent,
          })
        } else {
          // ── NEW BUILD MODE: generate from scratch ──
          systemMessage += buildNewPagePrompt({
            target: directEditTarget,
            ext,
            isHtml,
            fileAction: directEditFileAction || 'create_files',
          })
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

      // Inject prefetched image context + design intelligence
      if (prefetchedImageContext) {
        systemMessage += prefetchedImageContext
      }
      if (designBrief) {
        systemMessage += buildDesignIntelligencePrompt(designBrief)
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
            // Include the base64 data URL so the AI can inline it directly in generated code.
            // For the preview iframe (srcDoc), data URLs are the only reliable way to embed images.
            let dataUrl = att.preview_data || null

            // If not in attachment payload, try loading from DB
            if (!dataUrl && att.path && projectId) {
              try {
                const imgFile = await db.projectFiles.findByPath(projectId, att.path)
                if (imgFile?.content && imgFile.content.startsWith('data:')) {
                  dataUrl = imgFile.content
                }
              } catch (e) {
                console.warn('[AIService] Failed to load image data for attachment:', att.path, e.message)
              }
            }

            // Only inline if the data URL is reasonably sized (< 300KB) to avoid blowing context
            const MAX_INLINE_SIZE = 300_000
            if (dataUrl && dataUrl.startsWith('data:') && dataUrl.length <= MAX_INLINE_SIZE) {
              attachBlock += `### Uploaded Image: ${att.filename}\nThe user uploaded this image. When the user asks you to use this image (as a header, background, logo, etc.), set the \`src\` attribute of an <img> tag to this EXACT data URL. Do NOT shorten or modify it. Copy the entire string as-is.\n\nDATA_URL:\n${dataUrl}\n\n`
            } else if (dataUrl && dataUrl.startsWith('data:')) {
              // Image is too large for context — still include a truncated preview and path reference
              attachBlock += `### Uploaded Image: ${att.filename}\nThe user uploaded a large image stored at project path: \`${att.path}\`. The image data URL is too large to include inline. When the user asks to use this image, reference the stored path and use this truncated data URL prefix: ${dataUrl.slice(0, 200)}...\nNote: For the preview to work, you MUST embed the full data URL. Ask the user to upload a smaller/compressed version of the image if they want it in the live preview.\n\n`
            } else {
              attachBlock += `### Uploaded Image: ${att.filename}\n[Image uploaded — stored at project path: ${att.path}. The image data was not available inline. If the user asks to use this image, suggest they re-upload it.]\n\n`
            }
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

${isNewProjectBuild ? `DESIGN QUALITY FOR NEW PROJECTS:
- Each component file MUST be a visually RICH, production-ready view — NOT a wireframe or stub
- For marketing/landing sites: hero with background image, feature sections, testimonials, footer
- For apps/dashboards/tools: sidebar or top nav, functional UI with forms/inputs/cards, data displays, proper states
- Each file should be 200+ lines of real JSX with rich Tailwind styling
- Plan for SEPARATE component files for each page/view (Home.jsx, Dashboard.jsx, Settings.jsx, etc.) plus an App.jsx router
- Do NOT propose a single page.jsx file for multi-page/multi-view projects
- In file_action descriptions, specify the sections/features each file will contain` : ''}
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
      let toolArgsAccum = ''

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
          toolArgsAccum = ''
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
          const enforcedTaskMode = isBriefBuild ? 'build' : resolveTaskMode(intent)
          if (toolCalls.length > 0) {
            const { hasFileContent, hasFileActions } = inspectToolCalls(toolCalls)
            const tmResult = validateTaskMode(enforcedTaskMode, {
              hasFileActions,
              hasFileContent,
              hasGroundedContext: !!groundedFileContext,
              diffStatus: null,
            })
            if (!tmResult.valid) {
              console.log('[TaskModeEnforcer] Rejected:', JSON.stringify({ event: 'task_mode_rejected', mode: enforcedTaskMode, errors: tmResult.errors }))
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
                      // Always auto-execute revised plans
                      {
                        // Auto-execute revised plan inline
                        yield { event: 'status', data: { stage: 'auto_executing', detail: 'Building (revised)...' } }
                        const revSaved = []
                        try {
                          for await (const evt of this.executePlanStream({ projectId, chatId, userMessage, userId, scope: effectiveScope, designPrefs: activeDesignPrefs, planData: revArgs, runId, startTime, selfEditTarget: null })) {
                            if (evt.event === 'diff_file' && evt.data?.newContent) {
                              const saved = await this.saveFiles(projectId, [{ path: evt.data.path, content: evt.data.newContent, file_type: evt.data.fileType || 'text' }], evt.data.action === 'update')
                              for (const f of saved) { generatedFiles.push(f); revSaved.push(f) }
                              yield { event: 'preview_partial', data: { path: evt.data.path, content: evt.data.newContent } }
                            } else if (evt.event === 'status') { yield evt }
                          }
                        } catch (e) { console.error('[AutoExecute:Revised]', e.message) }
                        if (revSaved.length > 0) {
                          const { text: vText, runtimeEvent } = buildVerifiedResponseWithRuntime(revSaved, userMessage, refinementMode)
                          fullContent = vText
                          if (runtimeEvent) yield runtimeEvent
                        } else {
                          fullContent = `I tried a revised approach but couldn't complete it. Could you try rephrasing?`
                        }
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

                // H7.7.1 Fast Mode — skip SelfCritique for simple prompts and new projects
                const planFileActions = args.file_actions || args.files || []
                const isSimplePrompt = (
                  planFileActions.length <= 2 ||
                  (userMessage.length < 200 && planFileActions.length <= 4)
                )
                const isNewProjectEarly = (fsContext?.scannedCount || 0) === 0
                if (isSimplePrompt || isNewProjectEarly) {
                  console.log(`[FastMode] ${isNewProjectEarly ? 'New project' : 'Simple prompt'} (${planFileActions.length} files) — skipping SelfCritique`)
                }

                // Self-critique: AI reviews its own plan before emission (skip for new projects — no existing code to validate against)
                if (!isSimplePrompt && !isNewProjectEarly && planAttempt < MAX_PLAN_RETRIES) {
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
                          // Always auto-execute self-critique revised plans
                          {
                            yield { event: 'status', data: { stage: 'auto_executing', detail: 'Building (revised)...' } }
                            const revSaved2 = []
                            try {
                              for await (const evt of this.executePlanStream({ projectId, chatId, userMessage, userId, scope: effectiveScope, designPrefs: activeDesignPrefs, planData: revisedArgs, runId, startTime, selfEditTarget: null })) {
                                if (evt.event === 'diff_file' && evt.data?.newContent) {
                                  const saved = await this.saveFiles(projectId, [{ path: evt.data.path, content: evt.data.newContent, file_type: evt.data.fileType || 'text' }], evt.data.action === 'update')
                                  for (const f of saved) { generatedFiles.push(f); revSaved2.push(f) }
                                  yield { event: 'preview_partial', data: { path: evt.data.path, content: evt.data.newContent } }
                                } else if (evt.event === 'status') { yield evt }
                              }
                            } catch (e) { console.error('[AutoExecute:SelfCritique]', e.message) }
                            const { text: rev2Text, runtimeEvent: rev2Rt } = revSaved2.length > 0
                              ? buildVerifiedResponseWithRuntime(revSaved2, userMessage, refinementMode)
                              : { text: `I tried a revised approach but couldn't complete it. Could you try rephrasing?`, runtimeEvent: null }
                            fullContent = rev2Text
                            if (rev2Rt) yield rev2Rt
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

                // Always auto-execute plans directly — no approval card
                const planActions = args.file_actions || []
                const existingFileCount = fsContext?.scannedCount || 0
                const isNewProject = existingFileCount === 0

                // ── Stream plan walkthrough to chat before executing ──
                if (isNewProject && planActions.length > 0) {
                  const briefMatch = userMessage?.match(/(?:Project|Brand name):\s*(.+?)(?:\n|$)/i)
                  const projectLabel = briefMatch ? briefMatch[1].trim() : 'your project'
                  
                  let walkthrough = `Here's my plan for **${projectLabel}**:\n\n`
                  
                  for (let i = 0; i < planActions.length; i++) {
                    const fa = planActions[i]
                    const fileName = fa.path?.replace(/^src\/(components|pages)\//, '').replace(/\.(jsx|tsx|js|ts)$/, '') || fa.path
                    const desc = fa.description || fa.action || 'create'
                    walkthrough += `**${i + 1}. ${fileName}** — ${desc}\n`
                  }
                  
                  walkthrough += `\nBuilding all ${planActions.length} files now...`
                  yield { event: 'token', data: { content: walkthrough } }
                  fullContent = walkthrough
                }

                // ── Auto-execute inline: run plan, save files directly, then emit success ──
                {
                  // ── Auto-execute inline: run plan, save files directly, then emit success ──
                  yield { event: 'status', data: { stage: 'auto_executing', detail: isNewProject ? 'Building your project...' : 'Building...' } }
                  console.log('[AutoExecute]', isNewProject ? 'New project' : 'Safe plan', '— executing inline:', args.summary)

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
                        // Send per-file progress status
                        const builtFileName = evt.data.path?.replace(/^src\/(components|pages)\//, '').replace(/\.(jsx|tsx|js|ts)$/, '') || evt.data.path
                        yield { event: 'status', data: { stage: 'building_file', detail: `Built ${builtFileName} (${savedFiles.length}/${planActions.length})` } }
                        // Emit preview_partial for real-time live preview updates
                        yield { event: 'preview_partial', data: { path: evt.data.path, content: evt.data.newContent } }
                      } else if (evt.event === 'status') {
                        yield evt
                      } else if (evt.event === 'error') {
                        execError = evt.data?.message || 'Unknown error'
                      }
                    }
                  } catch (err) {
                    execError = err.message
                    console.error('[AutoExecute] Error:', err.message)
                  }

                  if (savedFiles.length > 0) {
                    const paths = savedFiles.map(f => f.path).join(', ')
                    if (isNewProject) {
                      // Build a specific, context-aware completion message
                      const fileNames = savedFiles.map(f => {
                        const name = f.path.replace(/^src\/(components|pages)\//, '').replace(/\.(jsx|tsx|js|ts)$/, '')
                        return name
                      }).filter(n => n !== 'App')
                      const pageList = fileNames.length > 0 ? fileNames.join(', ') : 'your pages'
                      
                      // Extract project name from brief if available
                      const briefMatch = userMessage?.match(/(?:Project|Brand name):\s*(.+?)(?:\n|$)/i)
                      const projectName = briefMatch ? briefMatch[1].trim() : 'Your project'
                      
                      // Build specific suggestions based on what was built
                      const suggestions = []
                      const code = savedFiles.map(f => f.content || '').join(' ').toLowerCase()
                      if (!code.includes('usestate') && !code.includes('onclick'))
                        suggestions.push(`Add interactivity — click handlers, form submissions, or toggle states to ${fileNames[0] || 'the main page'}`)
                      if (!code.includes('<form'))
                        suggestions.push('Add a contact form or signup flow with input validation')
                      if (!code.includes('animation') && !code.includes('transition'))
                        suggestions.push('Add entrance animations and hover transitions for a polished feel')
                      if (fileNames.length < 5)
                        suggestions.push(`Add more views — maybe a ${fileNames.includes('About') ? 'Blog' : 'About'} or ${fileNames.includes('Pricing') ? 'FAQ' : 'Pricing'} page`)
                      if (!code.includes('dark') && !code.includes('theme'))
                        suggestions.push('Add a dark/light mode toggle')
                      // Always include at least 3 suggestions
                      if (suggestions.length < 3)
                        suggestions.push('Refine the copy and messaging to match your brand voice')
                      
                      fullContent = `${projectName} is live! I built ${savedFiles.length} files: ${pageList}.\n\nThe preview is updating on the right. Here's what I'd suggest next:\n${suggestions.slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nJust tell me what to change — I'll update it instantly.`
                    } else {
                      const { text: aeText, runtimeEvent: aeRt } = buildVerifiedResponseWithRuntime(savedFiles, userMessage, true)
                      fullContent = aeText
                      if (aeRt) yield aeRt
                    }
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
              } else if (toolName === 'create_files' || toolName === 'update_files') {
                // ── Content Quality Guard: reject files that are descriptions, not code ──
                if (args.files && args.files.length > 0) {
                  const badFiles = args.files.filter(f => {
                    if (!f.content || !f.path) return true
                    const c = f.content.trim()
                    // Must be at least 50 chars and contain code-like syntax
                    const isCode = c.length > 50 && (
                      c.includes('{') || c.includes('<') || c.includes('function') ||
                      c.includes('import ') || c.includes('export ') || c.includes('const ') ||
                      c.includes('class ') || c.includes('@') || c.includes(':root') ||
                      c.includes('#') || c.includes('/*')
                    )
                    return !isCode
                  })
                  if (badFiles.length > 0) {
                    console.warn('[ContentGuard] Detected', badFiles.length, 'file(s) with descriptions instead of code:', badFiles.map(f => f.path + ' (' + (f.content?.length || 0) + ' chars)').join(', '))
                    if (directEditRetry < 1) {
                      directEditRetry++
                      messages.push({ role: 'assistant', content: fullContent || '(incomplete output)' })
                      messages.push({ role: 'user', content: 'CRITICAL: The files you just wrote contain descriptions instead of actual source code. Each file\'s "content" field MUST contain the complete, valid, runnable source code — not a summary or description of what the code should do. Please regenerate ALL files with real code.' })
                      fullContent = ''
                      toolCalls = []
                      continue
                    }
                  }
                }

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
                    const { text: deText, runtimeEvent: deRt } = buildVerifiedResponseWithRuntime(savedFiles, userMessage, refinementMode)
                    fullContent = deText
                    if (deRt) yield deRt
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
                        const { text: s1Text, runtimeEvent: s1Rt } = buildVerifiedResponseWithRuntime(saved, userMessage, true)
                        fullContent = s1Text
                        if (s1Rt) yield s1Rt
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
                    ? `Proposed changes to 1 file. Review the diff below.`
                    : `Proposed changes to ${count} files. Review the diffs below.`
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
            const { text: nbText, runtimeEvent: nbRt } = buildVerifiedResponseWithRuntime(savedFiles, userMessage, false)
            fullContent = nbText
            if (nbRt) yield nbRt
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
                const { text: s2Text, runtimeEvent: s2Rt } = buildVerifiedResponseWithRuntime(saved, userMessage, true)
                fullContent = s2Text
                if (s2Rt) yield s2Rt
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
          const { text: ssText, runtimeEvent: ssRt } = sanitizedSaved.length > 0
            ? buildVerifiedResponseWithRuntime(sanitizedSaved, userMessage, true)
            : { text: `I wasn't able to apply those changes. Could you try rephrasing?`, runtimeEvent: null }
          fullContent = ssText
          if (ssRt) yield ssRt
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

      // ── Response Truncation Detection & Auto-Retry ──
      if (fullContent && !contentWasSanitized && !hasDiffs && generatedFiles.length === 0) {
        const trimmedResp = fullContent.trim()
        const truncationSignals = [
          trimmedResp.endsWith('```') && (trimmedResp.match(/```/g) || []).length % 2 !== 0,
          trimmedResp.endsWith('...') && trimmedResp.length > 100,
          /\b(function|const|let|var|class|import|export)\s*$/.test(trimmedResp),
          /<[a-zA-Z][^>]*$/.test(trimmedResp),
          /\{[^}]*$/.test(trimmedResp) && !trimmedResp.endsWith('}'),
        ]
        const isTruncated = truncationSignals.some(Boolean)
        if (isTruncated) {
          console.warn('[TruncationDetector] Response appears truncated, auto-retrying...')
          yield { event: 'status', data: { stage: 'truncation_retry', detail: 'Response was cut short, regenerating...' } }
          const retryMessages = [
            ...messages,
            { role: 'assistant', content: fullContent },
            { role: 'user', content: 'Your previous response was cut off mid-sentence. Please complete your response from where you left off. Be concise.' },
          ]
          let retryContent = ''
          try {
            for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(retryMessages, { temperature: 0.5, max_tokens: 4096 }))) {
              if (chunk.type === 'token') {
                retryContent += chunk.content
                yield { event: 'token', data: { content: chunk.content } }
              }
            }
            if (retryContent.trim()) {
              fullContent += retryContent
            }
          } catch (retryErr) {
            console.error('[TruncationDetector] Retry failed:', retryErr.message)
          }
        }
      }

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
          proposedPlan: planOutput ? planOutput : null,
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

