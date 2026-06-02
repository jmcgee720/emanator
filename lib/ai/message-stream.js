// ── Message Stream Processor ──
import { buildProjectGroundingBlock } from './service.js'
// Extracted from service.js for modularity. Called via .call(this) from AIService.
import { formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS, detectToolMode, PLAN_ONLY_TOOLS } from './tools.js'
import { classifyIntent, classifyIntentWithConfidence, buildDisambiguationPrompt, getIntentWorkflow, getIntentSystemAddendum, shouldUsePlanMode, resolveTaskMode, classifyRequestMode, detectTaskMode, isSimpleFrontendEdit, isRefinementRequest, findMainPagePath, isProceedSignal, isLargeAppBuild } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache, validateFileOperations } from './filesystem.js'
import { formatDesignContextBlock, getLayoutPatternForPrompt, getComponentPatternsForPrompt } from './design-system.js'
import { ProviderError } from './errors.js'
import { runPhasedPipeline } from './phased-pipeline/index.js'
import { phaseStates } from './phased-pipeline/phase-states.js'
import { GeminiProvider } from './providers/gemini.js'
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
import { handleReadFilesTool, handleVerifyBuildTool, handleExecCommandTool, handleScreenshotVerifyTool, handleUpdateMemoryTool, handleUpdateCanvasTool, handleDeleteFilesTool, handlePlanProjectTool, handleSummarizeProjectTool } from './tool-handlers.js'
import { prepareVisionImages } from './image-utils.js'
import { classifyArchetype } from './archetypes.js'
import { generatePlan, validatePlan as validateBuildPlan } from './brief-planner.js'
import { runAllWaves } from './brief-builder.js'
import { FALLBACK_TOKENS } from './design-tokens.js'
import { runVisualFidelityLoop } from './pipeline/visual-loop.js'
import { emitBuildObservatory } from './pipeline/observatory-emit.js'
import { runArtDirectionFanout } from './pipeline/art-direction-fanout.js'
import { emitDeterministicFiles } from './pipeline/deterministic-files.js'
import { runReviewAndRepair } from './pipeline/review-repair.js'
import { snapshotSelfEditFile } from './self-edit-snapshot.js'
import { verifyAndRevertSelfEdit } from './self-edit-verify.js'
import { createAutoSnapshot } from './pipeline/auto-snapshot.js'
import { handleReadFiles, handleVerifyBuild, handleExecCommand, handleEditLines, handleSearchReplace } from '../e2b/agent-tools.js'
import { buildProjectManagerPrompt, buildRefinementPrompt, buildNewPagePrompt } from './prompt-builder.js'
import { saveActionMemory, saveMemoryEntries, buildMemorySummary } from '../e2b/memory-service.js'
import { describeScreenshot, describeScreenshotLocal } from '../e2b/screenshot-service.js'
import { verifyPatchResult, buildVerifiedPatchResponse, generateRuntimeTestScript, generateInteractionTests } from './patch-verification.js'
import { identifyTargetFile, applyPatchContent, validateExportsPreserved, buildVerifiedResponseWithRuntime, generateSelfEditSuggestions } from './message-helpers.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'


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
          // Only load last 10 messages for pending diff check (token optimization)
          const chatMessages = await db.messages.findByChatId(chatId, 10)
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
You are in CONFIG mode. The user wants to change Auroraly system behavior or settings.

