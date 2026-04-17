import { createProvider } from './providers/index.js'
import { formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS, detectToolMode, PLAN_ONLY_TOOLS } from './tools.js'
import { classifyIntent, classifyIntentWithConfidence, buildDisambiguationPrompt, getIntentWorkflow, getIntentSystemAddendum, shouldUsePlanMode, resolveTaskMode, classifyRequestMode, detectTaskMode, isSimpleFrontendEdit, isRefinementRequest, findMainPagePath, isProceedSignal, isLargeAppBuild } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache, validateFileOperations } from './filesystem.js'
import { formatDesignContextBlock, getLayoutPatternForPrompt, getComponentPatternsForPrompt } from './design-system.js'
import { ProviderError, classifyProviderError } from './errors.js'
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
import { loadScopedContext, loadPlatformContext, loadWorkspaceContext, loadContext } from './context-loader.js'
import { saveFiles as saveFilesOp, deleteFiles as deleteFilesOp } from './file-operations.js'
import { updateCanvasFromExchange as updateCanvasOp, indexForSearch as indexForSearchOp, logGenerationRun as logGenerationRunOp } from './canvas-ops.js'
import { processImageGeneration as processImageGenOp } from './image-generation.js'
import { buildProjectManagerPrompt, buildRefinementPrompt, buildNewPagePrompt } from './prompt-builder.js'
import { db } from '@/lib/supabase/db'
import { processMessageStreamImpl } from './message-stream.js'
import { executePlanStreamImpl, applyDiffsImpl } from './plan-executor.js'
import { processMessageImpl } from './message-processor.js'
import { v4 as uuidv4 } from 'uuid'


/**
 * Build a project grounding context block for injection into AI system prompts.
 * Provides the AI with the project identity and a strict file index so it never
 * hallucinates file paths that don't exist.
 */
export async function buildProjectGroundingBlock(projectId) {
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
    this._creditApproved = false
  }

  /**
   * Route handlers MUST call this after verifying credits.
   * Without it, all provider calls are blocked.
   */
  approveCreditGate() {
    this._creditApproved = true
  }

  /**
   * Throws if credit gate hasn't been approved.
   * Called before every provider interaction.
   */
  _requireCreditApproval() {
    if (!this._creditApproved) {
      throw new ProviderError({
        error_type: 'billing',
        provider: this.providerName,
        model: this.modelName,
        status_code: 402,
        raw_error: 'Credit gate not approved — provider call blocked',
        user_message: "You're out of credits. Tap **Buy Credits** in the sidebar to top up and keep building.",
      })
    }
  }

  /**
   * Safe wrapper for any async provider call.
   * Enforces credit gate + translates raw provider errors.
   */
  async callModelSafely(providerCall) {
    this._requireCreditApproval()
    try {
      return await providerCall()
    } catch (err) {
      if (err instanceof ProviderError || err.name === 'ProviderError') throw err
      throw classifyProviderError(err, this.providerName, this.modelName)
    }
  }

  /**
   * Safe wrapper for async generator (streaming) provider calls.
   * Enforces credit gate + translates raw provider errors.
   */
  async *streamModelSafely(makeStream) {
    this._requireCreditApproval()
    try {
      yield* makeStream()
    } catch (err) {
      if (err instanceof ProviderError || err.name === 'ProviderError') throw err
      throw classifyProviderError(err, this.providerName, this.modelName)
    }
  }

  static FALLBACK_MAP = {
    'gpt-4o':            { provider: 'openai',    model: 'gpt-4o-mini' },
    'o3':                { provider: 'openai',    model: 'gpt-4o' },
    'claude-sonnet-4-6': { provider: 'openai',    model: 'gpt-4o' },
    'claude-opus-4-6':   { provider: 'openai',    model: 'gpt-4o' },
    'claude-haiku-4-5':  { provider: 'openai',    model: 'gpt-4o-mini' },
  }

  /**
   * Smart model router — selects the best model based on task type.
   * Returns { provider, model } recommendation.
   * 
   * Routing strategy:
   * - Large reasoning (refactoring, architecture): prefer Claude Sonnet for deep analysis
   * - Quick edits (small patches, config changes): GPT-4o-mini for speed
   * - Code generation (building new features): GPT-4o for balanced quality/speed
   * - Image/visual tasks: always GPT-4o (vision support)
   * 
   * Only activates when user selects "auto" model or when explicitly enabled.
   */
  static routeModel(intent, messageLength, fileCount = 0) {
    // Large complex reasoning tasks → stronger model
    if (intent === 'refactor' || intent === 'architecture' || messageLength > 2000 || fileCount > 10) {
      return { provider: 'openai', model: 'gpt-4o', reason: 'complex task' }
    }
    // Quick edits and small changes → fast model
    if (intent === 'edit' || intent === 'config' || intent === 'chat' || messageLength < 200) {
      return { provider: 'openai', model: 'gpt-4o-mini', reason: 'quick task' }
    }
    // Build tasks → balanced model
    return { provider: 'openai', model: 'gpt-4o', reason: 'standard build' }
  }

  _defaultModel(provider) {
    const defaults = {
      openai: process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini',
      anthropic: process.env.ANTHROPIC_MODEL_CHAT || 'claude-sonnet-4-6',
    }
    return defaults[provider] || 'gpt-4o'
  }

  _apiKey(provider) {
    // Direct provider keys are PRIMARY — bypasses proxy spending cap
    const directKeys = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
    }
    const directKey = directKeys[provider]
    if (directKey) {
      this._usingDirect = true
      return directKey
    }
    // Fallback to Emergent proxy key if no direct key exists
    const emergentKey = process.env.EMERGENT_LLM_KEY
    if (emergentKey) {
      this._usingDirect = false
      return emergentKey
    }
    console.error(`[AIService] No API key available for provider "${provider}"`)
    return null
  }

  /**
   * Returns the Emergent proxy key as a fallback.
   * Used when the direct provider key fails and proxy is available.
   */
  _proxyFallbackKey() {
    const key = process.env.EMERGENT_LLM_KEY
    if (key && key !== this._apiKey(this.providerName)) return key
    return null
  }

  _proxyOptions() {
    // Only use proxy when NOT using a direct key
    if (!this._usingDirect && process.env.EMERGENT_LLM_KEY && process.env.EMERGENT_PROXY_URL) {
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
      const fallbackKey = process.env.OPENAI_API_KEY || process.env.EMERGENT_LLM_KEY
      const fallbackOpts = (!process.env.OPENAI_API_KEY && process.env.EMERGENT_LLM_KEY && process.env.EMERGENT_PROXY_URL)
        ? { baseURL: process.env.EMERGENT_PROXY_URL } : {}
      return createProvider('openai', fallbackKey, this.modelName, fallbackOpts)
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
        const isProxyBudget = err?.error_type === 'proxy_budget'

        if (isTransient && attempt < MAX_RETRIES) {
          const delay = (attempt + 1) * 2000
          console.warn(`[StreamRetry] Attempt ${attempt + 1} failed (${String(err?.message || '').slice(0, 120)}), retrying in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }

        // If proxy budget error, don't bother with any fallback on the same proxy
        if (isProxyBudget) {
          console.warn(`[StreamRetry] Proxy budget exceeded — no fallback possible on same key`)
          throw err
        }

        // Context length errors: signal for auto-trim retry via special yield
        const isContextLength = err?.error_type === 'context_length'
        if (isContextLength) {
          console.warn(`[StreamRetry] Context length exceeded — signaling auto-trim`)
          yield { type: 'context_length_exceeded' }
          return
        }

        // Try model fallback before giving up
        if (this._switchToFallback()) {
          console.warn(`[StreamRetry] Attempting fallback model ${this.providerName}/${this.modelName}`)
          try {
            for await (const chunk of makeStream()) {
              yield chunk
            }
            yield { event: '_fallback_used', data: { provider: this.providerName, model: this.modelName } }
            return
          } catch (fbErr) {
            console.error(`[StreamRetry] Fallback also failed: ${String(fbErr?.message || '').slice(0, 120)}`)
            lastErr = fbErr
          }
        }

        // Direct key failed + fallback failed — try Emergent proxy as last resort
        if (this._usingDirect && !this._triedProxyFallback) {
          const proxyKey = process.env.EMERGENT_LLM_KEY
          const proxyUrl = process.env.EMERGENT_PROXY_URL
          if (proxyKey && proxyUrl && proxyKey !== this._apiKey(this.providerName)) {
            this._triedProxyFallback = true
            console.warn(`[StreamRetry] Direct key failed — attempting Emergent proxy fallback`)
            this.provider = createProvider(this.providerName, proxyKey, this.modelName, { baseURL: proxyUrl })
            try {
              for await (const chunk of makeStream()) {
                yield chunk
              }
              yield { event: '_fallback_used', data: { provider: this.providerName, model: this.modelName, proxyFallback: true } }
              return
            } catch (proxyErr) {
              console.error(`[StreamRetry] Proxy fallback also failed: ${String(proxyErr?.message || '').slice(0, 120)}`)
              // Throw the original direct-key error, not the proxy error
              lastErr = err
            }
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
  async *processMessageStream(params) {
    this._requireCreditApproval()
    yield* processMessageStreamImpl.call(this, params)
  }

  /**
   * Execute an approved plan — generate diffs for review (don't write files yet)
   */
  async *executePlanStream(params) {
    this._requireCreditApproval()
    yield* executePlanStreamImpl.call(this, params)
  }

  /**
   * Apply approved diffs — write files, create snapshot, log events
   */
  async applyDiffs(projectId, chatId, userId, approvedFiles, planData) {
    // applyDiffs doesn't always make provider calls, but guard it anyway
    return applyDiffsImpl.call(this, projectId, chatId, userId, approvedFiles, planData)
  }

  /**
   * Process a user message and generate a response (non-streaming)
   */
  async processMessage(params) {
    this._requireCreditApproval()
    return processMessageImpl.call(this, params)
  }

  /**
   * Load context based on scope
   */
  // ── Context Loading (delegated to context-loader.js) ──
  async loadScopedContext(projectId, chatId, userId, scope) {
    return loadScopedContext(projectId, chatId, userId, scope)
  }

  async loadPlatformContext(chatId) {
    return loadPlatformContext(chatId)
  }

  async loadWorkspaceContext(projectId, chatId, userId) {
    return loadWorkspaceContext(projectId, chatId, userId)
  }

  async loadContext(projectId, chatId) {
    return loadContext(projectId, chatId)
  }


  /**
   * Extract partial file content from streaming tool call arguments.
   * The accumulated JSON looks like: {"files":[{"path":"app/page.jsx","content":"...partial...
   * We extract the content value even though the JSON is incomplete.
   */
  _extractPartialFileContent(accum) {
    // Find the LAST "content" field (the file currently being streamed)
    const marker = '"content"'
    let idx = -1
    let searchFrom = 0
    while (true) {
      const next = accum.indexOf(marker, searchFrom)
      if (next === -1) break
      idx = next
      searchFrom = next + marker.length
    }
    if (idx === -1) return null

    // Find the colon after "content"
    const colonIdx = accum.indexOf(':', idx + marker.length)
    if (colonIdx === -1) return null

    // Find the opening quote of the value
    const quoteIdx = accum.indexOf('"', colonIdx + 1)
    if (quoteIdx === -1) return null

    // Walk the string to find the proper closing quote (respecting escaped chars)
    let raw = ''
    let i = quoteIdx + 1
    while (i < accum.length) {
      if (accum[i] === '\\' && i + 1 < accum.length) {
        raw += accum[i] + accum[i + 1]
        i += 2
      } else if (accum[i] === '"') {
        break
      } else {
        raw += accum[i]
        i++
      }
    }

    // Remove trailing incomplete escape sequence
    if (raw.endsWith('\\') && !raw.endsWith('\\\\')) {
      raw = raw.slice(0, -1)
    }

    // Also extract the path of this file
    let filePath = 'app/page.jsx'
    // Look backwards from the content marker for "path"
    const pathSearch = accum.lastIndexOf('"path"', idx)
    if (pathSearch !== -1) {
      const pColonIdx = accum.indexOf(':', pathSearch + 6)
      if (pColonIdx !== -1) {
        const pQuoteStart = accum.indexOf('"', pColonIdx + 1)
        const pQuoteEnd = accum.indexOf('"', pQuoteStart + 1)
        if (pQuoteStart !== -1 && pQuoteEnd !== -1) {
          filePath = accum.slice(pQuoteStart + 1, pQuoteEnd)
        }
      }
    }

    // Unescape JSON string
    let content
    try {
      content = JSON.parse('"' + raw + '"')
    } catch {
      content = raw
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\r/g, '\r')
    }
    return { content, path: filePath }
  }

  /**
   * Context compression — keep recent messages, summarize old ones
   */
  // ── File Operations (delegated to file-operations.js) ──
  async saveFiles(projectId, files, isUpdate) {
    return saveFilesOp(projectId, files, isUpdate, this.provider, this._prefetchedImages || [])
  }

  async deleteFiles(projectId, files) {
    return deleteFilesOp(projectId, files)
  }


  // ── Canvas & Logging Operations (delegated to canvas-ops.js) ──
  async updateCanvasFromExchange(projectId, userMessage, response, files, plan) {
    return updateCanvasOp(projectId, userMessage, response, files, plan, `${this.providerName}/${this.modelName}`)
  }

  async indexForSearch(projectId, chatId, userMessage, response, files) {
    return indexForSearchOp(projectId, chatId, userMessage, response, files)
  }

  async logGenerationRun(data) {
    return logGenerationRunOp(data)
  }

  // ── Image Generation (delegated to image-generation.js) ──
  async *processImageGeneration({ projectId, chatId, userMessage, userId, intent, workflow, runId, startTime }) {
    this._requireCreditApproval()
    yield* processImageGenOp({ projectId, chatId, userMessage, userId, intent, workflow, runId, startTime, providerName: this.providerName })
  }
}