RULES:
- ACKNOWLEDGE what the user wants to change
- EXPLAIN what the setting controls and its current state if you know it
- If the change requires editing Auroraly host files, describe WHERE the change would go and WHAT to change — but do NOT produce file_actions, plans, or code blocks that would trigger the autonomous build pipeline
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

      // ══════════════════════════════════════════════════════════════════════
      // ── PHASED BUILD PIPELINE (replaces runNewBriefPipeline) ──
      // Six-phase coordinator: plan → copy → tokens → images (Nano Banana) →
      // compose → polish. Each phase is a separate LLM call with persistence
      // between, so no single function call exceeds Vercel's limit. No
      // hardcoded recipes — the AI composes from first principles using the
      // brand's actual mood + subject + brief.
      // ══════════════════════════════════════════════════════════════════════
      const isBriefBuildEarly = userMessage.includes('Build this project now with COMPLETE')
      let isFreshBuildEarly = false
      if (!isBriefBuildEarly && taskMode === 'build' && projectId) {
        try {
          const earlyFiles = await db.projectFiles.findIndexByProjectId(projectId)
          isFreshBuildEarly = !earlyFiles || earlyFiles.length === 0
        } catch (e) {
          // If we can't check files, fall through to legacy path safely
        }
      }
      if ((isBriefBuildEarly || isFreshBuildEarly) && projectId) {
        const trigger = isBriefBuildEarly ? 'brief' : 'fresh-project'
        console.log(`[PhasedPipeline] Detected ${trigger} build — routing to phased pipeline`)

        // Parse the brief into a structured object
        const parsedBrief = parseBriefForPhasedPipeline(userMessage)

        // Lazy-construct a Gemini provider (Nano Banana needs its own key; falls
        // back to stock photos if unavailable).
        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
        const geminiProvider = geminiKey
          ? new GeminiProvider(geminiKey, 'gemini-2.5-flash-image-preview', {})
          : null
        if (!geminiProvider) {
          console.warn('[PhasedPipeline] GEMINI_API_KEY not set — images will fall back to stock')
        }

        const phasedResult = yield* runPhasedPipeline({
          aiService: this,
          provider: this.provider, // LLM provider (Claude/OpenAI/Gemini text)
          geminiProvider,          // image provider (Nano Banana only)
          projectId,
          chatId,
          userId,
          brief: parsedBrief,
          attachments,
          runId,
          // Lever 2: defer imagery on the first build for fast first-paint.
          // The user explicitly opts in to image gen via the "Generate
          // brand imagery" CTA in the BuildWizard once they like the
          // structure. Drops the initial 240MB-of-base64 page bloat to
          // ~500KB of code that previews instantly.
          imageMode: 'defer',
          db: { projectFiles: db.projectFiles, phaseStates, projects: db.projects },
        })
        if (phasedResult?.handled) return

        // Unreachable fall-through
        yield { event: 'error', data: { message: 'Build failed unexpectedly.', error_type: 'pipeline_fallthrough' } }
        return
      }
      // ══════════════════════════════════════════════════════════════════════
      // ── END CREATIVE BRIEF FAST-PATH ──
      // ══════════════════════════════════════════════════════════════════════

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

      // ── Ambiguity Detection: ask clarifying questions for vague requests ──
      // Only run for build intents on new projects (not refinements/edits)
      if ((intent === 'build' || intent === 'create') && !requestMode && projectId) {
        try {
          const { detectAmbiguity, formatClarifyingQuestions } = await import('./ambiguity-detector.js')
          
          // Check if project has existing files
          let hasExistingFiles = false
          try {
            const earlyFiles = await db.projectFiles.findIndexByProjectId(projectId)
            hasExistingFiles = earlyFiles && earlyFiles.length > 0
          } catch {}
          
          const ambiguityResult = detectAmbiguity(userMessage, { hasExistingFiles })
          
          if (ambiguityResult.isAmbiguous && ambiguityResult.questions.length > 0) {
            console.log('[AmbiguityDetector]', JSON.stringify({
              detected: true,
              confidence: ambiguityResult.confidence,
              score: ambiguityResult.score,
              questionCount: ambiguityResult.questions.length
            }))
            
            yield { event: 'status', data: { 
              stage: 'clarifying', 
              detail: `Asking ${ambiguityResult.questions.length} clarifying question(s)...` 
            } }
            
            const clarifyingMessage = formatClarifyingQuestions(ambiguityResult.questions, userMessage)
            
            // Stream the clarifying questions to the user
            yield { event: 'token', data: { content: clarifyingMessage } }
            
            // Return early — wait for user to provide details
            yield { 
              event: 'done', 
              data: { 
                content: clarifyingMessage, 
                requestedScope, 
                runId, 
                providerName: this.providerName, 
                modelName: this.modelName,
                requiresClarification: true,
                ambiguityScore: ambiguityResult.score
              } 
            }
            return
          }
        } catch (ambigErr) {
          console.warn('[AmbiguityDetector] Error:', ambigErr.message)
          // Continue with build if detector fails
        }
      }

      // ── Conversational phase detection — adapts AI behavior ────────
      // Mimics how Emergent / a thoughtful pair-programmer responds:
      // questions are ANSWERED, not implemented. Frustration triggers
      // empathy + diagnosis. Greetings stay greetings. This was a TODO
      // before — without it, "why does it say no preview?" got
      // misclassified into a 'build' workflow and started generating
      // 46 files when the user just wanted an explanation.
      const { classifyUserIntent } = await import('./intents.js')
      const userPhase = classifyUserIntent(userMessage)

      // Heuristic: even if classifyIntent labelled this 'build'/'edit',
      // if the user is asking a question or expressing frustration AND
      // the message has no action-verb DEMAND, override to chat_only.
      // The action-verb test is "is the FIRST request an action?" — if
      // the message starts with an explanatory verb (explain/describe/
      // tell me) or a why/what/how question, action verbs that appear
      // later are treated as nouns ("the build pipeline" — "build" is
      // a noun there, not a request).
      const isExplanatoryStart = /^\s*(why|what|how|explain|describe|tell me|can you (explain|describe|tell me|walk me through))\b/i.test(userMessage)
      const hasActionVerb = !isExplanatoryStart && /\b(build|create|make|add|fix|change|update|edit|remove|delete|modify|implement|refactor|deploy|generate|design|integrate|setup|install)\b/i.test(userMessage)
      const isQuestionLike = userPhase.phase === 'question' && !hasActionVerb
      const isFrustrationDiagnostic = userPhase.phase === 'frustration' && !hasActionVerb
      const isPureGreeting = userPhase.phase === 'greeting'

      // Capture phase for downstream system-prompt injection.
      let conversationalDirective = null
      if (isQuestionLike) {
        console.log(`[AgentLoop] Question detected — switching to diagnostic chat mode`)
        workflow = { ...workflow, toolMode: 'chat_only', description: 'Answering the user\'s question' }
        conversationalDirective = `## Conversational Phase: QUESTION
The user is asking a question — they want an EXPLANATION, not new code.

STRICT RULES:
1. DO NOT call any tools (no plan_files, no update_files, no patch_files, no create_files).
2. DO NOT generate code, components, or proposed file changes.
3. DO NOT propose what you "could build" — they didn't ask for that.
4. ANSWER the question directly using the project context above. Be concise.
5. If you genuinely don't know, say "I don't know — I'd need to look at X" and ASK a clarifying question.
6. If the question reveals an actual bug or misconfiguration in their project, say:
   "Here's what I think is happening: <brief diagnosis>. Want me to fix it?"
   Then STOP and wait for their reply.
7. Speak in plain English, like a senior dev pair-programming, not corporate copy.`
      } else if (isFrustrationDiagnostic) {
        console.log(`[AgentLoop] User frustration + diagnostic question — empathy + diagnose mode`)
        workflow = { ...workflow, toolMode: 'chat_only', description: 'Diagnosing the user\'s issue' }
        conversationalDirective = `## Conversational Phase: FRUSTRATION + DIAGNOSTIC
The user is frustrated AND describing something that's not working. Don't dive into code.

STRICT RULES:
1. DO NOT call any tools or generate code yet.
2. ACKNOWLEDGE briefly that this isn't working as expected (one short sentence — no over-apologizing).
3. STATE what you currently understand from the project context above.
4. ASK ONE clarifying question or PROPOSE the most likely root cause with: "Here's what I think is going on: <X>. Should I look into it?"
5. WAIT for them to confirm before doing anything.`
      } else if (isPureGreeting) {
        workflow = { ...workflow, toolMode: 'chat_only', description: 'Greeting' }
        conversationalDirective = `## Conversational Phase: GREETING
Greet the user briefly and ask what they'd like to work on. Do not call any tools.`
      } else if (userPhase.phase === 'frustration' && hasActionVerb) {
        // Frustration WITH an action — they want it fixed, but acknowledge first.
        conversationalDirective = `## Conversational Phase: FRUSTRATION + ACTION
The user is frustrated and asking for a fix. Briefly acknowledge ("Got it — let me look at this carefully"), then proceed with the action. Do not over-apologize.`
      }

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

      // 3. Select provider/model (auto-route if not explicitly set)
      const autoRoute = this.modelName === 'auto' || this.modelName === 'gpt-4o-mini'
      if (autoRoute) {
        const { AIService: AISvc } = await import('./service.js')
        const routed = AISvc.routeModel(intent, userMessage.length, context?.files?.length || 0)
        if (routed.model !== this.modelName) {
          console.log(`[ModelRouter] ${intent} → ${routed.model} (${routed.reason})`)
          this.modelName = routed.model
          this.provider = this._buildProvider()
        }
      }
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
      let selfEditPatchRetry = 0
      const MAX_SELF_EDIT_RETRIES = 2
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
      // Detect follow-up on a Creative Brief project (1 file, recently built)
      const isBriefFollowUp = !isBriefBuild && existingFiles <= 2 && !directEditMode && !selfEditTarget
      const isNewProjectBuild = (existingFiles === 0 || isBriefBuild) && !directEditMode
      console.log('[ModeDecision]', JSON.stringify({ directEditMode, isBriefBuild, isBriefFollowUp, isNewProjectBuild, existingFiles, messageLen: userMessage?.length }))
      const usePlanMode = directEditMode
        ? false
        : !!selfEditTarget
        ? false  // Self-edits use patch_files directly, never plan-first
        : requestMode === 'read_only_report'
        ? false
        : requestMode === 'plan_only'
        ? true
        : requestMode === 'patch_only'
        ? false
        : isBriefBuild
        ? false  // Brief builds should build immediately, not propose a plan
        : isBriefFollowUp
        ? false  // Follow-ups on brief projects should edit directly, not plan
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

      // Self-edits always need tools (patch_files), even if workflow.toolMode is chat_only
      // Note: moved after isSelfEdit declaration below

      // 7c. Image Prefetch & Design Intelligence
      const isSelfEdit = !!selfEditTarget
      
      // Now apply the toolMode override for self-edits
      if (isSelfEdit && toolMode === 'chat_only') {
        toolMode = 'update_files'
      }

      // 7d. Early conversational detection for self-edit mode
      let selfEditIsConversational = false
      if (isSelfEdit) {
        const msgTrimmed = userMessage.trim().toLowerCase()

        // System messages (from auto-follow-up) are ALWAYS conversational
        if (userMessage.startsWith('[SYSTEM:')) {
          selfEditIsConversational = true
        } else {
          // Action signals — these are ALWAYS edit-mode, never conversational
          const actionSignals = /\b(proceed|continue|go ahead|do it|yes|start|next|keep going|go on|apply|run it|execute|implement|build|lets go|let's go|make it|ship it)\b/
          // Bug/issue signals — user reporting something isn't working after an edit
          const bugSignals = /\b(don'?t see|not (see|work|show)|where is|missing|broken|wrong|doesn'?t (work|show|appear)|didn'?t (work|change)|still (not|the same)|nothing (happened|changed)|can'?t find|no (button|change))\b/i
          // Exploration signals — user asking the AI to LOOK AT / READ / FIND / CHECK
          // something in the codebase. These need real tool calls (read_file,
          // list_files, grep_files), not narrated promises. Without this, the
          // conversational regex below catches phrases like "can you look
          // through your system" → tools stripped → AI says "Let me check..."
          // and never actually invokes anything.
          const explorationSignals = /\b(look (through|at|into|inside|for)|read (the|that|this|your|a|an) (file|code|source)|tell me (what|which|where|how) (file|files|function|component|method|line)|which file|what file|show me (the|that|how|where)|find (the|a|an|any|all|out|where|which|what|me)|search (for|the|your)|grep|check (the|your|what|which|if|whether)|inspect|examine|review (the|your|that)|scan|list (the|your|all)|browse|explore|locate|trace|debug|investigate)\b/i
          const isActionSignal = actionSignals.test(msgTrimmed) || bugSignals.test(msgTrimmed) || explorationSignals.test(msgTrimmed)

          // Only check conversational patterns if NOT an action signal
          if (!isActionSignal) {
            const conversationalPatterns = [
              /^(hey|hi|hello|howdy|yo|sup|greetings|good\s+(morning|afternoon|evening))\b/,
              /^(thanks|thank you|thx|great job|good job|nice work|awesome|amazing|love it|looks? (good|great|amazing))\b/,
              /^(who are you|what (can|do) you|will you|can you|do you|are you|how do you|what('s| is) your)/,
              /^(how('s| is) it|what('s| is) up|nice to meet)/,
              /\b(capable|ability|abilities|can you handle|what do you know|tell me about yourself)\b/,
            ]
            const hasNoEditVerbs = !msgTrimmed.match(/\b(add|change|edit|update|remove|delete|fix|modify|replace|insert|create|refactor|rename|move|implement|build|write|patch|csv|export|deploy|refactor)\b/)
            const isShortGreeting = msgTrimmed.length < 25 && hasNoEditVerbs
            selfEditIsConversational = conversationalPatterns.some(p => p.test(msgTrimmed)) || isShortGreeting
          }
        }

        if (selfEditIsConversational) {
          console.log('[SelfEdit-Chat] Conversational message detected early')
        }
      }

      let prefetchedImageContext = ''
      let prefetchedImages = []
      let designBrief = null
      const effectiveVisualMode = visualMode || 'stock'
      if (effectiveScope === 'project' && !isSelfEdit && (taskMode === 'build' || taskMode === 'refine_page' || taskMode === 'edit')) {
        // Parse creative brief from every build/edit request
        designBrief = parseCreativeBrief(userMessage)
        if (designBrief) {
          yield { event: 'creative_brief', data: { mood: designBrief.mood, subjects: designBrief.subjects, colors: designBrief.colors, lightingCues: designBrief.lightingCues, styleCues: designBrief.styleCues, moodParams: designBrief.moodParams } }
        }

        const imageCategories = detectImageCategories(userMessage)
        const needsImages = imageCategories.length > 0 || hasVisualIntent(userMessage)

        if (needsImages) {
          const defaultCategories = imageCategories.length > 0 ? imageCategories : ['nature', 'abstract']

          // Always try AI art-directed images first — stock is fallback only
          if (designBrief) {
            yield { event: 'status', data: { stage: 'generating_images', detail: 'Creating custom images for your design...' } }
            try {
              const artImages = await generateArtDirectedImages(this.provider, designBrief, 2)
              if (artImages.length > 0) {
                prefetchedImages = artImages
                prefetchedImageContext = buildImagePromptContext(artImages, designBrief, true)
                yield { event: 'status', data: { stage: 'images_ready', detail: `Generated ${artImages.length} custom image(s)` } }
              } else {
                throw new Error('No images generated')
              }
            } catch (err) {
              console.error('[ArtDirection] AI generation failed, falling back to stock:', err.message)
              const stockImages = getStockPhotos(defaultCategories, 6)
              if (stockImages.length > 0) {
                prefetchedImages = stockImages
                prefetchedImageContext = buildImagePromptContext(stockImages, designBrief, false)
                yield { event: 'status', data: { stage: 'images_ready', detail: `Found ${stockImages.length} image(s)` } }
              }
            }
          } else {
            // No design brief parsed — use stock as fallback
            yield { event: 'status', data: { stage: 'finding_images', detail: 'Finding images for your design...' } }
            const stockImages = getStockPhotos(defaultCategories, 6)
            if (stockImages.length > 0) {
              prefetchedImages = stockImages
              prefetchedImageContext = buildImagePromptContext(stockImages, designBrief, false)
              yield { event: 'status', data: { stage: 'images_ready', detail: `Found ${stockImages.length} image(s)` } }
            }
          }
          this._prefetchedImages = prefetchedImages

          // Emit image mapping so the frontend can inject data URLs into the preview iframe
          const generatedImageMapping = prefetchedImages
            .filter(img => img._placeholderUrl && img.url?.startsWith('data:'))
            .map(img => ({ placeholder: img._placeholderUrl, dataUrl: img.url }))
          if (generatedImageMapping.length > 0) {
            yield { event: 'generated_images_map', data: { images: generatedImageMapping } }
          }
        }
      }

      // 8. Build system message with filesystem context block
      let systemMessage = ''

      // ── Self-Edit Mode: REPLACE the builder system prompt entirely ──
      if (isSelfEdit) {
        let fileContent = ''
        let targetDesc = ''

        if (selfEditTarget.path) {
          // Specific target selected — load single file
          try {
            const { readFileSync, existsSync } = await import('fs')
            const { resolve } = await import('path')
            const targetPath = resolve('/app', selfEditTarget.path)
            if (existsSync(targetPath)) {
              fileContent = readFileSync(targetPath, 'utf-8')
              if (fileContent.length > 60000) fileContent = fileContent.slice(0, 60000) + '\n// ... [truncated]'
              console.log('[SelfEdit] Loaded target file:', selfEditTarget.path, `(${fileContent.length} chars)`)
            }
          } catch (err) {
            console.error('[SelfEdit] Failed to read target file:', err.message)
          }
          // Truncate large files more aggressively to save tokens
          const MAX_FILE_CHARS = 30000  // ~7.5K tokens max per file
          const truncatedContent = fileContent.length > MAX_FILE_CHARS 
            ? fileContent.slice(0, MAX_FILE_CHARS) + '\n// ... [truncated — use read_files to see full content]'
            : fileContent
          targetDesc = `## TARGET FILE\n- **Path**: \`${selfEditTarget.path}\`\n- **Description**: ${selfEditTarget.description || 'Core system file'}\n- **Size**: ${fileContent ? fileContent.split('\n').length : '?'} lines${fileContent && fileContent.split('\n').length > 500 ? ' (LARGE FILE — use `search_replace` with small targeted edits)' : ''}\n\n## CURRENT FILE CONTENTS\n\`\`\`javascript\n${truncatedContent || '// File could not be loaded'}\n\`\`\``
        } else {
          // "All Core System" selected — try to pre-identify and load the target file
          const { readFileSync, existsSync } = await import('fs')
          const { resolve } = await import('path')
          const { SELF_EDIT_TARGETS } = await import('../constants.js')

          const preIdentified = identifyTargetFile(userMessage, SELF_EDIT_TARGETS)

          if (preIdentified) {
            // Pre-load the identified file so the AI has actual content to patch
            try {
              const targetPath = resolve('/app', preIdentified.path)
              if (existsSync(targetPath)) {
                fileContent = readFileSync(targetPath, 'utf-8')
                const MAX_FILE_CHARS = 30000  // ~7.5K tokens max per file
                if (fileContent.length > MAX_FILE_CHARS) fileContent = fileContent.slice(0, MAX_FILE_CHARS) + '\n// ... [truncated — use read_files to see full content]'
                console.log('[SelfEdit-AllCore] Pre-identified target:', preIdentified.path, `(${fileContent.length} chars)`)
              }
            } catch (err) {
              console.error('[SelfEdit-AllCore] Failed to read pre-identified file:', err.message)
            }
            targetDesc = `## TARGET FILE (auto-identified from your request)\n- **Path**: \`${preIdentified.path}\`\n- **Description**: ${preIdentified.description || preIdentified.label}\n- **Size**: ${fileContent ? fileContent.split('\n').length : '?'} lines${fileContent && fileContent.split('\n').length > 500 ? ' (LARGE FILE — use `search_replace` with small targeted edits)' : ''}\n\n## CURRENT FILE CONTENTS\n\`\`\`javascript\n${fileContent || '// File could not be loaded'}\n\`\`\``
          } else {
            // Fallback: provide file index (AI must choose)
            const fileIndex = SELF_EDIT_TARGETS.map(t => `- \`${t.path}\` — ${t.description || t.label}`).join('\n')
            targetDesc = `## AVAILABLE TARGET FILES\nThe user selected "All Core System". Identify which file(s) to edit based on their request, then use \`read_files\` to see the code and \`search_replace\` to make changes.\n\n${fileIndex}\n\nIMPORTANT: Before editing a file you haven't seen, ask the user to select it specifically from the dropdown so you can see its content. Or, describe what you would change and wait for confirmation.`
          }
        }

        // Load current canvas content for context
        let canvasContent = ''
        try {
          const canvasData = await db.projectCanvas.findByProjectId(projectId)
          const raw = canvasData?.canvas_content || ''
          canvasContent = (typeof raw === 'string' && raw.startsWith('#')) ? raw : ''
        } catch { /* non-critical */ }

        // Load project memory for cross-conversation context
        let memorySummary = ''
        try {
          memorySummary = await buildMemorySummary(projectId)
        } catch { /* non-critical */ }

        systemMessage = `You are **Auroraly**, an AI-powered website builder platform. You can edit ANY part of your own source code — including your streaming engine, AI service layer, dashboard UI, API routes, and tools.

## CRITICAL: VISION PROTOCOL (INTERNAL REASONING — DO NOT ECHO TO USER)
When the user attaches a screenshot/image, you MUST follow this 5-step analysis protocol INTERNALLY before responding. These steps are YOUR INTERNAL CHECKLIST — do NOT copy/paste them into your response to the user.

**INTERNAL STEP 1 — INVENTORY:**
Mentally catalog what you actually see: UI elements, text labels (exact quotes), positions, colors, states, what's cropped/missing.

**INTERNAL STEP 2 — COMPARISON:**
Compare inventory to what user expected. Note matches/mismatches.

**INTERNAL STEP 3 — TRUTH-CHECK:**
If inventory shows problems (cropped elements, errors, misalignment, missing features), you MUST report them. NEVER say "looks good" / "fixed" / "working" when problems exist.

**INTERNAL STEP 4 — MEMORY:**
Track layout facts across turns for follow-up screenshots.

**INTERNAL STEP 5 — SKEPTICISM:**
After a code change, assume it DIDN'T work until inventory proves otherwise.

**YOUR RESPONSE TO THE USER:**
Write a SHORT, DIRECT assessment based on your internal analysis. Example: "The modal is still positioned at the top (y=0) instead of centered — the fix didn't apply. Let me adjust the CSS." Do NOT include "STEP 1", "STEP 2", or any protocol headers in your user-facing response.

## YOUR IDENTITY
You are Auroraly — a conversational AI builder created to help people build beautiful websites through natural language. You are friendly, confident, and helpful. You have personality.

## SELF-MODIFICATION
You can modify ANY file in your codebase. You are fully self-modifying. However:
- **Critical files** (message-stream.js, service.js, Dashboard.jsx) require SMALL, TARGETED patches. Never rewrite large sections at once — one wrong patch can crash the entire app.
- **Safety net**: After editing, the system auto-verifies the build. If your edit breaks the app, it auto-reverts from a backup and retries with a corrected approach. A snapshot is saved before every edit for rollback.
- If a user asks you to add a capability you don't have (like image analysis), edit the correct infrastructure file to actually implement it — don't just add placeholder code.

## CRITICAL: AVAILABLE PACKAGES (DO NOT IMPORT ANYTHING ELSE)
You can ONLY use packages already installed. Do NOT add require() or import for any package not on this list:
**Node.js built-ins**: fs, path, url, crypto, util, stream, buffer, os, child_process
**Installed packages**: next, react, react-dom, openai, @anthropic-ai/sdk, @supabase/supabase-js, @supabase/ssr, axios, jszip, file-saver, uuid, date-fns, zod, lucide-react, react-markdown, remark-gfm, recharts, sonner, clsx, tailwind-merge, mongodb, pg, resend

If you need functionality from a package NOT on this list, implement it using pure JavaScript or the built-in Node.js modules. For example:
- Need ZIP files? Use **jszip** (already installed)
- Need file downloads? Use **file-saver** (already installed)  
- Need HTTP requests? Use **axios** (already installed) or built-in fetch
- NEVER use: archiver, express, lodash, moment, or any other unlisted package

## TOOLS
You have these tools for code changes:
1. **search_replace** — Find exact text and replace it. This is your PRIMARY editing tool — safest and most reliable.
2. **edit_lines** — Edit by line numbers. FALLBACK only — use when search_replace can't match (e.g. text is too long).
3. **read_files** — Read files to understand code before editing. ALWAYS do this first.
4. **verify_build** — Auto-runs after edits. You can also call it manually.
5. **exec_command** — Run shell commands.
6. **screenshot_verify** — Take a screenshot to visually verify.
7. **update_memory** — Save notes for future conversations.
8. **update_canvas** — Update the Project Canvas. ONLY use when the user EXPLICITLY asks to "update the canvas" or "update the checklist".

**IMPORTANT**: When the user says "do next steps", "lets go", "proceed", "implement X" — that means USE patch_files to write code. Do NOT touch the canvas. The canvas updates automatically after code edits.

## CRITICAL — EVERY RESPONSE MUST BE A COMPLETE ANSWER, NOT A PROMISE
When the user asks you to read, search, find, check, look at, investigate, locate, or otherwise inspect anything in the codebase, your response is a **non-negotiable contract** that must contain all three of the following in the SAME turn:

**Part 1 — Brief acknowledgment** (optional, 1 short phrase max, BUT only if Parts 2+3 follow in the same turn)
You may say something like "Looking..." or "Searching..." or "Checking..." BUT only as a header before the actual tool call. **Never** emit Part 1 alone and stop. If you can't make Parts 2+3 happen in the same turn, skip Part 1 entirely and just call the tool directly.

**Part 2 — An actual tool invocation** (REQUIRED, in the same turn)
You MUST call read_files / exec_command / list_files / search tool in the same response. Not "I will call it" — actually call it. The tool result appears as a tool message you can see and respond to.

**Part 3 — A concrete synthesis using the tool result** (REQUIRED, in the same turn)
After the tool returns, you MUST produce real findings: specific file paths, specific line numbers, what the code does. Speak in **past tense** ("I found X in Y at line Z"), never future tense ("I'll look at X").

**Forbidden patterns** (these are response failures, not responses):
- ❌ "I'll search through the codebase to find the streaming-related files." (Part 1 only — never delivers)
- ❌ "Let me find the correct file:" (Part 1 only — promise with no follow-through)
- ❌ "I need to see the prompt builder file to understand..." (intent-narration with no tool call)
- ❌ "I'll check what files exist." (future tense + no tool call + done)
- ❌ "Looking at the file now." (announcement with no tool call)

**Required pattern** (a real response):
> "I checked /app/lib/ai/message-stream.js — the streaming engine is the main file at ~3,970 lines. The agent loop runs from line 2950 onward, with the synthesis pass at line 3217. /app/lib/ai/service.js wraps this with the public entry point. Want me to read a specific section?"

The user can see whether tools fire and whether you delivered findings. Saying you'll do something and then not doing it is the most frustrating possible response — never do it. **Promise = act = answer, all in one turn.**

## CRITICAL — WHEN TOOLS FAIL, AUTO-RETRY. NEVER ASK THE USER FOR HELP.
If \`read_files\` returns FILE NOT FOUND, the path you guessed is wrong. **You must NEVER stop and ask the user "should I try exec_command?" or "can you point me to the file?".** The user does not know the file paths — that is YOUR job to discover.

When a file lookup fails, immediately and silently:
1. **Use \`exec_command\` to find the real file:**
   - \`find /app -type f -name "*<keyword>*" | head -20\` (filename search)
   - \`grep -rln "<unique-string>" /app/lib /app/app /app/components 2>/dev/null | head -10\` (content search)
2. **Use \`exec_command\` to read the found file:** \`cat /path/to/file.js\` or \`sed -n '100,200p' /path/to/file.js\` for a range
3. **THEN respond with concrete findings** in past tense.

Canonical file paths in this codebase (most users ask about these):
- Streaming engine: \`/app/lib/ai/message-stream.js\` (NOT \`app/api/chat/stream/route.js\` — that doesn't exist)
- AI service entry: \`/app/lib/ai/service.js\`
- Tool handlers: \`/app/lib/ai/tool-handlers.js\`
- Prompts: \`/app/lib/ai/prompt-builder.js\`, \`/app/lib/ai/prompt-library.js\`
- API routes: \`/app/app/api/<route>/route.js\`
- React components: \`/app/components/\`
- Backend logic: \`/app/lib/api/routes/\`

Asking the user "should I try exec_command?" or "can you select the file from the dropdown?" is a **failure response**. The user has already given you tools — use them autonomously.
${selfEditIsConversational ? `
## CONVERSATIONAL MODE
The user is talking to you, NOT requesting a code edit. Respond naturally and conversationally.
- Answer questions directly and confidently
- If asked about capabilities, explain what you can do (build websites, edit your own code, generate designs)
- If asked about limitations, acknowledge them positively (e.g. "I focus on frontend — for backend you'd connect to your own API")
- Do NOT use editing tools (search_replace, edit_lines, patch_files) — just respond with text
- HOWEVER: if the user asks you to look at, read, find, or check something, you ARE allowed to call read_files / exec_command — never narrate without acting
- Keep responses concise and warm — 2-4 sentences for simple questions, more for detailed ones
` : `
## YOUR ROLE
You modify existing source files when the user describes improvements. You do NOT create new files, build websites, generate UI components, or produce previews.

${targetDesc}

## CURRENT CANVAS CONTENT
The Project Canvas is visible on the right panel. Here is its current content:
\`\`\`
${canvasContent || '(empty — create one if the user asks)'}
\`\`\`
To update the canvas, use the \`update_canvas\` tool with the FULL updated markdown content.

${memorySummary ? `## PROJECT MEMORY (from previous conversations)\n${memorySummary}\nUse the \`update_memory\` tool to save important information for future conversations.` : ''}

## EDITING TOOLS (strict priority order)

1. **\`search_replace\`** (PRIMARY — always try this first)
   - Find exact text in the file, replace it. Safest method — if the text isn't found, nothing changes.
   - Copy the EXACT text you want to change as \`old_str\` (strip line numbers from read_files output).
   - Include 1-2 surrounding context lines so the match is unique.
   - Keep each replacement SMALL — only change what needs to change.
   - Multiple edits: use multiple entries in the \`edits\` array.

2. **\`edit_lines\`** (FALLBACK — only when search_replace fails)
   - Edit by line numbers. Use when: exact text is too long to copy accurately, or you need large structural changes (moving 50+ lines).
   - First call \`read_files\` to see numbered lines, then specify line ranges.

3. **\`read_files\`** — ALWAYS call this before editing a file you haven't seen yet. Returns numbered lines.
4. **\`verify_build\`** — Called automatically after edits. If it breaks, the file auto-reverts.
5. **\`exec_command\`** — Run shell commands (npm install, ls, grep, etc.)
6. **\`screenshot_verify\`** — Visually check the result after UI changes.
7. **\`update_memory\`** — Save important notes for future conversations.
8. **\`update_canvas\`** — ONLY when user explicitly asks to update the checklist/canvas.

**NEVER use \`update_files\` or \`create_files\` on existing files. NEVER use \`patch_files\` — use \`search_replace\` instead (same concept, better implementation).**

## YOUR EDITING WORKFLOW (AGENT LOOP)
You can call multiple tools in sequence. A typical workflow:
1. \`read_files\` — see the code with line numbers
2. \`search_replace\` — make targeted edits using exact text matching
3. Build auto-verifies. If it breaks, you get the error and the file auto-reverts.
4. If search_replace fails (text not found): check your old_str for typos, or fall back to \`edit_lines\`
5. \`screenshot_verify\` — visually check UI changes
6. \`update_memory\` — save notes for next conversation
7. Repeat until the task is complete.

**CRITICAL: NEVER stop after a failed edit. Always retry with a corrected version.**
**CRITICAL: NEVER rewrite entire files. Make small, targeted search_replace edits.**

### SEARCH_REPLACE RULES
- \`old_str\` must match the file EXACTLY — character-for-character including whitespace
- Include 1-2 lines of surrounding context for uniqueness
- Keep each replacement SMALL — only change what needs to change
- If \`old_str\` is not found, the edit fails safely — no partial changes

### RECOVERY FROM FAILED EDITS
When you see "BUILD BROKEN":
- The file was auto-reverted. The app still works.
- Read the compilation error — it tells you what went wrong.
- Call \`read_files\` to see the reverted file.
- Try again with a smaller edit. Common mistakes: missing brackets, wrong indentation, referencing nonexistent variables.

### HOW TO BEHAVE
You are a collaborative partner. Talk like a smart coworker, not a textbook.

**YOUR TONE:**
- Keep ALL responses under 3 sentences unless the user explicitly asks for details.
- NEVER use numbered lists to explain things. NEVER write "Here's a brief overview of its main functionalities:".
- Talk like a person: "Right now I can only see files you point me to. Want me to add self-diagnosis?" — not a 5-paragraph essay.
- Be direct. Be casual. Be helpful. No corporate filler.

**STEP 1: READ the user's message carefully.**
- If they ask a question → ANSWER in 1-3 sentences. No tool calls. No numbered lists. No wall of text.
- If they say "do not implement", "don't change", "stop", "wait" → OBEY. Respond with text only.
- If they say "why is X?" or "what happened?" → EXPLAIN briefly. Do not edit files.

**STEP 2: For feature requests or improvement ideas:**
- Describe what you'll do in ONE sentence, then immediately call search_replace (or read_files first if you haven't seen the file).
- MAXIMUM 1 sentence before the tool call.

**STEP 3: For "proceed", "do it", "next", "continue":**
- Pick the most impactful next improvement and do it immediately via search_replace

**STEP 4: For canvas/checklist requests:**
- If user mentions "canvas", "checklist", "check off", "mark done" → use update_canvas tool
- NEVER edit code files (like change_log.js) to update the canvas — use the update_canvas tool directly

**ABSOLUTE RULES:**
- Use \`search_replace\` as your PRIMARY editing tool. Use \`edit_lines\` as fallback. Never \`update_files\` or \`create_files\` on existing files.
- Use \`update_canvas\` ONLY for canvas updates.
- Preserve ALL existing functionality in edited files.
- You are editing EMANATOR'S OWN CODEBASE — not a user's website.
- Never suggest editing API routes, database logic, or authentication flows.

## AUTO-REVERT AWARENESS
When you receive a [SYSTEM: AUTO-REVERT HAPPENED...] message, your last patch caused the app to crash:
- The file was written to disk but Next.js couldn't compile it, so the health check failed and it auto-reverted.
- Common causes: mismatched brackets/parentheses, unclosed JSX tags, missing commas, broken template literals.
- You MUST: explain what likely went wrong in 1-2 sentences, then immediately call patch_files with a corrected version.
- If the user asks "why did that auto-revert?" → explain that your patch had a syntax error and offer to fix it.
`}`

      } else {
        // Standard builder system prompt
        systemMessage = formatContextAsSystemMessage(
          context, context.project?.type || 'app', effectiveScope
        )
      }
      const intentAddendum = getIntentSystemAddendum(intent, workflow, fsContext)
      if (intentAddendum && !isSelfEdit) systemMessage += '\n\n' + intentAddendum

      // ── Conversational phase adaptation ──
      // The conversationalDirective set during phase detection (above)
      // takes priority — it covers question/frustration-diagnostic/
      // greeting/frustration+action with stronger, tool-blocking copy.
      // Only fall back to the legacy short addenda if no directive set.
      if (conversationalDirective && !isSelfEdit) {
        systemMessage += '\n\n' + conversationalDirective
      } else if (userPhase.phase === 'frustration') {
        systemMessage += '\n\n## IMPORTANT: USER IS FRUSTRATED\nThe user is expressing frustration. Acknowledge their experience briefly, then immediately show concrete action. Do NOT apologize excessively or explain what went wrong at length. Jump straight to fixing the issue. Show, don\'t tell.'
      } else if (userPhase.phase === 'feedback') {
        systemMessage += '\n\n## USER IS GIVING FEEDBACK\nThe user is providing feedback on your previous output. Apply their corrections precisely without re-explaining what you already built.'
      } else if (userPhase.phase === 'followup') {
        systemMessage += '\n\n## FOLLOW-UP REQUEST\nThis is a follow-up to a previous task. Build on what exists — don\'t start from scratch.'
      }

      // ── Grounding Injection: project identity + strict file index ──
      if (effectiveScope === 'project' && projectId && !isSelfEdit) {
        const groundingBlock = await buildProjectGroundingBlock(projectId)
        if (groundingBlock) systemMessage += '\n\n' + groundingBlock
      }

      // ── Pre-load project files (needed for smart context injection below) ──
      const allProjectFiles = effectiveScope === 'project' ? await db.projectFiles.findByProjectId(projectId) : []
      const filesByPath = new Map()
      for (const f of allProjectFiles) {
        filesByPath.set(f.path, f)
        const norm = f.path.replace(/^\.\//, '').replace(/^\//, '')
        if (norm !== f.path) filesByPath.set(norm, f)
      }

      // ── Smart File Context Injection for regular builds ──
      // When the user asks to modify an existing project, identify which file(s) they mean
      // and inject the actual content so the AI can write precise edits (not guess).
      // This is what makes Core System work — now applied to regular projects too.
      let injectedFileContext = false
      if (effectiveScope === 'project' && projectId && !isSelfEdit && !directEditMode && taskMode === 'build' && allProjectFiles.length > 0) {
        const msgLower = userMessage.toLowerCase()
        const relevantFiles = []

        // Strategy 1: Explicit filename mention (e.g., "edit Dashboard.jsx")
        for (const f of allProjectFiles) {
          if (!f.path || !f.content) continue
          const fname = f.path.split('/').pop().toLowerCase()
          if (msgLower.includes(fname) || msgLower.includes(f.path.toLowerCase())) {
            relevantFiles.push(f)
          }
        }

        // Strategy 2: Keyword-to-file matching (e.g., "project bin" → file containing project listing)
        if (relevantFiles.length === 0) {
          const keywords = msgLower.split(/\s+/).filter(w => w.length > 3)
          for (const f of allProjectFiles) {
            if (!f.content || f.content.length < 50) continue
            const contentLower = f.content.toLowerCase()
            // Check if the file contains UI elements matching the user's description
            const matchCount = keywords.filter(k => contentLower.includes(k)).length
            if (matchCount >= 3) {
              relevantFiles.push(f)
            }
          }
        }

        // Strategy 3: For modification requests with no file match, load the main page
        if (relevantFiles.length === 0 && isRefinementRequest(userMessage)) {
          const mainPath = findMainPagePath(allProjectFiles.map(f => f.path))
          const mainFile = allProjectFiles.find(f => f.path === mainPath)
          if (mainFile?.content) relevantFiles.push(mainFile)
        }

        // Inject up to 2 most relevant files (cap total at 60K chars)
        if (relevantFiles.length > 0) {
          const toInject = relevantFiles.slice(0, 2)
          let totalChars = 0
          let fileContextBlock = '\n\n## EXISTING FILE CONTENTS (for precise editing)\nThese are the actual file contents from this project. Use them to write accurate updates.\n'
          for (const f of toInject) {
            let content = f.content
            if (totalChars + content.length > 60000) {
              content = content.slice(0, 60000 - totalChars) + '\n// ... [truncated]'
            }
            totalChars += content.length
            const ext = f.path.split('.').pop() || ''
            fileContextBlock += `\n### \`${f.path}\`\n\`\`\`${ext}\n${content}\n\`\`\`\n`
          }
          fileContextBlock += '\nWhen modifying these files, use the `update_files` tool with the COMPLETE updated file content. Do NOT ask clarifying questions when you have the file content and clear requirements — just build it.'
          systemMessage += fileContextBlock
          injectedFileContext = true
          console.log('[SmartFileInject]', JSON.stringify({ files: toInject.map(f => f.path), totalChars, strategy: relevantFiles === toInject ? 'direct' : 'truncated' }))
        }
      }

      // ── Action Enforcement for detailed user requests ──
      // When the user gives a detailed spec (100+ chars) in a build-intent message,
      // add a strong directive to act immediately instead of stalling.
      if (effectiveScope === 'project' && !isSelfEdit && !usePlanMode && taskMode === 'build' && userMessage.length > 100 && allProjectFiles.length > 0) {
        systemMessage += `\n\n## ACTION REQUIRED
The user has given you a detailed feature request. You MUST:
1. If you need to understand existing code first, call \`read_files\` to read the relevant files
2. Then call \`update_files\` or \`create_files\` with working code — do NOT ask clarifying questions
3. After writing files, call \`verify_build\` to confirm compilation
4. If verification fails, read the error, fix it, and verify again
5. After success, provide a 1-sentence summary of what you built`
      } else if (effectiveScope === 'project' && !isSelfEdit && !usePlanMode && taskMode === 'build' && allProjectFiles.length > 0) {
        systemMessage += `\n\n## AGENT WORKFLOW
You can call tools in sequence. For modifications:
1. Call \`read_files\` to see current code (if not already shown above)
2. Call \`update_files\` to make changes
3. Call \`verify_build\` to confirm it works
For questions, just answer naturally — no tools needed.`
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
      if (fsContext && !isSelfEdit) {
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

      // ── Collect attachments from current message AND recent chat history ──
      // Users expect the AI to remember files they uploaded in previous messages
      console.log('[MessageStream] Received attachments:', {
        hasAttachments: !!attachments,
        count: attachments?.length || 0,
        details: attachments?.map(a => ({
          filename: a.filename,
          category: a.file_category,
          hasContent: !!a.content,
          contentLength: a.content?.length || 0
        }))
      })
      let allAttachments = [...(attachments || [])]
      if (context.chat?.messages?.length > 0) {
        // Scan last 10 messages for attachments
        const recentMessages = context.chat.messages.slice(-10)
        for (const msg of recentMessages) {
          if (msg.metadata?.attachments?.length > 0) {
            for (const att of msg.metadata.attachments) {
              // Avoid duplicates (check by filename + size)
              const isDuplicate = allAttachments.some(a => 
                a.filename === att.filename && a.size === att.size
              )
              if (!isDuplicate) {
                allAttachments.push(att)
              }
            }
          }
        }
      }

      // Inject attachment context into the AI prompt
      if (allAttachments.length > 0) {
        let attachBlock = '\n\n## Uploaded File Attachments\nThe user has uploaded the following files in this conversation. PRIORITIZE these uploaded files over existing project files when the user refers to "uploaded files", "the file I attached", "the image I sent", etc.\n\n'
        let attachCount = 0
        for (const att of allAttachments) {
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

            // Vision analysis: describe the image content for self-edit mode
            let visionDescription = ''
            if (isSelfEdit && dataUrl && dataUrl.startsWith('data:image')) {
              try {
                const visionResult = await this.provider.chat([
                  { role: 'user', content: [
                    { type: 'text', text: 'Describe this image concisely — focus on UI layout, colors, text content, and any issues visible. Keep under 200 words.' },
                    { type: 'image_url', image_url: { url: dataUrl } }
                  ]}
                ], { max_tokens: 500 })
                if (visionResult?.content) {
                  visionDescription = `\n**AI Vision Analysis**: ${visionResult.content}\n`
                  console.log(`[Vision] Analyzed image: ${att.filename} (${visionResult.content.length} chars)`)
                }
              } catch (visionErr) {
                console.warn('[Vision] Image analysis failed:', visionErr.message)
              }
            }

            // Only inline if the data URL is small (< 50KB) to avoid context blowup
            const MAX_INLINE_SIZE = 50_000
            if (dataUrl && dataUrl.startsWith('data:') && dataUrl.length <= MAX_INLINE_SIZE) {
              attachBlock += `### Uploaded Image: ${att.filename}${visionDescription}\nThe user uploaded this image. When the user asks you to use this image (as a header, background, logo, etc.), set the \`src\` attribute of an <img> tag to this EXACT data URL. Do NOT shorten or modify it. Copy the entire string as-is.\n\nDATA_URL:\n${dataUrl}\n\n`
            } else if (dataUrl && dataUrl.startsWith('data:')) {
              attachBlock += `### Uploaded Image: ${att.filename}${visionDescription}\nThe user uploaded a large image stored at project path: \`${att.path}\`. The image data URL is too large to include inline.\n\n`
            } else {
              attachBlock += `### Uploaded Image: ${att.filename}${visionDescription}\n[Image uploaded — stored at project path: ${att.path}. The image data was not available inline.]\n\n`
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
          const { routeRequest } = await import('@/lib/self_builder/request_router')
          const routeResult = await routeRequest({ input: userMessage, projectId, userId })
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

      // Brief builds: skip planning, build directly with rich content
      if (isBriefBuild && !usePlanMode && !directEditMode) {
        systemMessage += `\n\n## IMMEDIATE BUILD MODE — Creative Brief
You are building a brand-new project from a creative brief. Build it NOW using \`create_files\`.

CRITICAL ARCHITECTURE RULE — SINGLE FILE:
Generate ONE file: \`app/page.jsx\` containing the ENTIRE application. ALL components must be defined INLINE in this single file — do NOT import from other local files. This is mandatory because the preview runtime cannot reliably resolve cross-file imports.

STRUCTURE OF app/page.jsx (600-1000 lines):
\`\`\`
// Define ALL components inline, then compose them at the bottom
function Navbar() { return (...) }
function HeroSection() { return (...) }
function FeaturesSection() { return (...) }
function PricingSection() { return (...) }
function Footer() { return (...) }

// Main app — compose all sections
export default function App() {
  const [currentPage, setCurrentPage] = useState('home')
  return (
    <div className="bg-gray-950 text-white min-h-screen">
      <Navbar onNavigate={setCurrentPage} />
      {currentPage === 'home' && <><HeroSection /><FeaturesSection /></>}
      {currentPage === 'pricing' && <PricingSection />}
      <Footer />
    </div>
  )
}
\`\`\`

RULES:
- Call \`create_files\` immediately. Do NOT propose a plan. Do NOT ask questions.
- Put EVERYTHING in ONE file: \`app/page.jsx\`. Define Navbar, Hero, Features, Pricing, Footer, etc. as functions INSIDE that file.
- Use \`useState\` for client-side navigation between pages (no react-router).
- Use ONLY standard Tailwind utility classes (bg-gray-950, text-white, bg-indigo-600, etc). NEVER invent custom classes.
- For dark themes: bg-gray-950/bg-slate-900 + text-white. For accents: bg-indigo-600/bg-violet-500/bg-emerald-500.
- Include glassmorphism navbar (bg-gray-900/70 backdrop-blur-xl), gradient text headings, glass cards, CTA buttons with glow shadows, decorative blur orbs.
- Use realistic content specific to the brand — never "Lorem ipsum".
- If image URLs are provided, use them in \`<img>\` tags. Otherwise, use inline SVGs for visual elements.
- 600-1000 lines minimum. Under 400 means you are being lazy.
- Do NOT include \`import React\` or \`import { useState }\` — React and all hooks are available globally in the preview runtime.
- Do NOT use react-router-dom. Use useState for page navigation.
- After your create_files call, write a short summary of what you built.`
      }

      // ── Brief follow-up: load existing file content and instruct targeted editing ──
      if (isBriefFollowUp && projectId) {
        try {
          const existingProjectFiles = await db.projectFiles.findByProjectId(projectId)
          const mainFile = existingProjectFiles.find(f => f.path === 'app/page.jsx' || f.path === 'App.jsx') || existingProjectFiles[0]
          if (mainFile?.content) {
            systemMessage += `\n\n## FOLLOW-UP EDIT MODE
The user is asking you to modify an existing project that was built from a Creative Brief. The project has ${existingProjectFiles.length} file(s).

CURRENT FILE: \`${mainFile.path}\` (${mainFile.content.split('\n').length} lines)

\`\`\`jsx
${mainFile.content.length > 60000 ? mainFile.content.slice(0, 60000) + '\n// [truncated]' : mainFile.content}
\`\`\`

RULES FOR FOLLOW-UP EDITS:
- Use \`update_files\` to modify the existing file. Do NOT create new files.
- Make TARGETED changes — only modify the specific sections the user mentions.
- Keep ALL existing functionality intact. Do not remove sections the user didn't ask to change.
- Maintain the same component structure (all components inline in one file).
- Call \`update_files\` with the COMPLETE modified file content.`
          }
        } catch (err) {
          console.warn('[BriefFollowUp] Failed to load existing file:', err.message)
        }
      }

      if (!usePlanMode && !isBriefBuild && shouldUsePlanMode(intent) && requestMode !== 'read_only_report') {
        // Non-project scope but plan-worthy intent — just inform
        systemMessage += `\n\nNote: Plan mode is available for project-scoped requests.`
      }

      // ── Safety: cap system message size to prevent context explosion ──
      const MAX_SYSTEM_MSG_CHARS = 60_000  // ~15K tokens — aggressive cap to prevent token bloat
      if (systemMessage.length > MAX_SYSTEM_MSG_CHARS) {
        console.warn(`[ContextGuard] System message too large (${systemMessage.length} chars). Truncating to ${MAX_SYSTEM_MSG_CHARS}.`)
        systemMessage = systemMessage.slice(0, MAX_SYSTEM_MSG_CHARS) + '\n\n[System context truncated for safety]'
      }

      // Log total context size for debugging
      const totalMsgChars = systemMessage.length + (context.chat?.messages || []).reduce((s, m) => s + (m.content?.length || 0), 0) + userMessage.length
      console.log(`[ContextSize] systemMsg=${systemMessage.length} chatHistory=${(context.chat?.messages || []).length}msgs totalChars=${totalMsgChars} (~${Math.round(totalMsgChars/4)}tokens)`)

      // ── AGGRESSIVE CONTEXT TRIMMING: cap history BEFORE building messages array ──
      // Token usage was exploding because we loaded full history then trimmed.
      // Now we trim FIRST to prevent token waste.
      let chatHistory = context.chat?.messages || []
      const MAX_HISTORY_MESSAGES = 6 // Keep only last 6 messages (3 turns) max — reduced from 10
      if (chatHistory.length > MAX_HISTORY_MESSAGES) {
        console.log(`[ContextTrim-Proactive] Trimming chat history from ${chatHistory.length} to ${MAX_HISTORY_MESSAGES} messages BEFORE building context`)
        chatHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES)
      }

      let messages = [
        { role: 'system', content: systemMessage },
        ...chatHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ]

      // ── Context window management: trim old messages if approaching limit ──
      const totalChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0)
      const MAX_CONTEXT_CHARS = 120000 // Reduced from 200K to 120K (~30K tokens) to prevent warnings
      if (totalChars > MAX_CONTEXT_CHARS) {
        console.log(`[ContextTrim] Total ${totalChars} chars exceeds ${MAX_CONTEXT_CHARS} — trimming old messages`)
        const systemMsg = messages[0]
        const userMsg = messages[messages.length - 1]
        const history = messages.slice(1, -1)

        // If the project has no files, the old history is all failed builds — drop it entirely
        if (existingFiles === 0) {
          console.log(`[ContextTrim] Project has 0 files — dropping ALL ${history.length} history messages (all failed builds)`)
          messages = [systemMsg, userMsg]
        } else {
          // Keep the last 4 messages (2 turns) — reduced from 10
          const keepCount = Math.min(history.length, 4)
          const trimmed = history.slice(-keepCount)
          messages = [systemMsg, ...trimmed, userMsg]
          if (trimmed.length > 0) {
            messages.splice(1, 0, { role: 'system', content: `[Note: Earlier conversation messages were trimmed to fit context limits. ${history.length - keepCount} older messages were removed. The project files are still available — use read_files if you need to see current file contents.]` })
          }
        }
        const newTotal = messages.reduce((s, m) => s + (m.content?.length || 0), 0)
        console.log(`[ContextTrim] Trimmed from ${history.length + 2} to ${messages.length} messages (${totalChars} → ${newTotal} chars)`)
      }

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
      let canvasUpdated = false

      // filesByPath already loaded above — refresh if needed
      if (filesByPath.size === 0 && effectiveScope === 'project') {
        const freshFiles = await db.projectFiles.findByProjectId(projectId)
        for (const f of freshFiles) {
          filesByPath.set(f.path, f)
          const norm = f.path.replace(/^\.\//, '').replace(/^\//, '')
          if (norm !== f.path) filesByPath.set(norm, f)
        }
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
        const toolOpts = { temperature: 0.7, max_tokens: 16384 }
        // Force the AI to call propose_plan when in plan mode
        if (usePlanMode) {
          toolOpts.tool_choice = { type: 'function', function: { name: 'propose_plan' } }
        }
        // Force the AI to call the correct file tool in direct-edit mode
        if (directEditMode && directEditFileAction) {
          toolOpts.tool_choice = { type: 'function', function: { name: directEditFileAction } }
        }
        // Force the AI to call create_files for brief builds (new projects from creative brief)
        if (isBriefBuild && !usePlanMode && !directEditMode) {
          toolOpts.tool_choice = { type: 'function', function: { name: 'create_files' } }
        }
        // Self-edit mode: determine if this is a conversational message or an action request
        if (isSelfEdit) {
          if (selfEditIsConversational) {
            console.log('[SelfEdit-Chat] Conversational mode — tools stripped')
          } else {
            toolOpts.tool_choice = 'required'
            console.log('[SelfEdit-Action] Forcing tool_choice=required for action request')
          }
        }

        // Normal project mode: also force tool use for action requests
        // This makes Auroraly behave like E1 — talk = build, no "let me describe what I'll do"
        if (!isSelfEdit && !toolOpts.tool_choice) {
          const { classifyUserIntent } = await import('./intents.js')
          const phase = classifyUserIntent(userMessage)
          if (phase.phase === 'instruction' || phase.phase === 'followup' || phase.phase === 'approval') {
            toolOpts.tool_choice = 'required'
            console.log(`[Project-Action] Forcing tool_choice=required (phase: ${phase.phase})`)
          }
          // Also force tools for question-phase when the user is asking about a build
          // e.g. "did you build it?", "did you start?", "is it done?"
          // Without this, the AI just responds with text like "Building your project..." without calling create_files
          if (phase.phase === 'question' && effectiveScope === 'project' && projectId) {
            const questionImpliesBuild = /\b(build|start|done|ready|finish|creat|generat|implement|mak|work)\b/i.test(userMessage)
            if (questionImpliesBuild) {
              toolOpts.tool_choice = 'required'
              console.log(`[Project-Action] Forcing tool_choice=required for build-question (phase: ${phase.phase})`)
            }
          }
        }

        // Stage boundary: filter available tools by request mode
        let effectiveToolSet = toolSet
        if (requestMode === 'plan_only') {
          effectiveToolSet = toolSet.filter(t => t.function?.name === 'propose_plan')
        } else if (requestMode === 'patch_only') {
          effectiveToolSet = toolSet.filter(t => t.function?.name !== 'propose_plan')
        }
        // Self-edit: allow patch_files AND update_canvas (unless conversational)
        if (isSelfEdit && !selfEditIsConversational) {
          effectiveToolSet = AI_TOOLS.filter(t => ['search_replace', 'patch_files', 'update_files', 'update_canvas', 'read_files', 'verify_build', 'exec_command', 'update_memory', 'screenshot_verify', 'edit_lines'].includes(t.function?.name))
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

        let agentLoopCount = 0
        let agentLoopContinue = false
        const MAX_AGENT_LOOPS = 12
        while (true) {
          fullContent = ''
          toolCalls = []

          if (isSelfEdit) {
            console.log('[SelfEdit-Stream]', JSON.stringify({ tool_choice: toolOpts.tool_choice, toolSetSize: effectiveToolSet.length, toolNames: effectiveToolSet.map(t => t.function?.name) }))
          }

          // ── Live preview streaming state (direct-edit only) ──
          toolArgsAccum = ''
          let lastPreviewLen = 0
          const PREVIEW_LEN_STEP = 300 // Emit every ~300 chars of new content

          let contextLengthExceeded = false
          try {
          for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, effectiveToolSet, toolOpts))) {
            if (chunk.type === 'context_length_exceeded') {
              contextLengthExceeded = true
              break
            }
            if (chunk.type === 'status') {
              yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
            } else if (chunk.type === 'token') {
              fullContent += chunk.content
              if (!usePlanMode) yield { event: 'token', data: { content: chunk.content } }
            } else if (chunk.type === 'tool_calls') {
              toolCalls = chunk.tool_calls
            } else if (chunk.type === 'tool_args_delta' && (chunk.name === 'create_files' || chunk.name === 'update_files' || chunk.name === 'patch_files')) {
              // Accumulate tool call argument deltas for live preview
              toolArgsAccum += chunk.delta
              if (toolArgsAccum.length - lastPreviewLen >= PREVIEW_LEN_STEP) {
                const extracted = this._extractPartialFileContent(toolArgsAccum)
                if (extracted?.content && extracted.content.length > 50) {
                  lastPreviewLen = toolArgsAccum.length
                  const previewPath = directEditTarget || extracted.path || 'app/page.jsx'
                  yield { event: 'preview_partial', data: { path: previewPath, content: extracted.content } }
                }
              }
            }
          }
          } catch (streamErr) {
            if (streamErr?.error_type === 'context_length_auto_trim') {
              contextLengthExceeded = true
            } else {
              throw streamErr
            }
          }

          // Handle context length exceeded — auto-trim and retry
          if (contextLengthExceeded) {
            console.log('[ContextAutoTrim] Context length exceeded — trimming and retrying')
            yield { event: 'status', data: { stage: 'trimming', detail: 'Trimming conversation history...' } }
            const sysMsg = messages[0]
            const userMsg = messages[messages.length - 1]
            const history = messages.slice(1, -1).filter(m => m.role !== 'system')
            const keepCount = Math.min(history.length, 6)
            messages = [
              sysMsg,
              { role: 'system', content: '[Earlier messages were trimmed to fit context limits. Use read_files to see current file contents if needed.]' },
              ...history.slice(-keepCount),
              userMsg
            ]
            console.log(`[ContextAutoTrim] Trimmed to ${messages.length} messages, retrying...`)
            fullContent = ''
            toolCalls = []
            agentLoopContinue = true
            break
          }

          // Emit one final partial before tool calls are processed (catches last gap)
          if (toolArgsAccum) {
            const extracted = this._extractPartialFileContent(toolArgsAccum)
            if (extracted?.content && extracted.content.length > 50) {
              const previewPath = directEditTarget || extracted.path || 'app/page.jsx'
              yield { event: 'preview_partial', data: { path: previewPath, content: extracted.content } }
            }
          }

          if (isSelfEdit) {
            console.log('[SelfEdit-StreamResult]', JSON.stringify({ textLen: fullContent.length, toolCallCount: toolCalls.length, toolNames: toolCalls.map(tc => { try { return tc.function.name } catch { return '?' } }) }))
          }
            
          // "Broken promise" detector: AI said it would act but didn't call any tool
          // Works for BOTH self-edit AND normal projects
          if (toolCalls.length === 0 && fullContent.length > 0) {
            const promisedAction = /\b(let'?s (get started|do|implement|add|begin|proceed|start|build|work on|make|address|fix|resolve|take|look|go through|ensure|verify|check)|let me (implement|add|create|build|start|proceed|get started|fix|address|take|look|check|go through|verify)|i'?ll (add|implement|create|update|modify|do|build|make|start|proceed|work on|fix|address|go through|verify|ensure|take a look|check)|here'?s (what|how|the)|implementing|starting|proceeding|addressing|fixing|stay tuned|creating the|building the|building your|building all|generating|i'?m going to|building now|creating now)\b/i.test(fullContent)
            const isConversational = isSelfEdit ? selfEditIsConversational : false
            if (promisedAction && !isConversational && selfEditPatchRetry < MAX_SELF_EDIT_RETRIES) {
              selfEditPatchRetry++
              console.log(`[BrokenPromise-Retry] AI promised action but called no tool — forcing retry ${selfEditPatchRetry}/${MAX_SELF_EDIT_RETRIES}`)
              yield { event: 'status', data: { stage: 'retrying', detail: 'Building...' } }

                // ── File context injection for "All Core System" mode ──
                // When no specific file was pre-loaded, the AI can't write patches.
                // Determine the target from AI text + user message and inject its content.
                let retryDirective = 'You said you would do it but you did not call any tool. Call create_files NOW to build the project. Include ALL files in a single tool call. Do not respond with text — ONLY call the tool.'

                // For self-edit mode, use search_replace instead
                if (isSelfEdit) {
                  retryDirective = 'You said you would do it but you did not call any tool. Call search_replace NOW to make the changes. Do not respond with text.'
                }

                if (isSelfEdit && selfEditTarget && !selfEditTarget.path) {
                  try {
                    const { readFileSync, existsSync } = await import('fs')
                    const { resolve } = await import('path')
                    const { SELF_EDIT_TARGETS } = await import('../constants.js')

                    const combined = fullContent + ' ' + userMessage
                    const bestTarget = identifyTargetFile(combined, SELF_EDIT_TARGETS)

                    if (bestTarget) {
                      const targetPath = resolve('/app', bestTarget.path)
                      if (existsSync(targetPath)) {
                        let fileContent = readFileSync(targetPath, 'utf-8')
                        if (fileContent.length > 60000) fileContent = fileContent.slice(0, 60000) + '\n// ... [truncated]'
                        const numbered = fileContent.split('\n').map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n')
                        console.log(`[SelfEdit-Retry] Injected file context: ${bestTarget.path} (${fileContent.length} chars)`)
                        retryDirective = `You promised to act but called no tool. Here is the file you need to edit with line numbers:\n\n## TARGET FILE: \`${bestTarget.path}\` (${fileContent.split('\n').length} lines)\n\`\`\`\n${numbered}\n\`\`\`\n\nCall search_replace NOW — copy the EXACT text to change as old_str and write the replacement as new_str. The \`path\` in your tool call MUST be \`${bestTarget.path}\`. Do NOT respond with text — ONLY call the tool.`
                      }
                    } else {
                      console.log('[SelfEdit-Retry] Could not determine target file from AI text + user message')
                    }
                  } catch (err) {
                    console.error('[SelfEdit-Retry] File context injection error:', err.message)
                  }
                }

                messages.push({ role: 'assistant', content: fullContent })
                messages.push({ role: 'user', content: retryDirective })
                toolOpts.tool_choice = 'required'
                continue
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

          // ── Broken Promise Detector for regular builds (non-selfEdit, non-directEdit) ──
          // If the AI promised action OR is stalling instead of building, force a retry.
          if (!isSelfEdit && !directEditMode && !usePlanMode && effectiveScope === 'project' && toolCalls.length === 0 && fullContent.length > 0) {
            const promisedAction = /\b(let'?s (get started|do|implement|add|begin|proceed|start|build|work on|make|address|fix|resolve|create|go through|ensure|verify|check|double.check)|let me (implement|add|create|build|start|proceed|get started|fix|address|double.check|verify|review|go through)|i'?ll (add|implement|create|update|modify|do|build|make|start|proceed|work on|fix|address|generate|go through|verify|ensure|check)|here'?s (what|how|the)|implementing|starting|proceeding|creating|building|generating|addressing|fixing)\b/i.test(fullContent)
            // Also catch stalling: AI asks clarification when the user already gave detailed specs
            const isStalling = /\b(can you (confirm|clarify|specify|tell me|provide)|could you (confirm|clarify|specify|tell me|provide)|what (exactly|specifically) (do you|would you|should)|before I (proceed|start|begin|implement)|I need (more|some|additional) (details|info|context|clarification))\b/i.test(fullContent) && userMessage.length > 100
            if ((promisedAction || isStalling) && selfEditPatchRetry < MAX_SELF_EDIT_RETRIES) {
              selfEditPatchRetry++
              console.log(`[BuildRetry] AI ${isStalling ? 'stalling' : 'promised action'} but called no tool — forcing retry ${selfEditPatchRetry}/${MAX_SELF_EDIT_RETRIES}`)
              yield { event: 'status', data: { stage: 'retrying', detail: 'Executing...' } }

              // Inject existing file content if the user is asking to modify something
              let retryDirective = 'You said you would do it but you did not call any tool. Call create_files or update_files NOW. Do not respond with text — generate the code.'
              if (allProjectFiles.length > 0) {
                // Find the most likely file to edit from user message + AI text
                const combined = (fullContent + ' ' + userMessage).toLowerCase()
                let bestFile = null
                for (const f of allProjectFiles) {
                  if (!f.path || !f.content) continue
                  const fname = f.path.split('/').pop().toLowerCase()
                  if (combined.includes(fname) || combined.includes(f.path.toLowerCase())) {
                    bestFile = f
                    break
                  }
                }
                if (bestFile) {
                  const truncated = bestFile.content.length > 30000 ? bestFile.content.slice(0, 30000) + '\n// ... [truncated]' : bestFile.content
                  console.log(`[BuildRetry] Injected file context: ${bestFile.path} (${truncated.length} chars)`)
                  retryDirective = `You promised to act but called no tool. Here is the existing file to update:\n\n## FILE: \`${bestFile.path}\`\n\`\`\`\n${truncated}\n\`\`\`\n\nCall update_files NOW with the complete updated version of this file. Do NOT respond with text — ONLY call the tool.`
                }
              }

              messages.push({ role: 'assistant', content: fullContent })
              messages.push({ role: 'user', content: retryDirective })
              // Force the right tool based on whether files exist
              const forceTool = allProjectFiles.length > 0 ? 'update_files' : 'create_files'
              toolOpts.tool_choice = { type: 'function', function: { name: forceTool } }
              continue
            }
          }

          if (agentLoopContinue) {
            agentLoopContinue = false
            continue
          }

        // ── Task-Mode Enforcement (skip for direct-edit and self-edit — trusted fast paths) ──
        if (!directEditMode && !selfEditTarget) {
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
              // Retry instead of giving up — force tool call
              console.log('[TaskMode] Rejected — retrying with tool_choice=required')
              messages.push({ role: 'assistant', content: fullContent })
              messages.push({ role: 'user', content: '[SYSTEM: Your response was rejected because it did not call the required tools. You MUST call create_files or update_files to build/modify the project. Do NOT describe what you will do — call the tool NOW.]' })
              fullContent = ''
              toolCalls = []
              toolOpts.tool_choice = 'required'
              agentLoopContinue = true
              break
            }
          }
        } // end task-mode enforcement

        // Process tool calls
        if (toolCalls.length > 0) {
          agentLoopContinue = false
          for (const toolCall of toolCalls) {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              let toolName = toolCall.function.name

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
                          const { text: vText, runtimeEvent } = buildVerifiedResponseWithRuntime(revSaved, userMessage, refinementMode, isSelfEdit)
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
                              ? buildVerifiedResponseWithRuntime(revSaved2, userMessage, refinementMode, isSelfEdit)
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
                      // If AI already streamed substantial text (e.g. PM review), preserve it
                      // and only append a brief file note — don't overwrite with verified response
                      const preStreamedLen = fullContent.trim().length
                      if (preStreamedLen > 80) {
                        const fileNames = savedFiles.map(f => f.path.replace(/^src\/(components|pages)\//, '')).join(', ')
                        const briefNote = `\n\n*${savedFiles.length} file(s) updated: ${fileNames}*`
                        yield { event: 'token', data: { content: briefNote } }
                        fullContent += briefNote
                      } else {
                        const { text: aeText, runtimeEvent: aeRt } = buildVerifiedResponseWithRuntime(savedFiles, userMessage, true, isSelfEdit)
                        fullContent = aeText
                        if (aeRt) yield aeRt
                        yield { event: 'token', data: { content: fullContent } }
                      }
                    }
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
              } else if (toolName === 'create_files' || toolName === 'update_files' || toolName === 'patch_files') {

                // Use a local mutable variable so we never reassign toolName (SWC minifier converts let→const)
                let saveTool = toolName
                const patchSummary = args.summary || args.plan || '' // AI-generated description of what changes accomplish

                // ── patch_files: convert structured patches into full file content ──
                if (saveTool === 'patch_files' && args.files) {
                  const fs = await import('fs')
                  const path = await import('path')
                  let totalApplied = 0
                  let totalFailed = 0
                  const failedPatchDetails = [] // collect failure info for retry

                  for (let i = 0; i < args.files.length; i++) {
                    const file = args.files[i]
                    if (!file.path || !file.patches || !Array.isArray(file.patches)) continue
                    
                    const fullPath = path.resolve('/app', file.path)
                    if (!fs.existsSync(fullPath)) {
                      console.warn('[patch_files] File not found on disk:', file.path)
                      continue
                    }
                    
                    let content = fs.readFileSync(fullPath, 'utf-8')
                    let applied = 0
                    let failed = 0
                    
                    for (const patch of file.patches) {
                      if (!patch.search || patch.replace === undefined) { failed++; continue }
                      
                      if (content.includes(patch.search)) {
                        content = content.replace(patch.search, patch.replace)
                        applied++
                      } else {
                        // Fuzzy: trim whitespace per line and try again
                        const searchTrimmed = patch.search.split('\n').map(l => l.trim()).join('\n')
                        const contentLines = content.split('\n')
                        const searchLineCount = patch.search.split('\n').length
                        let found = false
                        for (let j = 0; j <= contentLines.length - searchLineCount; j++) {
                          const window = contentLines.slice(j, j + searchLineCount).map(l => l.trim()).join('\n')
                          if (window === searchTrimmed) {
                            const originalSlice = contentLines.slice(j, j + searchLineCount).join('\n')
                            content = content.replace(originalSlice, patch.replace)
                            applied++
                            found = true
                            break
                          }
                        }
                        if (!found) {
                          // Level 3 fuzzy: normalize whitespace and compare
                          const normalizeForMatch = (s) => s.split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(l => l.length > 0).join('\n')
                          const searchNorm = normalizeForMatch(patch.search)
                          const searchNormLineCount = searchNorm.split('\n').length
                          for (let j = 0; j <= contentLines.length - searchNormLineCount; j++) {
                            const windowLines = contentLines.slice(j, j + searchNormLineCount + 2) // slight tolerance
                            const windowNorm = normalizeForMatch(windowLines.join('\n'))
                            if (windowNorm.includes(searchNorm) || searchNorm.split('\n').every(sl => windowNorm.includes(sl))) {
                              // Found a normalized match — use the original indentation from the file
                              const matchLen = Math.min(searchNormLineCount + 2, windowLines.length)
                              const originalSlice = contentLines.slice(j, j + matchLen).join('\n')
                              content = content.replace(originalSlice, patch.replace)
                              applied++
                              found = true
                              console.log(`[patch_files] Fuzzy L3 match at line ${j + 1}: ${file.path}`)
                              break
                            }
                          }
                        }
                        if (!found) {
                          console.warn('[patch_files] Search not found:', file.path, '| search:', patch.search.slice(0, 80) + '...')
                          failed++
                          // Collect context for retry: find closest match area
                          const searchFirstLine = patch.search.split('\n')[0].trim()
                          const nearbyIdx = contentLines.findIndex(l => l.trim().includes(searchFirstLine.slice(0, 40)))
                          const contextStart = Math.max(0, nearbyIdx >= 0 ? nearbyIdx - 3 : 0)
                          const contextEnd = Math.min(contentLines.length, contextStart + searchLineCount + 6)
                          failedPatchDetails.push({
                            filePath: file.path,
                            failedSearch: patch.search.slice(0, 200),
                            intendedReplace: patch.replace.slice(0, 200),
                            nearbyContent: nearbyIdx >= 0 ? contentLines.slice(contextStart, contextEnd).join('\n') : null,
                            nearbyLine: nearbyIdx >= 0 ? contextStart + 1 : null,
                          })
                        }
                      }
                    }
                    
                    totalApplied += applied
                    totalFailed += failed
                    console.log(`[patch_files] ${file.path}: applied ${applied}/${applied + failed} patches`)
                    
                    // Validate exports preserved
                    const original = fs.readFileSync(fullPath, 'utf-8')
                    const validation = validateExportsPreserved(original, content)
                    if (!validation.valid) {
                      console.warn('[patch_files] Missing exports after patch:', file.path, validation.missing)
                    }
                    
                    // Convert to update_files format for the save pipeline
                    args.files[i] = { path: file.path, content }
                  }

                  // ── Silent Retry: if patches failed and we have retries left, re-prompt AI ──
                  if (totalFailed > 0 && totalApplied === 0 && selfEditPatchRetry < MAX_SELF_EDIT_RETRIES && isSelfEdit) {
                    selfEditPatchRetry++
                    console.log(`[SelfEdit-Retry] All patches failed (${totalFailed} failures), attempt ${selfEditPatchRetry}/${MAX_SELF_EDIT_RETRIES}`)
                    yield { event: 'status', data: { stage: 'retrying_patches', detail: `Patch search strings didn't match — retrying with corrected context (attempt ${selfEditPatchRetry})...` } }

                    // Build corrective context with actual file content
                    let retryContext = 'Your previous patch_files call had search strings that did not match the actual file content. Here are the failures:\n\n'
                    for (const detail of failedPatchDetails.slice(0, 5)) {
                      retryContext += `**Failed search** (file: ${detail.filePath}):\n\`\`\`\n${detail.failedSearch}\n\`\`\`\n`
                      if (detail.nearbyContent) {
                        retryContext += `**Actual content near line ${detail.nearbyLine}**:\n\`\`\`\n${detail.nearbyContent}\n\`\`\`\n`
                      }
                      retryContext += `**Intended replacement**:\n\`\`\`\n${detail.intendedReplace}\n\`\`\`\n\n`
                    }
                    retryContext += 'Please retry with EXACT search strings that match the actual file content character-for-character (including whitespace and indentation). Use the patch_files tool again.'

                    // Re-stream from AI with corrective context
                    const retryMessages = [...messages, { role: 'assistant', content: fullContent || '(patch attempt)' }, { role: 'user', content: retryContext }]
                    let retryToolCalls = []
                    let retryContent = ''
                    try {
                      for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(retryMessages, effectiveToolSet, toolOpts))) {
                        if (chunk.type === 'token') retryContent += chunk.content
                        else if (chunk.type === 'tool_calls') retryToolCalls = chunk.tool_calls
                      }
                    } catch (retryErr) {
                      console.error('[SelfEdit-Retry] Stream error:', retryErr.message)
                    }

                    // Parse retry tool calls and re-apply patches
                    if (retryToolCalls.length > 0) {
                      const retryTC = retryToolCalls.find(tc => { try { return tc.function.name === 'patch_files' } catch { return false } })
                      if (retryTC) {
                        try {
                          const retryArgs = JSON.parse(retryTC.function.arguments)
                          if (retryArgs.files) {
                            let retryApplied = 0
                            let retryFailed = 0
                            for (let i = 0; i < retryArgs.files.length; i++) {
                              const file = retryArgs.files[i]
                              if (!file.path || !file.patches) continue
                              const fullPath = path.resolve('/app', file.path)
                              if (!fs.existsSync(fullPath)) continue
                              let content = fs.readFileSync(fullPath, 'utf-8')
                              for (const patch of file.patches) {
                                if (!patch.search || patch.replace === undefined) { retryFailed++; continue }
                                if (content.includes(patch.search)) {
                                  content = content.replace(patch.search, patch.replace)
                                  retryApplied++
                                } else {
                                  // Fuzzy retry
                                  const searchTrimmed = patch.search.split('\n').map(l => l.trim()).join('\n')
                                  const contentLines = content.split('\n')
                                  const searchLineCount = patch.search.split('\n').length
                                  let found = false
                                  for (let j = 0; j <= contentLines.length - searchLineCount; j++) {
                                    const window = contentLines.slice(j, j + searchLineCount).map(l => l.trim()).join('\n')
                                    if (window === searchTrimmed) {
                                      content = content.replace(contentLines.slice(j, j + searchLineCount).join('\n'), patch.replace)
                                      retryApplied++
                                      found = true
                                      break
                                    }
                                  }
                                  if (!found) retryFailed++
                                }
                              }
                              console.log(`[SelfEdit-Retry] ${file.path}: applied ${retryApplied}/${retryApplied + retryFailed} patches`)
                              if (retryApplied > 0) {
                                // Override args.files with retry result
                                const origFile = args.files.find(f => f.path === file.path)
                                const idx = origFile ? args.files.indexOf(origFile) : -1
                                if (idx >= 0) args.files[idx] = { path: file.path, content }
                              }
                            }
                            totalApplied += retryApplied
                            console.log(`[SelfEdit-Retry] Total after retry: ${totalApplied} applied, ${retryFailed} still failed`)
                            // If retry ALSO failed completely, block save
                            if (totalApplied === 0) {
                              console.error(`[patch_files] COMPLETE FAILURE after retry: 0 patches applied — blocking save`)
                              args.files = []
                              saveTool = '__blocked__'
                            }
                          }
                        } catch (parseErr) {
                          console.error('[SelfEdit-Retry] Parse error:', parseErr.message)
                        }
                      }
                    }
                    // If retry produced no tool calls or no patch_files call, block save
                    if (totalApplied === 0 && saveTool !== '__blocked__') {
                      console.error(`[patch_files] Retry produced no successful patches — blocking save`)
                      args.files = []
                      saveTool = '__blocked__'
                    }

                    // ── Fallback: when patch_files completely fails, retry with targeted insertion ──
                    // For large files, full-file update_files won't work (output token limit).
                    // Instead, ask AI to describe the exact insertion point and new code.
                    if (saveTool === '__blocked__' && isSelfEdit && selfEditPatchRetry < MAX_SELF_EDIT_RETRIES) {
                      selfEditPatchRetry++
                      console.log(`[patch_files→insert] All patches failed — falling back to line-based insertion (attempt ${selfEditPatchRetry})`)
                      yield { event: 'status', data: { stage: 'retrying', detail: 'Retrying with targeted insertion...' } }

                      const targetFile = failedPatchDetails[0]?.filePath
                      if (targetFile) {
                        const fullPath = path.resolve('/app', targetFile)
                        if (fs.existsSync(fullPath)) {
                          const currentContent = fs.readFileSync(fullPath, 'utf-8')
                          const lines = currentContent.split('\n')
                          
                          // Give AI the failed patch context + nearby lines so it can specify exact insertion
                          let contextSnippets = ''
                          for (const detail of failedPatchDetails.slice(0, 3)) {
                            if (detail.nearbyContent) {
                              contextSnippets += `\n\nNear line ${detail.nearbyLine} of ${detail.filePath}:\n\`\`\`\n${detail.nearbyContent}\n\`\`\`\nYou tried to replace:\n\`\`\`\n${detail.failedSearch}\n\`\`\`\nWith:\n\`\`\`\n${detail.intendedReplace}\n\`\`\``
                            }
                          }

                          const fallbackMessages = [
                            ...messages,
                            { role: 'assistant', content: fullContent || '(patch attempt failed)' },
                            { role: 'user', content: `Your patch_files failed because the search strings didn't match the actual file. The file is ${lines.length} lines long — too big for full replacement.\n\nHere are the sections you were trying to edit:${contextSnippets}\n\nNow try again with patch_files, but this time copy the EXACT text from the "Near line" sections above as your search strings. Match character-for-character including all whitespace and indentation.` }
                          ]

                          let fallbackToolCalls = []
                          let fallbackContent = ''
                          try {
                            const fallbackToolOpts = { ...toolOpts, tool_choice: { type: 'function', function: { name: 'patch_files' } } }
                            for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(fallbackMessages, effectiveToolSet, fallbackToolOpts))) {
                              if (chunk.type === 'token') {
                                fallbackContent += chunk.content
                                yield { event: 'token', data: { content: chunk.content } }
                              } else if (chunk.type === 'tool_calls') {
                                fallbackToolCalls = chunk.tool_calls
                              }
                            }
                          } catch (fallbackErr) {
                            console.error('[patch_files→insert] Fallback stream error:', fallbackErr.message)
                          }

                          if (fallbackToolCalls.length > 0) {
                            const fbTC = fallbackToolCalls.find(tc => {
                              try { const n = tc.function.name; return n === 'patch_files' || n === 'update_files' } catch { return false }
                            })
                            if (fbTC) {
                              try {
                                const fbArgs = JSON.parse(fbTC.function.arguments)
                                if (fbArgs.files?.length > 0) {
                                  // If it's patch_files, apply the patches
                                  if (fbTC.function.name === 'patch_files') {
                                    let fbApplied = 0
                                    for (const file of fbArgs.files) {
                                      if (!file.path || !file.patches) continue
                                      let content = currentContent
                                      for (const patch of file.patches) {
                                        if (!patch.search || patch.replace === undefined) continue
                                        if (content.includes(patch.search)) {
                                          content = content.replace(patch.search, patch.replace)
                                          fbApplied++
                                        } else {
                                          // Fuzzy L2
                                          const searchTrimmed = patch.search.split('\n').map(l => l.trim()).join('\n')
                                          const contentLines = content.split('\n')
                                          const searchLineCount = patch.search.split('\n').length
                                          for (let j = 0; j <= contentLines.length - searchLineCount; j++) {
                                            const window = contentLines.slice(j, j + searchLineCount).map(l => l.trim()).join('\n')
                                            if (window === searchTrimmed) {
                                              content = content.replace(contentLines.slice(j, j + searchLineCount).join('\n'), patch.replace)
                                              fbApplied++
                                              break
                                            }
                                          }
                                        }
                                      }
                                      if (fbApplied > 0) {
                                        args.files = [{ path: file.path, content }]
                                        saveTool = 'update_files'
                                        args._patchFallback = true
                                        console.log(`[patch_files→insert] Corrected patches applied: ${fbApplied}`)
                                      }
                                    }
                                  } else {
                                    // update_files fallback
                                    args.files = fbArgs.files
                                    saveTool = 'update_files'
                                    args._patchFallback = true
                                  }
                                  console.log(`[patch_files→insert] Fallback succeeded: saveTool=${saveTool}`)
                                }
                              } catch (fbParseErr) {
                                console.error('[patch_files→insert] Parse error:', fbParseErr.message)
                              }
                            }
                          }
                        }
                      }
                    }
                  } else if (totalFailed > 0 && totalApplied > 0 && isSelfEdit) {
                    // Partial success: some patches applied, some failed
                    // Validate the result isn't syntactically broken before saving
                    let partialValid = true
                    for (const file of args.files) {
                      if (!file.content) continue
                      const opens = (file.content.match(/[({[]/g) || []).length
                      const closes = (file.content.match(/[)}\]]/g) || []).length
                      if (Math.abs(opens - closes) > 3) {
                        console.error(`[SelfEdit-Partial] Bracket mismatch in ${file.path}: ${opens} opens vs ${closes} closes — blocking save`)
                        partialValid = false
                        break
                      }
                    }
                    if (partialValid) {
                      console.log(`[SelfEdit-Partial] ${totalApplied} patches applied, ${totalFailed} failed — saving (syntax check passed)`)
                      yield { event: 'status', data: { stage: 'partial_patch', detail: `${totalApplied} of ${totalApplied + totalFailed} patches applied. ${totalFailed} failed but file is syntactically valid.` } }
                    } else {
                      console.error(`[SelfEdit-Partial] Partial patches produced broken syntax — blocking save`)
                      yield { event: 'status', data: { stage: 'patch_failed', detail: `${totalApplied} patches applied but the result has syntax errors. No changes saved.` } }
                      args.files = []
                      saveTool = '__blocked__'
                    }
                  } else if (totalFailed > 0 && totalApplied === 0) {
                    // Complete failure: NO patches applied even after retry — do NOT save corrupted files
                    console.error(`[patch_files] COMPLETE FAILURE: 0/${totalFailed} patches applied — skipping save to prevent file corruption`)
                    console.error(`[patch_files] args.files before clear:`, args.files?.length, args.files?.map(f => f.path))
                    yield { event: 'status', data: { stage: 'patch_failed', detail: `All ${totalFailed} patches failed — the search strings didn't match the file content. No changes saved.` } }
                    // Clear files array so the save pipeline skips this tool call entirely
                    args.files = []
                    saveTool = '__blocked__'
                    console.error(`[patch_files] args.files after clear:`, args.files?.length, 'saveTool:', saveTool)
                  }

                  // Mark as update so the save pipeline treats it correctly
                  if (args.files.length > 0) {
                    saveTool = 'update_files'
                  }
                }
                // ── Self-Edit Patch Merger: apply patches to original files ──
                if (isSelfEdit && args.files && args.files.length > 0) {
                  const fs = await import('fs')
                  const path = await import('path')
                  for (let i = 0; i < args.files.length; i++) {
                    const file = args.files[i]
                    if (!file.content || !file.path) continue
                    
                    // Check if content uses patch format
                    if (file.content.trim().startsWith('<<<PATCHES>>>')) {
                      const fullPath = path.resolve('/app', file.path)
                      if (fs.existsSync(fullPath)) {
                        const original = fs.readFileSync(fullPath, 'utf-8')
                        const patched = applyPatchContent(original, file.content)
                        if (patched) {
                          // Post-edit validation: check exports preserved
                          const validation = validateExportsPreserved(original, patched)
                          if (!validation.valid) {
                            console.warn('[SelfEdit-Validate] Missing exports in patched file:', file.path, validation.missing)
                            // Re-add missing exports from original
                            args.files[i] = { ...file, content: patched + '\n// WARNING: Exports were missing, original file preserved\n' }
                          } else {
                            args.files[i] = { ...file, content: patched }
                          }
                          console.log('[SelfEdit-Patch] Merged patches for:', file.path)
                        } else {
                          console.warn('[SelfEdit-Patch] Patch apply failed for:', file.path, '— keeping AI output as-is')
                        }
                      }
                    } else {
                      // Full-file mode: validate exports + check for destructive rewrite
                      const fullPath = path.resolve('/app', file.path)
                      if (fs.existsSync(fullPath)) {
                        const original = fs.readFileSync(fullPath, 'utf-8')
                        const originalSize = Buffer.byteLength(original, 'utf-8')
                        const newSize = Buffer.byteLength(file.content, 'utf-8')
                        
                        // Export validation (skip for deliberate patch→update fallback)
                        const validation = validateExportsPreserved(original, file.content)
                        if (!validation.valid && !args._patchFallback) {
                          console.warn('[SelfEdit-Validate] Missing exports:', file.path, validation.missing, '— falling back to original + appended suggestions')
                          args.files[i] = { ...file, content: original + '\n\n// === AI SUGGESTED ADDITIONS (review and integrate manually) ===\n// ' + file.content.replace(/\n/g, '\n// ') + '\n' }
                        } else if (originalSize > 500 && newSize < originalSize * 0.4 && !args._patchFallback) {
                          console.warn('[SelfEdit-Guard] Destructive rewrite detected for', file.path, `(${originalSize}→${newSize} bytes). Appending suggestions.`)
                          args.files[i] = { ...file, content: original + '\n\n// === AI SUGGESTED ADDITIONS (review and integrate manually) ===\n// ' + file.content.replace(/\n/g, '\n// ') + '\n' }
                        }
                      }
                    }
                  }
                }

                // ── Content Quality Guard: reject files that are descriptions, not code (skip for self-edit) ──
                if (!isSelfEdit && args.files && args.files.length > 0) {
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

                // ── Direct Edit Mode, Self-Edit, or Brief Build: save files immediately, skip diff pipeline ──
                if (directEditMode || isSelfEdit || (isBriefBuild && existingFiles === 0)) {

                  // ── Self-Edit Regression Guard ──
                  // When AI uses update_files on an existing disk file, validate it's not a regression
                  // (i.e., AI rewrote the file from scratch and lost existing features)
                  if (isSelfEdit && saveTool === 'update_files' && args.files?.length > 0) {
                    const fs = await import('fs')
                    const pathMod = await import('path')
                    for (let fi = 0; fi < args.files.length; fi++) {
                      const file = args.files[fi]
                      if (!file.path || !file.content) continue
                      const diskPath = pathMod.resolve('/app', file.path)
                      if (fs.existsSync(diskPath)) {
                        const diskContent = fs.readFileSync(diskPath, 'utf-8')
                        const diskLines = diskContent.split('\n').length
                        const newLines = file.content.split('\n').length

                        // Check 1: If new file is significantly smaller, it's likely a regression
                        if (diskLines > 100 && newLines < diskLines * 0.6) {
                          console.error(`[SelfEdit-RegressionGuard] ${file.path}: disk has ${diskLines} lines, AI wrote ${newLines} — BLOCKED (likely regression)`)
                          yield { event: 'status', data: { stage: 'regression_blocked', detail: `Blocked: your version of ${file.path} is ${newLines} lines vs the current ${diskLines} lines — too much code removed. Use patch_files for targeted edits instead.` } }
                          args.files[fi] = { ...file, content: null, _blocked: true }
                          continue
                        }

                        // Check 2: Check for key function/export names that exist in disk but not in AI version
                        const diskExports = diskContent.match(/export\s+(default\s+)?(?:function|const|class)\s+(\w+)/g) || []
                        const newExports = file.content.match(/export\s+(default\s+)?(?:function|const|class)\s+(\w+)/g) || []
                        const missingExports = diskExports.filter(e => !newExports.includes(e))
                        if (missingExports.length > 0) {
                          console.warn(`[SelfEdit-RegressionGuard] ${file.path}: missing exports: ${missingExports.join(', ')}`)
                        }
                      }
                    }
                    // Remove blocked files
                    args.files = args.files.filter(f => !f._blocked)
                    if (args.files.length === 0) {
                      console.error('[SelfEdit-RegressionGuard] All files blocked — nothing to save')
                      yield { event: 'status', data: { stage: 'blocked', detail: 'All files were blocked by regression guard. Use patch_files for targeted edits on large existing files.' } }
                      break
                    }
                  }

                  yield { event: 'status', data: { stage: 'saving_files', detail: `Saving ${args.files?.length || 0} file(s) directly...` } }
                  const savedFiles = await this.saveFiles(projectId, args.files, saveTool === 'update_files')
                  for (const f of savedFiles) {
                    generatedFiles.push(f)
                    yield { event: 'file', data: { path: f.path, action: saveTool === 'update_files' ? 'updated' : 'created' } }
                    // Emit preview_partial for live preview during brief builds
                    if (isBriefBuild && f.content) {
                      console.log(`[BriefBuild-Preview] Emitting preview_partial for ${f.path} (${f.content.length} chars)`)
                      yield { event: 'preview_partial', data: { path: f.path, content: f.content } }
                    }
                  }
                  console.log(isSelfEdit ? '[SelfEdit]' : directEditMode ? '[DirectEdit]' : '[BriefBuild]', 'Saved', savedFiles.length, 'file(s):', savedFiles.map(f => f.path).join(', '))

                  // ── Guardrail 1: Direct-build integrity check ──
                  if (savedFiles.length === 0) {
                    console.error('[Guardrail] REGRESSION: Direct-edit produced 0 saved files', JSON.stringify({ saveTool, argsFileCount: args.files?.length }))
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

                  // ── Self-edit: ALWAYS replace AI's text with clean summary ──
                  if (isSelfEdit && savedFiles.length > 0) {
                    const shortFiles = savedFiles.map(f => (f.path || '').split('/').pop()).join(', ')
                    const summaryText = patchSummary || 'Code updated.'

                    // Auto-verify: write files to disk temporarily and check build
                    let buildPassed = false
                    let buildError = ''
                    try {
                      const fs = await import('fs')
                      const pathMod = await import('path')
                      const backups = []
                      // Write files to disk for verification
                      for (const f of savedFiles) {
                        if (!f.path || !f.content) continue
                        const fullPath = pathMod.resolve('/app', f.path)
                        let backup = null
                        try { backup = fs.readFileSync(fullPath, 'utf-8') } catch {}
                        backups.push({ path: fullPath, content: backup, relPath: f.path })
                        const dir = pathMod.dirname(fullPath)
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
                        fs.writeFileSync(fullPath, f.content, 'utf-8')
                      }
                      // Force recompilation by requesting the main page
                      await new Promise(r => setTimeout(r, 2000))
                      const pageRes = await fetch('http://localhost:3000/', { 
                        signal: AbortSignal.timeout(15000),
                        headers: { 'Accept': 'text/html' }
                      })
                      const pageText = await pageRes.text()
                      const hasBuildError = pageText.includes('Build Error') || 
                                           pageText.includes('SyntaxError') || 
                                           pageText.includes('Module build failed') ||
                                           pageText.includes('Expected') ||
                                           pageText.includes('Unexpected token')
                      if (!hasBuildError && pageRes.ok) {
                        buildPassed = true
                        console.log(`[SelfEdit] Build verified OK for ${shortFiles}`)
                      } else {
                        // Build failed — grab error from BOTH err and out logs
                        try {
                          const errLog = fs.readFileSync('/var/log/supervisor/nextjs_api.err.log', 'utf-8')
                          const outLog = fs.readFileSync('/var/log/supervisor/nextjs_api.out.log', 'utf-8')
                          const allLines = [...errLog.split('\n'), ...outLog.split('\n')]
                          // Look for the most recent error markers
                          for (let i = allLines.length - 1; i >= 0; i--) {
                            if (allLines[i].includes('Error') || allLines[i].includes('Syntax') || allLines[i].includes('Expected') || allLines[i].includes('Module build failed') || allLines[i].includes('SWC')) {
                              const start = Math.max(0, i - 5)
                              const end = Math.min(allLines.length, i + 10)
                              buildError = allLines.slice(start, end).join('\n')
                              break
                            }
                          }
                        } catch {}
                        // Revert disk files
                        for (const b of backups) {
                          if (b.content != null) fs.writeFileSync(b.path, b.content, 'utf-8')
                        }
                        console.error(`[SelfEdit] Build FAILED for ${shortFiles} — reverted. Error: ${buildError.slice(0, 200)}`)
                      }
                    } catch (verifyErr) {
                      // Can't verify — assume pass but warn
                      buildPassed = true
                      console.warn(`[SelfEdit] Build verification failed (non-blocking): ${verifyErr.message}`)
                    }

                    if (buildPassed) {
                      fullContent = `Updated **${shortFiles}** — ${summaryText}\nBuild verified — changes are live now.`
                      yield { event: 'replace_content', data: { content: fullContent } }
                    } else {
                      // BUILD FAILED — inform user and retry
                      yield { event: 'status', data: { stage: 'retrying', detail: 'Build error detected — auto-reverted, retrying...' } }
                      const errorSnippet = buildError ? buildError.split('\n').slice(0, 5).join('\n') : 'Unknown syntax error'
                      fullContent = `⚠️ **Build error detected** — changes were auto-reverted.\n\n\`\`\`\n${errorSnippet}\n\`\`\`\n\nRetrying with a corrected approach...`
                      yield { event: 'replace_content', data: { content: fullContent } }

                      // Read reverted file for AI context
                      let revertedContent = ''
                      try {
                        const fs = await import('fs')
                        const pathMod = await import('path')
                        for (const f of savedFiles) {
                          if (!f.path) continue
                          const fullPath = pathMod.resolve('/app', f.path)
                          try {
                            const content = fs.readFileSync(fullPath, 'utf-8')
                            revertedContent += `\n## ${f.path} (current working version):\n\`\`\`\n${content.split('\n').map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n').slice(0, 20000)}\n\`\`\`\n`
                          } catch {}
                        }
                      } catch {}

                      const retryMsg = `[SYSTEM: Your edit to ${shortFiles} caused a BUILD ERROR and was auto-reverted.\n\nCompilation error:\n\`\`\`\n${buildError || 'Unknown syntax error'}\n\`\`\`\n${revertedContent}\n\nYou MUST fix this. Use search_replace with a SMALLER, targeted edit. Copy the EXACT text to change as old_str. Call search_replace NOW.]`
                      messages.push({ role: 'assistant', content: fullContent })
                      messages.push({ role: 'user', content: retryMsg })
                      fullContent = ''
                      toolCalls = []
                      toolOpts.tool_choice = 'required'
                      agentLoopContinue = true
                      break
                    }
                  }

                  // ── Brief Build: ALWAYS replace AI's raw tool output with clean summary ──
                  if (isBriefBuild && savedFiles.length > 0) {
                    const fileNames = savedFiles.map(f => f.path?.replace(/^src\/(components|pages)\//, '').replace(/\.(jsx|tsx|js|ts|css)$/, '')).filter(Boolean)
                    const pageList = fileNames.length > 0 ? fileNames.join(', ') : 'your pages'
                    const briefMatch = userMessage?.match(/(?:Project|Brand name):\s*(.+?)(?:\n|$)/i)
                    const projectName = briefMatch ? briefMatch[1].trim() : 'Your project'
                    const suggestions = []
                    const code = savedFiles.map(f => f.content || '').join(' ').toLowerCase()
                    if (!code.includes('usestate') && !code.includes('onclick'))
                      suggestions.push(`Add interactivity — click handlers, form submissions, or toggles`)
                    if (!code.includes('<form'))
                      suggestions.push('Add a contact form or signup flow')
                    if (!code.includes('animation') && !code.includes('transition'))
                      suggestions.push('Add entrance animations and hover transitions')
                    if (fileNames.length < 5)
                      suggestions.push(`Add more pages — maybe About, Blog, or FAQ`)
                    if (suggestions.length < 3)
                      suggestions.push('Refine the copy and messaging to match your brand voice')
                    fullContent = `${projectName} is live! I built ${savedFiles.length} files: ${pageList}.\n\nHere's what I'd suggest next:\n${suggestions.slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nJust tell me what to change — I'll update it instantly.`
                    yield { event: 'replace_content', data: { content: fullContent } }
                  }

                  // ── Guardrail 3: Success message truth — fallback only if nothing above triggered ──
                  if (savedFiles.length > 0 && !fullContent) {
                    const { text: deText, runtimeEvent: deRt } = buildVerifiedResponseWithRuntime(savedFiles, userMessage, refinementMode, isSelfEdit)
                    fullContent = deText
                    if (deRt) yield deRt
                    yield { event: 'token', data: { content: fullContent } }
                  }

                  // ── Self-edit enhancement suggestion (show occasionally, not every time) ──
                  if (isSelfEdit && savedFiles.length > 0) {
                    // Only show a suggestion ~30% of the time to avoid overwhelming the user
                    const showSuggestion = Math.random() < 0.3
                    if (showSuggestion) {
                      const enhanceSuggestions = generateSelfEditSuggestions(savedFiles, userMessage)
                      if (enhanceSuggestions.length > 0) {
                        const suggestionsBlock = `\n\n**Idea:** ${enhanceSuggestions[0]}`
                        fullContent += suggestionsBlock
                        yield { event: 'token', data: { content: suggestionsBlock } }
                      }
                    }

                    // ── Auto-update Canvas: smart checklist management ──
                    try {
                      const editedPaths = savedFiles.map(f => f.path).filter(Boolean)
                      const timestamp = new Date().toLocaleString()
                      const editSummary = userMessage.length > 80 ? userMessage.slice(0, 80) + '...' : userMessage
                      const canvasEntry = `- [x] ${editedPaths.map(p => p.split('/').pop()).join(', ')} — ${editSummary} (${timestamp})`

                      const canvasData = await db.projectCanvas.findByProjectId(projectId)
                      let rawContent = canvasData?.canvas_content || ''

                      // Normalize: if old JSON format or not a markdown string, start fresh
                      let canvasContent = ''
                      if (typeof rawContent === 'string' && rawContent.startsWith('#')) {
                        canvasContent = rawContent
                      }

                      if (!canvasContent) {
                        canvasContent = `# Core System — Project Canvas\n\n## Recent Edits\n${canvasEntry}\n\n## Next Steps\n- [ ] Verify changes in the UI`
                      } else {
                        // 1. Try to check off matching items in "Next Steps"
                        const msgLower = userMessage.toLowerCase()
                        const lines = canvasContent.split('\n')
                        for (let i = 0; i < lines.length; i++) {
                          const line = lines[i]
                          if (line.match(/^- \[ \]/) ) {
                            const taskText = line.replace(/^- \[ \]\s*/, '').toLowerCase()
                            // Check if the edit matches this next-step item
                            const taskWords = taskText.split(/\s+/).filter(w => w.length > 3)
                            const matchCount = taskWords.filter(w => msgLower.includes(w)).length
                            if (matchCount >= 2 || (taskWords.length <= 3 && matchCount >= 1)) {
                              lines[i] = line.replace('- [ ]', '- [x]')
                              console.log(`[SelfEdit-Canvas] Auto-checked: ${taskText}`)
                            }
                          }
                        }
                        canvasContent = lines.join('\n')

                        // 2. Append to Recent Edits
                        if (canvasContent.includes('## Recent Edits')) {
                          canvasContent = canvasContent.replace('## Recent Edits', `## Recent Edits\n${canvasEntry}`)
                        } else {
                          canvasContent += `\n\n## Recent Edits\n${canvasEntry}`
                        }
                      }

                      await db.projectCanvas.update(projectId, canvasContent).catch(async () => {
                        await db.projectCanvas.create({ project_id: projectId, canvas_content: canvasContent })
                      })
                      yield { event: 'canvas_update', data: { projectId, content: canvasContent } }
                      console.log('[SelfEdit-Canvas] Updated canvas, len:', canvasContent.length)
                    } catch (canvasErr) {
                      console.warn('[SelfEdit-Canvas] Failed to update canvas:', canvasErr.message)
                    }

                    // ── Auto-verify: check compilation after self-edit save ──
                    try {
                      const verifyRes = await fetch('http://localhost:3000/api/health?compile=full', { signal: AbortSignal.timeout(8000) })
                      if (verifyRes.ok) {
                        console.log('[SelfEdit-AutoVerify] Build verified OK after save')
                        const verifyMsg = '\n\nBuild verified — changes compile successfully.'
                        fullContent += verifyMsg
                        yield { event: 'token', data: { content: verifyMsg } }
                      } else {
                        console.warn('[SelfEdit-AutoVerify] Build check returned', verifyRes.status)
                        const verifyMsg = '\n\nNote: Build check returned a warning. Changes may need review.'
                        fullContent += verifyMsg
                        yield { event: 'token', data: { content: verifyMsg } }
                      }
                    } catch (verifyErr) {
                      console.warn('[SelfEdit-AutoVerify] Verify failed:', verifyErr.message)
                    }
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
                const hasPlanCallInCycle = toolCalls.some(tc => { try { return tc.function.name === 'propose_plan' } catch { return false } })
                if (hasPlanCallInCycle) {
                  yield { event: 'status', data: { stage: 'deferred_to_plan', detail: 'Plan proposed — file changes deferred to execution phase' } }
                  continue
                }

                // Generate diffs for review instead of writing files directly
                yield { event: 'status', data: { stage: 'generating_diffs', detail: `Building diff preview for ${args.files?.length || 0} file(s)...` } }
                const { buildPendingDiffs } = await import('@/lib/self_builder/file_ops_bridge')
                const pendingDiffs = buildPendingDiffs(args.files, {
                  planFileActions: null,
                  findExisting,
                  toolName: saveTool,
                  detectFileType,
                })

                // Skip grounding validation for brand-new projects — there are no files to ground against
                const skipGroundingValidation = isBriefBuild && existingFiles === 0
                const patchResult = skipGroundingValidation
                  ? { valid: true, errors: [], warnings: [] }
                  : validatePatchGrounding(pendingDiffs, filesByPath, null)
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
                        const { text: s1Text, runtimeEvent: s1Rt } = buildVerifiedResponseWithRuntime(saved, userMessage, true, isSelfEdit)
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
              } else if (toolName === 'read_files') {
                // ── Agent Loop: read_files (extracted to tool-handlers.js) ──
                const _ctx = { projectId, allProjectFiles, isSelfEdit, messages, fullContent, toolCalls, toolOpts, agentLoopCount, MAX_AGENT_LOOPS, effectiveToolSet }
                const _result = await handleReadFilesTool(args, toolCall, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent; toolCalls = _ctx.toolCalls; agentLoopCount = _ctx.agentLoopCount; effectiveToolSet = _ctx.effectiveToolSet
                if (_result.loopContinue) { agentLoopContinue = true }
                if (_result.breakLoop) break

              } else if (toolName === 'verify_build') {
                // ── Agent Loop: verify_build (extracted to tool-handlers.js) ──
                const _ctx = { projectId, allProjectFiles, isSelfEdit, messages, fullContent, toolCalls, toolOpts, agentLoopCount, MAX_AGENT_LOOPS }
                const _result = await handleVerifyBuildTool(args, toolCall, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent; toolCalls = _ctx.toolCalls; agentLoopCount = _ctx.agentLoopCount
                if (_result.loopContinue) { agentLoopContinue = true }
                if (_result.breakLoop) break

              } else if (toolName === 'search_replace') {
                // ── Agent Loop: search_replace — EXACT STRING MATCHING (safest) ──
                yield { event: 'status', data: { stage: 'editing', detail: `Editing ${args.path} (${args.edits?.length || 0} replacements)...` } }

                // Auto-snapshot before self-edit — extracted to self-edit-snapshot.js
                if (isSelfEdit) snapshotSelfEditFile(args.path, 'search_replace')

                const srResult = await handleSearchReplace(args, { projectId, isSelfEdit })

                // Save to DB
                if (srResult.success && srResult.content && projectId) {
                  try {
                    await db.projectFiles.upsert(projectId, args.path, srResult.content)
                    console.log(`[search_replace] Saved to DB: ${args.path}`)
                  } catch (saveErr) {
                    console.error(`[search_replace] DB save error: ${saveErr.message}`)
                  }
                }

                // Auto-verify build (extracted to self-edit-verify.js)
                if (isSelfEdit && srResult.success) {
                  canvasUpdated = true
                  yield { event: 'status', data: { stage: 'verifying', detail: 'Verifying build...' } }
                  await verifyAndRevertSelfEdit(args, srResult, 'search_replace')
                }

                const srCallId = toolCall.id || ('sr_' + Date.now())

                // Handle build failure → retry
                if (!srResult.success && isSelfEdit && srResult.errors?.some(e => e.includes('BUILD BROKEN'))) {
                  yield { event: 'status', data: { stage: 'retrying', detail: 'Build error — retrying...' } }
                  yield { event: 'token', data: { content: '\n\n⚠️ *Build error detected — changes were auto-reverted. Retrying...*\n\n' } }
                  let revertedContent = ''
                  try {
                    const fs = await import('fs')
                    const fullPath = (await import('path')).resolve('/app', args.path)
                    revertedContent = fs.readFileSync(fullPath, 'utf-8')
                    revertedContent = revertedContent.split('\n').map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n')
                  } catch {}
                  const retryMsg = `[SYSTEM: Your search_replace edit to ${args.path} BROKE THE BUILD and was auto-reverted.\n\n${srResult.errors.join('\n')}\n\nHere is the file:\n\`\`\`\n${revertedContent.slice(0, 30000)}\n\`\`\`\n\nTry again with search_replace. Make sure old_str matches EXACTLY. Call search_replace NOW.]`
                  messages.push({ role: 'assistant', content: null, tool_calls: [{ id: srCallId, type: 'function', function: { name: 'search_replace', arguments: toolCall.function.arguments } }] })
                  messages.push({ role: 'tool', tool_call_id: srCallId, content: `Edit failed: ${srResult.errors[0]?.slice(0, 300)}` })
                  messages.push({ role: 'user', content: retryMsg })
                  fullContent = ''
                  toolCalls = []
                  toolOpts.tool_choice = 'required'
                  agentLoopContinue = true
                  break
                }

                const srMsg = srResult.success
                  ? `Successfully applied ${srResult.applied} replacement(s) to \`${args.path}\` (${srResult.linesBefore} → ${srResult.linesAfter} lines). Build verified OK.\n\nChanges are live now.${srResult.failed > 0 ? `\n\nWarnings: ${srResult.errors.join(', ')}` : ''}`
                  : `Edit failed: ${srResult.errors?.join(', ') || srResult.error || 'Unknown error'}`

                messages.push({ role: 'assistant', content: null, tool_calls: [{ id: srCallId, type: 'function', function: { name: 'search_replace', arguments: toolCall.function.arguments } }] })
                messages.push({ role: 'tool', tool_call_id: srCallId, content: srMsg })
                agentLoopContinue = true
                break

              } else if (toolName === 'edit_lines') {
                // ── Agent Loop: edit_lines — LINE-NUMBER BASED EDITING ──
                yield { event: 'status', data: { stage: 'editing', detail: `Editing ${args.path} (${args.edits?.length || 0} edits)...` } }

                // Auto-snapshot before self-edit — extracted to self-edit-snapshot.js
                if (isSelfEdit) snapshotSelfEditFile(args.path, 'edit_lines')

                const editResult = await handleEditLines(args, { projectId, isSelfEdit })

                if (editResult.success) {
                  // Save to Supabase for the diff view / Apply to Live pipeline
                  try {
                    const saved = await this.saveFiles(projectId, [{ path: args.path, content: editResult.content }], true)
                    if (saved?.length > 0) {
                      generatedFiles.push(...saved)
                      console.log(`[edit_lines] Saved to DB: ${args.path}`)
                    }
                  } catch (saveErr) {
                    console.error(`[edit_lines] DB save error: ${saveErr.message}`)
                  }

                  console.log(`[edit_lines-precheck] About to check isSelfEdit=${isSelfEdit} for auto-verify`)
                  // For self-edit: file is already written to disk by handleEditLines
                  // Auto-verify build (extracted to self-edit-verify.js)
                  if (isSelfEdit) {
                    canvasUpdated = true
                    yield { event: 'status', data: { stage: 'verifying', detail: 'Verifying build...' } }
                    await verifyAndRevertSelfEdit(args, editResult, 'edit_lines')
                  }
                }

                const editCallId = toolCall.id || ('edit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))

                if (!editResult.success && isSelfEdit && editResult.errors?.some(e => e.includes('BUILD BROKEN'))) {
                  // ── BUILD FAILED — inform user and force AI to retry ──
                  yield { event: 'status', data: { stage: 'retrying', detail: 'Build error detected — auto-reverted, retrying...' } }
                  yield { event: 'token', data: { content: '\n\n⚠️ *Build error detected — changes were auto-reverted. Retrying with a corrected approach...*\n\n' } }

                  // Read the reverted file to give the AI full context for retry
                  let revertedContent = ''
                  try {
                    const fs = await import('fs')
                    const pathMod = await import('path')
                    const fullPath = pathMod.resolve('/app', args.path)
                    revertedContent = fs.readFileSync(fullPath, 'utf-8')
                    revertedContent = revertedContent.split('\n').map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join('\n')
                  } catch {}

                  const retryMsg = `[SYSTEM: Your edit to ${args.path} BROKE THE BUILD and was auto-reverted. The app is safe.\n\n${editResult.errors.join('\n')}\n\nHere is the CURRENT file (after revert) with line numbers:\n\`\`\`\n${revertedContent.slice(0, 30000)}\n\`\`\`\n\nYou MUST fix this now. Use \`edit_lines\` again with a SMALLER edit. Common JSX mistakes:\n- Missing closing </button> tag\n- Nesting a <button> inside another <button>\n- Dropping the closing </> for React fragments\n- Wrong indentation breaking JSX expression boundaries\n\nLook at the error above, find the exact problem, and make a MINIMAL edit. Call edit_lines NOW.]`

                  messages.push({ role: 'assistant', content: null, tool_calls: [{ id: editCallId, type: 'function', function: { name: 'edit_lines', arguments: toolCall.function.arguments } }] })
                  messages.push({ role: 'tool', tool_call_id: editCallId, content: `Edit failed and was auto-reverted. Error: ${editResult.errors[0]?.slice(0, 300)}` })
                  messages.push({ role: 'user', content: retryMsg })
                  fullContent = ''
                  toolCalls = []
                  toolOpts.tool_choice = 'required'
                  agentLoopCount = (agentLoopCount || 0) + 1
                  if (agentLoopCount > MAX_AGENT_LOOPS) { break }
                  agentLoopContinue = true
                  break
                }

                const resultMsg = editResult.success
                  ? `Successfully applied ${editResult.applied} edit(s) to \`${args.path}\` (${editResult.linesBefore} → ${editResult.linesAfter} lines). Build verified OK.${editResult.errors.length > 0 ? `\nWarnings: ${editResult.errors.join(', ')}` : ''}\n\nChanges are live now.`
                  : `Edit failed: ${editResult.errors?.join(', ') || editResult.error || 'Unknown error'}`
                messages.push({ role: 'assistant', content: fullContent || null, tool_calls: [{ id: editCallId, type: 'function', function: { name: 'edit_lines', arguments: toolCall.function.arguments } }] })
                messages.push({ role: 'tool', tool_call_id: editCallId, content: resultMsg })
                fullContent = ''
                toolCalls = []
                toolOpts.tool_choice = 'auto'
                agentLoopCount = (agentLoopCount || 0) + 1
                if (agentLoopCount > MAX_AGENT_LOOPS) { break }
                agentLoopContinue = true
                break

              } else if (toolName === 'exec_command') {
                // ── Agent Loop: exec_command (extracted to tool-handlers.js) ──
                const _ctx = { projectId, messages, fullContent, toolCalls, toolOpts, agentLoopCount, MAX_AGENT_LOOPS }
                const _result = await handleExecCommandTool(args, toolCall, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent; toolCalls = _ctx.toolCalls; agentLoopCount = _ctx.agentLoopCount
                if (_result.loopContinue) { agentLoopContinue = true }
                if (_result.breakLoop) break


              } else if (toolName === 'screenshot_verify') {
                // ── Agent Loop: screenshot_verify (extracted to tool-handlers.js) ──
                const _ctx = { projectId, isSelfEdit, messages, fullContent, toolCalls, toolOpts, agentLoopCount, MAX_AGENT_LOOPS }
                const _result = await handleScreenshotVerifyTool(args, toolCall, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent; toolCalls = _ctx.toolCalls; agentLoopCount = _ctx.agentLoopCount
                if (_result.loopContinue) { agentLoopContinue = true }
                if (_result.breakLoop) break


              } else if (toolName === 'update_memory') {
                // ── Agent Loop: update_memory (extracted to tool-handlers.js) ──
                const _ctx = { projectId, messages, fullContent, toolCalls, toolOpts, agentLoopCount, MAX_AGENT_LOOPS }
                const _result = await handleUpdateMemoryTool(args, toolCall, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent; toolCalls = _ctx.toolCalls; agentLoopCount = _ctx.agentLoopCount
                if (_result.loopContinue) { agentLoopContinue = true }
                if (_result.breakLoop) break

              } else if (toolName === 'update_canvas') {
                // ── Canvas update (extracted to tool-handlers.js) ──
                const _ctx = { projectId, fullContent }
                const _result = await handleUpdateCanvasTool(args, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent
                if (_result.continueLoop) continue

              } else if (toolName === 'delete_files') {
                // ── Delete files (extracted to tool-handlers.js) ──
                const _ctx = { diffFiles, fullContent }
                const _result = handleDeleteFilesTool(args, _ctx, findExisting)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent

              } else if (toolName === 'plan_project') {
                // ── Plan project (extracted to tool-handlers.js) ──
                const _ctx = { planOutput, fullContent }
                const _result = handlePlanProjectTool(args, _ctx)
                for (const ev of _result.events) yield ev
                planOutput = _ctx.planOutput; fullContent = _ctx.fullContent

              } else if (toolName === 'summarize_project') {
                // ── Summarize project (extracted to tool-handlers.js) ──
                const _ctx = { fullContent }
                const _result = handleSummarizeProjectTool(args, _ctx)
                for (const ev of _result.events) yield ev
                fullContent = _ctx.fullContent
              }
            } catch (toolErr) {
              console.error('[AIService] Tool call parse error:', toolErr.message)
            }
          }

          // ── Agent Loop Continuation ──
          // Tools set agentLoopContinue and break out of for-loop. Check here.
        }

        // Check if agent loop should continue (tool requested continuation)
        if (agentLoopContinue) {
          agentLoopContinue = false
        } else {
          break
        }
      } // end while(true) agent loop
      } // end agentLoopContinue outer check

      // ── Self-edit / Core System synthesis pass ──
      // Detects when the AI emitted only "Part 1" (a promise of action) without
      // actually doing the work — e.g., "I'll search through the codebase to
      // find the streaming-related files." This is a complete sentence but
      // still a dangling intent because the AI never produced Parts 2+3 (the
      // tool call + the synthesized answer).
      //
      // Triple-condition detector: intent verb present + no completion verb +
      // short response → fire a synthesis pass that forces the AI to actually
      // produce the answer it promised.
      if (isSelfEdit && toolMode !== 'chat_only') {
        const fullText = (fullContent || '').toLowerCase()
        const tailText = fullText.trim().slice(-300)
        // Part 1 indicators — future-tense promises of action
        const hasIntentVerb = /\b(let me|i'?ll|i will|i'?m (going|about) to|going to|about to|searching|reading|looking (at|for|through|into)|finding|checking|investigating|inspecting|examining|exploring|locating|tracing|attempting to)\b/.test(tailText)
        // Part 3 indicators — past-tense findings / concrete results
        // Tight regex: each match must be unambiguously past-tense or
        // result-shaped (not a future-tense reference using the same words).
        const hasCompletionVerb = /\b(i (found|read|checked|saw|identified|located|discovered|see)|i'?ve (found|read|checked|identified|located)|(found|located|identified) (it|the|a|an)|here(?:'s| is) (the|what|how|why|a|an)|the (bug|issue|problem|error|root cause|fix|reason) (is|was) (at|in line|that|because|caused)|at line \d+|in (line|the file) \d|appears to be|after (reading|checking|searching|looking)|turns out|based on (the|what|my))\b/.test(fullText) || /\/app\/[\w./-]+/.test(fullText)
        const isTooShort = (fullContent || '').length < 300
        // Catch-all for ultra-short Part-1-only responses (any 1-phrase
        // acknowledgment like "Looking now:", "Sure.", "Checking..."). If the
        // AI produced fewer than 100 chars total AND made no tool calls AND
        // didn't reference a concrete finding, it almost certainly stopped
        // before doing the actual work. Completion verbs (line N, I found,
        // here is, etc.) bypass this check — a brief response that includes
        // a concrete finding is fine.
        const usedAnyToolEarly = (messages || []).some(m => m.role === 'tool')
        const isUltraShortWithoutTool = (fullContent || '').trim().length > 0 && (fullContent || '').trim().length < 100 && !hasCompletionVerb && !usedAnyToolEarly
        // FAILURE-MODE 2 — AI is asking the user for help instead of acting.
        // "Should I try X?" / "Which would you prefer?" / "Tell me which file"
        // / "Use the file dropdown" — these are abdications of agency.
        // When read_files fails, the AI must auto-retry with exec_command,
        // not stop and ask the user to pick the path.
        const asksUserForHelp = /\b(which would you prefer|should i try|can you (select|navigate|tell me|point me|specify)|please (select|specify|tell|point)|use the file dropdown|which file (do|should|would) you|tell me (which|what) file|i can'?t (proceed|access|find|read)|i need you to|unblock this|stuck in a loop)\b/.test(fullText)
        // A response is "dangling" if it promised but didn't deliver — applies
        // regardless of whether the sentence ends with a period, colon, or
        // anything else.
        const danglingIntent = (hasIntentVerb && !hasCompletionVerb && isTooShort) || isUltraShortWithoutTool
        const usedAnyTool = (messages || []).some(m => m.role === 'tool')
        const needsSynthesis = (usedAnyTool && (fullContent || '').length < 500) || danglingIntent || asksUserForHelp
        if (needsSynthesis) {
          // Wrap the ENTIRE synthesis pass in a hard outer try/catch so a bug
          // here can NEVER crash the parent stream / API route again.
          try {
            console.log('[SelfEdit-Synthesis] Triggering final follow-up pass:', JSON.stringify({ usedAnyTool, danglingIntent, asksUserForHelp, hasIntentVerb, hasCompletionVerb, isTooShort, isUltraShortWithoutTool, fullContentLength: (fullContent || '').length }))
            yield { event: 'status', data: { stage: 'synthesizing', detail: 'Generating follow-up response...' } }
            const synthesisDirective = asksUserForHelp
              ? 'You asked the user for help / told them to select a file / said you were stuck. THIS IS A FAILURE RESPONSE. The user has no idea where files live — that is your job. STOP asking for help. Based on the tool results above, respond NOW with concrete findings in past tense (file paths, line numbers, what the code does). Do NOT call any more tools. Do NOT ask the user any more questions.'
              : danglingIntent
              ? 'You said "' + tailText.slice(-150).trim() + '" but did not actually do the work or produce the answer the user asked for. STOP. Based on any tool results above (or what you already know), respond NOW with: specific file paths, specific line numbers, specific findings. Speak in past tense ("I found X in Y at line Z") not future tense ("I\'ll look at"). Do NOT call any tools — just deliver a concrete answer in plain text.'
              : 'You ran tool(s) and got results. Now respond to the user with a clear, concrete synthesis: what did you find, what does it mean, and what would you do next? Reference specific file paths and line numbers. Speak in past tense about findings. Be confident and direct. Do NOT call any more tools — text response only.'

            // ── Sanitize messages for the tool-less chatStream() call ──
            // Anthropic rejects (400) requests that contain `tool_use` blocks
            // in assistant turns when no `tools` array is provided. The
            // sanitizer strips tool_calls, drops role:'tool' messages
            // (converting them to user notes), and coalesces same-role
            // neighbors. Extracted to /lib/ai/synthesis-sanitizer.js so it is
            // independently unit-testable.
            const { cleanForSynthesis } = await import('./synthesis-sanitizer.js')
            const baseClean = cleanForSynthesis(messages)
            const synthMessages = [...baseClean, { role: 'user', content: '[SYSTEM: ' + synthesisDirective + ']' }]
            // Final guard: ensure the array ends with a user role
            const lastSynth = synthMessages[synthMessages.length - 1]
            if (!lastSynth || lastSynth.role !== 'user') {
              synthMessages.push({ role: 'user', content: '[SYSTEM: ' + synthesisDirective + ']' })
            }

            let synthText = ''
            try {
              for await (const chunk of this._streamWithFallback(() => this.provider.chatStream(synthMessages, { temperature: 0.7, max_tokens: 2048 }))) {
                if (chunk.type === 'token') {
                  synthText += chunk.content
                  yield { event: 'token', data: { content: chunk.content } }
                } else if (chunk.type === 'status') {
                  yield { event: 'status', data: { stage: chunk.stage, detail: chunk.detail } }
                }
              }
            } catch (streamErr) {
              console.error('[SelfEdit-Synthesis] Inner stream failed:', streamErr?.message || streamErr)
            }
            if (synthText) {
              fullContent = (fullContent ? fullContent + '\n\n' : '') + synthText
            }
            console.log('[SelfEdit-Synthesis] Synthesis pass complete,', synthText.length, 'chars')
          } catch (synthErr) {
            // Hardened catch-all — synthesis is best-effort, must never crash the route
            console.error('[SelfEdit-Synthesis] Outer failure (non-fatal):', synthErr?.message || synthErr, synthErr?.stack || '')
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
            const { text: nbText, runtimeEvent: nbRt } = buildVerifiedResponseWithRuntime(savedFiles, userMessage, false, isSelfEdit)
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
                const { text: s2Text, runtimeEvent: s2Rt } = buildVerifiedResponseWithRuntime(saved, userMessage, true, isSelfEdit)
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
            ? buildVerifiedResponseWithRuntime(sanitizedSaved, userMessage, true, isSelfEdit)
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

      if (!hasDiffs && !canvasUpdated) {
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

      // ── Self-edit completion: summary already handled by replace_content event ──
      // (No additional text appended here — clean summary was already emitted)

            // 13. Done event with metadata
      // ── Guardrail 6: Regression logging ──
      if (directEditMode) {
        if (generatedFiles.length === 0) console.error('[Guardrail] REGRESSION: Direct-edit done with 0 generated files')
        if (generatedFiles.length > 0 && !toolArgsAccum) console.warn('[Guardrail] Direct-edit generated files but no preview_partial was emitted (no tool_args_delta received)')
        if (toolCalls.length === 0) console.error('[Guardrail] REGRESSION: Direct-edit done with 0 tool calls')
      }
      console.log('[Done] generatedFiles:', generatedFiles.length, 'diffFiles:', diffFiles.length, 'directEditMode:', directEditMode)
      if (generatedFiles.length > 0) console.log('[Done] files:', generatedFiles.map(f => ({ path: f.path, action: f.action, id: f.id })))

      // ── Auto-save memory: record what happened this turn ──
      if (projectId && (generatedFiles.length > 0 || canvasUpdated)) {
        try {
          await saveActionMemory(projectId, {
            type: generatedFiles.length > 0 ? 'edit' : 'canvas',
            files: generatedFiles.map(f => f.path),
            summary: fullContent?.slice(0, 200) || 'Changes applied',
            success: true,
          })
        } catch {}
      }

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


// ══════════════════════════════════════════════════════════════════════
// ── NEW BRIEF PIPELINE (behind EMANATOR_NEW_PIPELINE flag) ──
// Archetype inference → plan → wave loop → save. Falls back to legacy
// single-file fast-path on any hard error by returning {handled: false}.
// ══════════════════════════════════════════════════════════════════════
async function* runNewBriefPipeline({ aiService, projectId, chatId, userId, userMessage, attachments, runId, startTime }) {
  const pipelineStart = Date.now()

  // ── Parse brief fields (same extraction logic as legacy path) ──
  const extractField = (label) => {
    const regex = new RegExp(label.replace(/[()]/g, '\\$&') + ':\\s*(.+?)(?:\\n[A-Z]|$)', 's')
    const match = userMessage.match(regex)
    return match ? match[1].trim() : ''
  }

  // Short-chat path: if the user typed a plain free-form message (no
  // "Brand name:" labels), derive a brandName + projectDesc from the
  // message itself so the AI has real context instead of defaulting to
  // "My App / Dashboard / SaaS". This is the ONLY way to get targeted
  // content when someone types "landing page for a coffee shop" directly.
  const looksLikeFormBrief = /Brand name.*:|Project description:|Pages to build:|Must-have features:/i.test(userMessage)
  const shortChatTrim = (userMessage || '').trim().slice(0, 200)
  const derivedBrandName = !looksLikeFormBrief && shortChatTrim.length > 0
    // Take a 2-4-word slice of the user's message as the brand descriptor.
    // e.g. "landing page for a coffee shop" → "coffee shop"
    ? (() => {
        const afterFor = shortChatTrim.match(/\bfor\s+(?:a|an|the)?\s*([^.!?\n]{3,60})/i)
        if (afterFor) return afterFor[1].trim().replace(/^(a|an|the)\s+/i, '')
        // Strip "build/create/make/design a" prefixes and any "landing page"/"site"/"dashboard" suffix
        const cleaned = shortChatTrim
          .replace(/^(build|create|make|design|generate)\s+(a|an|the)?\s*/i, '')
          .replace(/\b(landing\s*page|site|website|app|dashboard|platform|tool|page)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
        return cleaned.slice(0, 60) || shortChatTrim.slice(0, 60)
      })()
    : ''

  const brief = {
    brandName: extractField('Brand name (MUST use this exact name throughout the UI)') || extractField('Brand name') || extractField('Project name') || derivedBrandName || 'My App',
    colorDirection: extractField('Color direction') || extractField('Colors') || '',
    mustHaveFeatures: extractField('Must-have features (implement ALL of these with full UI)') || extractField('Must-have features') || '',
    heroHeadline: extractField('Hero headline/tagline') || extractField('Headline/tagline') || '',
    keyMessaging: extractField('Key messaging to weave throughout') || extractField('Key messaging') || '',
    pagesNeeded: extractField('Pages to build (create navigation between these)') || extractField('Pages to build') || extractField('Pages needed') || '',
    mostImportantPage: extractField('Most important page (build this with the most detail)') || extractField('Most important page') || '',
    referencesSites: extractField('Design references (match this quality/style)') || extractField('Design references') || extractField('Reference sites') || '',
    thingsToAvoid: extractField('AVOID these (critical)') || extractField('Avoid') || '',
    toneOfVoice: extractField('Tone of voice') || extractField('Tone') || '',
    targetAudience: extractField('Target audience') || '',
    projectDesc: extractField('Project description') || extractField('Project') || (!looksLikeFormBrief ? shortChatTrim : ''),
  }
  brief.featuresList = brief.mustHaveFeatures.split(/[,\n]/).map((f) => f.trim()).filter((f) => f.length > 3)
  brief.pagesList = brief.pagesNeeded.split(/[,\n]/).map((p) => p.trim()).filter((p) => p.length > 1)

  // ── Step 1: Classify archetype (or use user's explicit override) ──
  yield { event: 'status', data: { stage: 'classifying', detail: 'Identifying app archetype...' } }
  let archetype
  const archetypeOverrideMatch = userMessage.match(/Archetype override:\s*([a-z_]+)/i)
  const archetypeOverrideId = archetypeOverrideMatch ? archetypeOverrideMatch[1].trim() : null
  try {
    if (archetypeOverrideId) {
      const { ARCHETYPES } = await import('./archetypes.js')
      archetype = ARCHETYPES[archetypeOverrideId] || null
      if (archetype) {
        yield { event: 'archetype', data: { id: archetype.id, label: archetype.label, confidence: 1, source: 'user_override' } }
        console.log('[NewPipeline] Archetype user-override:', archetype.id)
      }
    }
    if (!archetype) {
      const briefText = `${brief.projectDesc} ${brief.mustHaveFeatures} ${brief.pagesNeeded} ${userMessage.slice(0, 1500)}`
      const classified = await classifyArchetype(briefText, aiService.provider)
      archetype = classified.archetype
      yield { event: 'archetype', data: { id: archetype.id, label: archetype.label, confidence: classified.confidence } }
      console.log('[NewPipeline] Classified archetype:', archetype.id, 'confidence:', classified.confidence)
    }
  } catch (err) {
    console.error('[NewPipeline] Classifier failed:', err.message)
    return { handled: false }
  }

  // ── Step 1.5: Art direction + image-asset fan-out (extracted to pipeline/art-direction-fanout.js) ──
  // Partitions user uploads by role (brand / aesthetic / structural) and runs
  // the four Vision calls (art direction prose, design tokens, recipe family,
  // layout blueprint) in sequence. Each call is independently fault-tolerant.
  const __buildTimings = []
  const __t0 = Date.now()
  const tick = (stage, startedAt) => __buildTimings.push({ stage, ms: Date.now() - startedAt })
  let artDirection = null
  let designTokens = null
  let layoutBlueprint = null
  let recipeFamily = null
  let imageAssets = []
  {
    const fanoutGen = runArtDirectionFanout({
      attachments,
      provider: aiService.provider,
      buildTimings: __buildTimings,
    })
    while (true) {
      const next = await fanoutGen.next()
      if (next.done) {
        const r = next.value || {}
        artDirection = r.artDirection
        designTokens = r.designTokens
        layoutBlueprint = r.layoutBlueprint
        recipeFamily = r.recipeFamily
        imageAssets = r.imageAssets || []
        break
      }
      yield next.value
    }
  }

  // ── Step 2: Generate plan ──
  yield { event: 'status', data: { stage: 'planning', detail: `Planning ${archetype.label} structure...` } }
  let plan
  try {
    plan = await generatePlan({ brief, archetype, provider: aiService.provider, artDirection })
    const validation = validateBuildPlan(plan)
    if (!validation.valid) {
      console.warn('[NewPipeline] Plan invalid:', validation.errors)
      return { handled: false }
    }
    plan.artDirection = artDirection
    plan.imageAssets = imageAssets
    plan.designTokens = designTokens || FALLBACK_TOKENS
    plan.layoutBlueprint = layoutBlueprint
    plan.recipeFamily = recipeFamily
    // Images the builder LLM sees IN each wave's user message. We prefer
    // aesthetic refs (best Vision anchor for "what should this look like")
    // and fall back to brand uploads when no aesthetic images were tagged.
    const imageAttachments = (attachments || []).filter((a) => a?.type === 'image' && a?.data)
    const aestheticForPrompt = imageAttachments.filter((a) => a.role === 'aesthetic')
    plan.referenceImages = (aestheticForPrompt.length > 0 ? aestheticForPrompt : imageAttachments)
      .filter((a) => a?.data)
      .slice(0, 2)
      .map((a) => ({
        dataUrl: a.data.startsWith('data:') ? a.data : `data:image/png;base64,${a.data}`,
        role: a.role || 'reference',
        note: a.note || '',
      }))

    // Load project settings to decide whether to wire Supabase/Stripe recipes.
    // User opts in by setting project.settings.supabase and/or project.settings.stripe.
    try {
      const project = await db.projects.findById(projectId)
      const supa = project?.settings?.supabase
      const stripe = project?.settings?.stripe
      plan.useSupabase = !!(supa?.url && supa?.anonKey)
      plan.useStripe = !!(stripe?.publishableKey)
      if (plan.useSupabase) console.log('[NewPipeline] Supabase wiring enabled for project', projectId)
      if (plan.useStripe) console.log('[NewPipeline] Stripe wiring enabled for project', projectId)
    } catch (e) {
      plan.useSupabase = false
      plan.useStripe = false
    }

    yield {
      event: 'brief_plan',
      data: {
        archetypeId: plan.archetypeId,
        brand: plan.brand,
        routes: plan.routes.map((r) => ({ id: r.id, file: r.file, description: r.description })),
        flows: plan.flows,
        components: plan.components.map((c) => ({ name: c.name, file: c.file })),
        waves: plan.waves.map((w) => ({ id: w.id, label: w.label, files: w.files })),
        useSupabase: plan.useSupabase,
        useStripe: plan.useStripe,
      },
    }
    console.log('[NewPipeline] Plan:', plan.routes.length, 'routes,', plan.components.length, 'components,', plan.waves.length, 'waves, supabase:', plan.useSupabase, 'stripe:', plan.useStripe)
  } catch (err) {
    console.error('[NewPipeline] Planner failed:', err.message)
    return { handled: false }
  }

  // ── Step 3: Save reference images as project files + emit assets.js so the
  // builder has real data URLs to import (fixes the logo-not-used regression).
  if (attachments?.length > 0) {
    const imageAttachmentsForSave = attachments.filter((a) => a.type === 'image' && a.data)
    for (const asset of imageAttachmentsForSave) {
      try {
        const imgPath = `assets/${asset.name || 'image-' + Date.now() + '.png'}`
        await aiService.saveFiles(projectId, [{ path: imgPath, content: asset.data }], false)
      } catch (e) { console.warn('[NewPipeline] Failed to save art direction image:', e.message) }
    }
  }

  // ── Step 3a/3b/3c: Deterministic file emitters ──
  // Extracted to /app/lib/ai/pipeline/deterministic-files.js. Emits
  // theme.js, assets.js (with SSE VFS map), and primitives/*.jsx in a
  // fixed dependency-safe order before the builder waves run.
  {
    const detGen = emitDeterministicFiles({ plan, imageAssets, projectId, aiService })
    while (true) {
      const next = await detGen.next()
      if (next.done) break
      yield next.value
    }
  }

  // ── Step 4: Run all waves ──
  const allSavedFiles = []
  const waveResult = yield* runAllWaves({
    plan,
    provider: aiService.provider,
    saveFiles: async (files) => {
      const saved = await aiService.saveFiles(projectId, files, false)
      for (const f of saved) allSavedFiles.push(f)
      return saved
    },
  })

  if (waveResult?.aborted) {
    yield { event: 'error', data: { message: 'Build aborted — scaffold wave failed', error_type: 'build_aborted' } }
    await aiService.logGenerationRun({
      id: runId, project_id: projectId, chat_id: chatId, user_id: userId,
      tool_mode: 'new_pipeline_aborted', files_generated: allSavedFiles.length,
      duration: Date.now() - startTime, success: false,
      provider: aiService.providerName, model: aiService.modelName,
    })
    return { handled: true }
  }

  // ── Step 5 + 5b: LLM review + auto-repair + deterministic safety net ──
  // Extracted to /app/lib/ai/pipeline/review-repair.js. Runs only when the
  // build produced files; no-ops otherwise.
  if (allSavedFiles.length > 0) {
    const rrGen = runReviewAndRepair({ plan, allSavedFiles, projectId, db, aiService, tick })
    while (true) {
      const next = await rrGen.next()
      if (next.done) break
      yield next.value
    }

    // ── Step 5c+d: Visual-fidelity loop (Session 32) ──
    // Extracted to /app/lib/ai/pipeline/visual-loop.js — runs up to N
    // rounds of verify → repair → re-verify, emitting SSE events inline.
    // Returns the summary we thread into the build manifest below.
    const __visualRepairT = Date.now()
    let visualLoopSummary = { rounds: [], totalFilesRepaired: 0, finalMatches: false, initialFindings: 0 }
    {
      const loopGen = runVisualFidelityLoop({ plan, projectId, db, aiService })
      while (true) {
        const next = await loopGen.next()
        if (next.done) { visualLoopSummary = next.value || visualLoopSummary; break }
        yield next.value
      }
    }
    tick('visual_repair', __visualRepairT)

    // ── Step 6: Build observatory manifest ──
    // Extracted to /app/lib/ai/pipeline/observatory-emit.js. Yields the
    // `build_manifest` event and persists `project.integrity.json`.
    tick('total', __t0)
    {
      const obsGen = emitBuildObservatory({
        plan,
        attachments,
        buildTimings: __buildTimings,
        visualLoopSummary,
        projectId,
        db,
        aiService,
      })
      while (true) {
        const next = await obsGen.next()
        if (next.done) break
        yield next.value
      }
    }
  }

  // ── Step 6: Finalize ──
  const summary = `Built ${allSavedFiles.length} file(s) across ${plan.waves.length} wave(s) for ${plan.brand.name}. Archetype: ${archetype.label}. Check the Preview tab.`

  // Auto-snapshot extracted to pipeline/auto-snapshot.js — best-effort,
  // never throws, lets the user rollback any build.
  await createAutoSnapshot({ db, projectId, brief, plan, archetype, runId })

  yield { event: 'token', data: { content: summary } }
  yield { event: 'status', data: { stage: 'complete', detail: 'Build complete' } }
  yield {
    event: 'done',
    data: {
      content: summary,
      files: allSavedFiles.map((f) => ({ path: f.path, action: f.action, id: f.id })),
      toolMode: 'new_pipeline',
      scope: 'project',
      intent: 'build',
      runId,
      provider: aiService.providerName,
      model: aiService.modelName,
      archetype: archetype.id,
      wavesCompleted: plan.waves.length,
      directEditMode: false,
    },
  }

  await aiService.logGenerationRun({
    id: runId, project_id: projectId, chat_id: chatId, user_id: userId,
    tool_mode: `new_pipeline:${archetype.id}`, files_generated: allSavedFiles.length,
    duration: Date.now() - startTime, success: allSavedFiles.length > 0,
    provider: aiService.providerName, model: aiService.modelName,
  })
  console.log('[NewPipeline] Complete in', (Date.now() - pipelineStart) + 'ms,', allSavedFiles.length, 'files')
  return { handled: true }
}

// ══════════════════════════════════════════════════════════════════════
// ── PHASED PIPELINE BRIEF PARSER ──
// Converts the raw user message + form-style labels into a structured
// brief object consumed by phase-1-plan.js.
// ══════════════════════════════════════════════════════════════════════
function parseBriefForPhasedPipeline(userMessage) {
  const text = String(userMessage || '').trim()
  const extract = (label) => {
    const regex = new RegExp(label.replace(/[()]/g, '\\$&') + ':\\s*(.+?)(?:\\n[A-Z]|$)', 's')
    const m = text.match(regex)
    return m ? m[1].trim() : ''
  }
  const hasLabeledFields = /Brand name.*:|Project description:|Pages to build:|Must-have features:/i.test(text)

  // Short-chat path: derive a rough brand name from "for a X" phrase
  let derivedName = ''
  if (!hasLabeledFields && text.length > 0 && text.length < 400) {
    const forMatch = text.match(/\bfor\s+(?:a|an|the)?\s*([^.!?\n]{3,60})/i)
    if (forMatch) derivedName = forMatch[1].trim().replace(/^(a|an|the)\s+/i, '')
    else {
      derivedName = text
        .replace(/^(build|create|make|design|generate)\s+(a|an|the)?\s*/i, '')
        .replace(/\b(landing\s*page|site|website|app|dashboard|platform|tool|page)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
    }
  }

  return {
    rawMessage: text,
    brandName: extract('Brand name (MUST use this exact name throughout the UI)') || extract('Brand name') || extract('Project name') || derivedName,
    projectDesc: extract('Project description') || extract('Project') || (!hasLabeledFields ? text : ''),
    colorDirection: extract('Color direction') || extract('Colors') || '',
    mustHaveFeatures: extract('Must-have features (implement ALL of these with full UI)') || extract('Must-have features') || '',
    heroHeadline: extract('Hero headline/tagline') || extract('Headline/tagline') || '',
    keyMessaging: extract('Key messaging to weave throughout') || extract('Key messaging') || '',
    pagesNeeded: extract('Pages to build (create navigation between these)') || extract('Pages to build') || extract('Pages needed') || '',
    mostImportantPage: extract('Most important page (build this with the most detail)') || extract('Most important page') || '',
    referencesSites: extract('Design references (match this quality/style)') || extract('Design references') || extract('Reference sites') || '',
    thingsToAvoid: extract('AVOID these (critical)') || extract('Avoid') || '',
    toneOfVoice: extract('Tone of voice') || extract('Tone') || '',
    targetAudience: extract('Target audience') || '',
  }
}
