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

_defaultModel(provider) {
  const defaults = {
    openai: process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini',
    anthropic: process.env.ANTHROPIC_MODEL_CHAT || 'claude-sonnet-4-6',
  }
  return defaults[provider] || 'gpt-4o-mini'
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
    try {
      for await (const chunk of makeStream()) {
        yield chunk
      }
      this._rateLimitCount = 0
    } catch (err) {
      const isRateLimit =
        err?.status === 429 ||
        err?.error_type === 'rate_limit' ||
        /rate[- ]?limit/i.test(String(err?.message || '')) ||
        /temporarily/i.test(String(err?.message || ''))

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
          pendingDiffMessage = chatMessages.reverse().find(m =>
            m.metadata?.diffStatus === 'pending' && m.metadata?.diffFiles?.length > 0
          )
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

        const content = `## Diffs Applied\n\n- **Written:** ${results.written.length} file(s)\n- **Deleted:** ${results.deleted.length} file(s)${results.errors.length > 0 ? `\n- **Errors:** ${results.errors.join(', ')}` : ''}${results.rolledBack ? '\n- **⚠ Rolled back** — all changes reverted' : ''}`
        yield { event: 'token', data: { content } }
        yield { event: 'done', data: { content, toolMode: 'apply_pending_diff', scope: requestedScope || 'project', runId, provider: this.providerName, model: this.modelName, appliedFiles: results.written, deletedFiles: results.deleted, rolledBack: results.rolledBack || false, planData: planData || null } }
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
            yield { event: 'done', data: { content, toolMode: 'discard_pending_diff', scope: requestedScope || 'project', runId, provider: this.providerName, model: this.modelName, error: discardResult.error } }
            return
          }
          try {
            await db.messages.update(pendingDiffMessage.id, {
              metadata: { ...pendingDiffMessage.metadata, diffStatus: 'discarded' }
            })
          } catch {}
        }

        const discardedPaths = (pendingDiffMessage.metadata.diffFiles || []).map(d => d.path)
        const content = `## Diffs Discarded\n\n${discardedPaths.map(p => '- `' + p + '`').join('\n')}\n\nNo files were changed.`
        yield { event: 'token', data: { content } }
        yield { event: 'done', data: { content, toolMode: 'discard_pending_diff', scope: requestedScope || 'project', runId, provider: this.providerName, model: this.modelName } }
        return
      }

      // ── internal_api_exec bypass ──
      if (requestMode === 'internal_api_exec') {
        yield { event: 'status', data: { stage: 'internal_api_exec', detail: 'Executing internal API call...' } }

        // Allowed routes whitelist
        const ALLOWED = [
          { method: 'GET',    pattern: /^\/api\/projects\/[^/]+\/memory$/ },
          { method: 'POST',   pattern: /^\/api\/projects\/[^/]+\/memory$/ },
          { method: 'DELETE', pattern: /^\/api\/projects\/[^/]+\/memory\/[^/]+$/ },
          { method: 'POST',   pattern: /^\/api\/projects\/[^/]+\/sync-repo$/ },
        ]

        // Parse API call from message
        const methodMatch = userMessage.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s]+)/i)
        const bodyMatch = userMessage.match(/body:\s*(\{[\s\S]*?\})/i) || userMessage.match(/```json\s*([\s\S]*?)```/)

        if (!methodMatch) {
          const content = '## Internal API Execution Error\n\nCould not parse API call. Expected format:\n```\nGET /api/projects/{projectId}/memory\n```'
          yield { event: 'token', data: { content } }
          yield { event: 'done', data: { content, toolMode: 'internal_api_exec', scope: requestedScope || 'project', runId, provider: this.providerName, model: this.modelName } }
          return
        }

        const method = methodMatch[1].toUpperCase()
        let apiPath = methodMatch[2].replace(/\{projectId\}/g, projectId)
        let body = null
        if (bodyMatch) {
          try { body = JSON.parse(bodyMatch[1]) } catch {}
        }

        // Whitelist check
        const allowed = ALLOWED.some(r => r.method === method && r.pattern.test(apiPath))
        if (!allowed) {
          const content = `## Internal API Execution Denied\n\nRoute not allowed: \`${method} ${apiPath}\`\n\nAllowed routes:\n- GET /api/projects/{projectId}/memory\n- POST /api/projects/{projectId}/memory\n- DELETE /api/projects/{projectId}/memory/{id}\n- POST /api/projects/{projectId}/sync-repo`
          yield { event: 'token', data: { content } }
          yield { event: 'done', data: { content, toolMode: 'internal_api_exec', scope: requestedScope || 'project', runId, provider: this.providerName, model: this.modelName } }
          return
        }

        // Execute against real backend
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
        const fetchOpts = {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userId}` },
        }
        // Pass through the original auth by using the supabase service role internally
        const { getSupabaseAdmin } = await import('@/lib/supabase/db.js')

        // Execute via db layer directly instead of HTTP to avoid auth complexity
        let status = 200
        let responseBody = null
        try {
          if (method === 'GET' && apiPath.match(/\/memory$/)) {
            responseBody = await db.projectMemory.findByProjectId(projectId)
          } else if (method === 'POST' && apiPath.match(/\/memory$/)) {
            if (!body?.key) {
              status = 400
              responseBody = { error: 'Missing key' }
            } else {
              responseBody = await db.projectMemory.create({ project_id: projectId, key: body.key, value: body.value || '' })
              status = 201
            }
          } else if (method === 'DELETE' && apiPath.match(/\/memory\/[^/]+$/)) {
            const memoryId = apiPath.split('/').pop()
            await db.projectMemory.deleteById(memoryId)
            responseBody = { success: true }
          } else if (method === 'POST' && apiPath.match(/\/sync-repo$/)) {
            const fs = await import('fs/promises')
            const nodePath = await import('path')
            const BASE = process.cwd()
            const SYNC_DIRS = ['lib', 'app', 'components']
            const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.md'])
            const SKIP = new Set(['node_modules', '.next', '.git', '.emergent', 'dist', 'build'])
            async function walkDir(dir) {
              const entries = await fs.readdir(dir, { withFileTypes: true })
              const out = []
              for (const e of entries) {
                if (SKIP.has(e.name)) continue
                const full = nodePath.join(dir, e.name)
                if (e.isDirectory()) out.push(...await walkDir(full))
                else if (EXTENSIONS.has(nodePath.extname(e.name).toLowerCase())) out.push(full)
              }
              return out
            }
            let synced = 0
            for (const dir of SYNC_DIRS) {
              const absDir = nodePath.join(BASE, dir)
              try { await fs.access(absDir) } catch { continue }
              for (const absPath of await walkDir(absDir)) {
                const relPath = nodePath.relative(BASE, absPath)
                try {
                  const content = await fs.readFile(absPath, 'utf-8')
                  await db.projectFiles.upsert(projectId, relPath, content, nodePath.extname(absPath).replace('.', '') || 'text')
                  synced++
                } catch {}
              }
            }
            for (const name of ['package.json', 'next.config.mjs', 'tailwind.config.js', 'postcss.config.mjs', 'jsconfig.json']) {
              try {
                const content = await fs.readFile(nodePath.join(BASE, name), 'utf-8')
                await db.projectFiles.upsert(projectId, name, content, nodePath.extname(name).replace('.', '') || 'text')
                synced++
              } catch {}
            }
            responseBody = { success: true, synced }
          }
        } catch (err) {
          status = 500
          responseBody = { error: err.message }
        }

        const content = `## Internal API Execution\n\n**${method}** \`${apiPath}\`${body ? `\n**Body:** \`${JSON.stringify(body)}\`` : ''}\n\n**Status:** ${status}\n**Response:**\n\`\`\`json\n${JSON.stringify(responseBody, null, 2)}\n\`\`\``
        yield { event: 'token', data: { content } }
        yield { event: 'done', data: { content, toolMode: 'internal_api_exec', scope: requestedScope || 'project', runId, provider: this.providerName, model: this.modelName } }
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
        // Match full paths (dir/file.ext) and standalone filenames (file.ext)
        const pathMatches = userMessage.match(/(?:[\w./-]+\/[\w.-]+\.\w+)/g) || []
        const nameMatches = userMessage.match(/\b([\w.-]+\.(jsx?|tsx?|css|html|json|md|py|sql|yml|yaml|toml))\b/gi) || []
        const candidates = [...new Set([...pathMatches, ...nameMatches])]

        const allFiles = await db.projectFiles.findByProjectId(projectId)

        const fileMap = new Map(allFiles.map(f => [f.path, f]))
const baseMap = new Map(allFiles.map(f => [((f.path || '').split('/').pop() || '').toLowerCase(), f]))
const loadedPaths = new Set((fsContext?.relevantFiles || []).map(f => f.path))

          for (const raw of candidates) {
            const norm = raw.replace(/^\.?\/?(app\/)?/, '')
            const basename = norm.split('/').pop().toLowerCase()
            const file = fileMap.get(norm) || fileMap.get(raw) || baseMap.get(basename)
            if (file?.content) {
              requestedFileFound = true
              if (!loadedPaths.has(file.path)) {
                directReadFiles.push(file)
                loadedPaths.add(file.path)
              }
            }
          }

          // Fallback: if not in project DB, check actual filesystem (self-builder use case)
          if (!requestedFileFound) {
            const { readFileSync, existsSync } = await import('fs')
            const { resolve, extname } = await import('path')
            const { execSync } = await import('child_process')
            for (const raw of candidates) {
              // 1. Try full path directly under /app/
              const directPath = resolve('/app', raw)
              if (directPath.startsWith('/app/') && existsSync(directPath)) {
                try {
                  const content = readFileSync(directPath, 'utf-8')
                  directReadFiles.push({ path: raw, content, file_type: extname(directPath).slice(1) })
                  requestedFileFound = true
                  break
                } catch {}
              }
              // 2. Recursive find by exact basename
              const basename = raw.split('/').pop()
              if (!requestedFileFound && basename) {
                try {
                  const found = execSync(
                    `find /app -maxdepth 6 -name "${basename}" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.git/*" -type f 2>/dev/null | head -1`,
                    { encoding: 'utf-8', timeout: 3000 }
                  ).trim()
                  if (found && existsSync(found)) {
                    const content = readFileSync(found, 'utf-8')
                    const relPath = found.replace(/^\/app\//, '')
                    directReadFiles.push({ path: relPath, content, file_type: extname(found).slice(1) })
                    requestedFileFound = true
                    break
                  }
                } catch {}
              }
            }
          }

          console.log('[DirectFileRead]', JSON.stringify({
            candidates, matched: directReadFiles.map(f => f.path),
            already_loaded: [...loadedPaths].filter(p => !directReadFiles.find(f => f.path === p)),
            total_project_files: allFiles.length,
            requestedFileFound,
            usedFilesystemFallback: directReadFiles.some(f => f.path && !allFiles.find(a => a.path === f.path)),
          }))

          if (directReadFiles.length > 0) {
            let block = '\n\n## Inspected File Contents\n'
            for (const f of directReadFiles) {
              block += `\n### ${f.path}\n\`\`\`${f.file_type || ''}\n${f.content}\n\`\`\`\n`
            }
            systemMessage += block
          }
        }

      // ── Critical: Add read-only inspection directive ──
      if (requestMode === 'read_only_report' && projectId) {
        const requestedFilesLoaded = requestedFileFound || directReadFiles.length > 0
        const pathMatchesForRequestedFile = userMessage.match(/(?:[\w./-]+\/[\w.-]+\.\w+)/g) || []
        const nameMatchesForRequestedFile = userMessage.match(/\b([\w.-]+\.(jsx?|tsx?|css|html|json|md|py|sql|yml|yaml|toml))\b/gi) || []
        const candidatesForRequestedFile = [...new Set([...pathMatchesForRequestedFile, ...nameMatchesForRequestedFile])]
        const allFilesForRequestedFile = await db.projectFiles.findByProjectId(projectId)

        const fsContextHasRequestedFile =
          candidatesForRequestedFile.length > 0 &&
          (fsContext?.relevantFiles || []).some(f => {
            const fBase = ((f.path || '').split('/').pop() || '').toLowerCase()
            return candidatesForRequestedFile.some(c => {
              const cBase = c.split('/').pop().toLowerCase()
              return fBase === cBase || f.path === c || f.path.endsWith('/' + c)
            })
          })

        const hasRequestedFileContent = requestedFilesLoaded || fsContextHasRequestedFile

        if (hasRequestedFileContent) {
          systemMessage += `\n\n## READ-ONLY INSPECTION MODE — MANDATORY INSTRUCTIONS
You are in READ-ONLY FILE INSPECTION mode. The actual file contents have been loaded and provided above in this system message.

CRITICAL RULES:
1. You HAVE direct access to the file contents shown above. They are REAL, loaded from the project or filesystem.
2. You MUST present, analyze, and discuss the actual file contents shown above.
3. NEVER say "I'm unable to open files", "I cannot inspect files directly", "I do not have access", or any similar refusal. The files ARE loaded above.
4. Do NOT propose any code changes, plans, or file_actions. This is a READ-ONLY inspection.
5. Provide a thorough analysis: structure, key functions, exports, dependencies, patterns, and any issues you notice.`
        } else {
          const fileList = allFilesForRequestedFile.map(f => f.path).join(', ')
          const candidateList = candidatesForRequestedFile.join(', ')
          systemMessage += `\n\n## READ-ONLY INSPECTION MODE — FILE NOT FOUND
You are in READ-ONLY FILE INSPECTION mode. The user requested to inspect: ${candidateList}
However, this file was NOT found in the project database or the application filesystem.
${allFilesForRequestedFile.length > 0 ? `\nFiles available in this project: ${fileList}` : '\nThis project has no stored files yet.'}
\nTell the user clearly that "${candidateList}" was not found in this project. List the available files. Suggest they either switch to the correct project or upload the file first.
Do NOT propose any code changes, plans, or file_actions. This is a READ-ONLY inspection.
Do NOT fabricate or guess file contents.`
        }
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
        const REFUSAL_PATTERNS = /unable to (access|open|inspect|read)|cannot (inspect|open|access|read)|can't (access|open|inspect|read)|not able to (access|open|read)|do not have access|don't have (access|the ability)|I apologize.*(?:cannot|unable|can't)/i

        // 1. Strip assistant messages with refusal patterns from history
        const cleanHistory = (context.chat?.messages || []).filter(m => {
          if (m.role === 'assistant' && REFUSAL_PATTERNS.test(m.content || '')) return false
          return true
        }).slice(-4) // keep only last 4 clean messages for minimal context

        // 2. Build augmented user message with file content embedded directly
        let augmentedUserMsg = userMessage
        // Collect all file content that was loaded (from fsContext OR direct-read)
        const embeddedFiles = []
        const seenPaths = new Set()
        if (fsContext?.relevantFiles?.length > 0) {
          for (const f of fsContext.relevantFiles) {
            if (f.content && !seenPaths.has(f.path)) {
              embeddedFiles.push(f)
              seenPaths.add(f.path)
            }
          }
        }
        // Include files found by direct-read that weren't in fsContext
        for (const f of directReadFiles) {
          if (f.content && !seenPaths.has(f.path)) {
            embeddedFiles.push(f)
            seenPaths.add(f.path)
          }
        }
        if (embeddedFiles.length > 0) {
          augmentedUserMsg += '\n\n--- FILE CONTENTS (loaded from project database) ---'
          for (const f of embeddedFiles) {
            augmentedUserMsg += `\n\n### ${f.path}\n\`\`\`${f.file_type || ''}\n${f.content}\n\`\`\``
          }
          augmentedUserMsg += '\n\n--- END FILE CONTENTS ---\n\nAnalyze the file contents above. Do NOT say you cannot access files — the contents are provided above.'
        }

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
          const hasFileContent = toolCalls.some(tc => {
            try { return ['create_files', 'update_files'].includes(tc.function.name) } catch { return false }
          })
          const hasFileActions = toolCalls.some(tc => {
            try {
              if (tc.function.name !== 'propose_plan') return false
              const a = JSON.parse(tc.function.arguments)
              return a.file_actions?.length > 0
            } catch { return false }
          })
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

                  // HARD BLOCK — do not allow invalid plans through
                  continue
                }

                // Add warning if no grounded context was available
                if (!groundedFileContext) {
                  validationResult.warnings = validationResult.warnings || []
                  validationResult.warnings.push('No existing files loaded; validation ran without file existence checks')
                  validationResult.mode = 'empty_project'
                }

                // Self-critique: AI reviews its own plan before emission
                if (planAttempt < MAX_PLAN_RETRIES) {
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
                      continue
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
                  fullContent = this.formatProposedPlanResponse(args)
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
                  detectFileType: (p) => this.detectFileType(p),
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
                    fileType: existing?.file_type || this.detectFileType(file.path),
                  }
                  diffFiles.push(diffEntry)
                  yield { event: 'diff_file', data: diffEntry }
                }

                if (!fullContent) {
                  fullContent = `## ${args.plan || 'File Deletions'}\n\n**${diffFiles.filter(d => d.action === 'delete').length} file(s) to delete:**\n`
                  for (const df of diffFiles.filter(d => d.action === 'delete')) {
                    fullContent += `- \`-\` **${df.path}** — ${df.description}\n`
                  }
                  if (args.summary) fullContent += `\n**Summary:** ${args.summary}`
                  yield { event: 'token', data: { content: fullContent } }
                }
              } else if (toolName === 'plan_project') {
                planOutput = args
                if (!fullContent) {
                  fullContent = this.formatPlanResponse(args)
                  yield { event: 'token', data: { content: fullContent } }
                }
              } else if (toolName === 'summarize_project') {
                if (!fullContent) {
                  fullContent = this.formatSummaryResponse(args)
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
        const parsed = this.tryParseFilesFromResponse(fullContent)
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
              fileType: file.file_type || this.detectFileType(file.path),
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
                detectFileType: (p) => this.detectFileType(p),
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
                  fileType: existing?.file_type || this.detectFileType(file.path),
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
        const parsed = this.tryParseFilesFromResponse(fullContent)
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
              fileType: file.file_type || this.detectFileType(file.path),
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
    const applyResult = await safeApplyDiffs(projectId, approvedFiles, (p) => this.detectFileType(p), { chatId, userId })
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
                response = `## ${args.plan}\n\n`
                response += `**Files ${toolName === 'create_files' ? 'Created' : 'Updated'}:**\n`
                for (const file of savedFiles) {
                  response += `- \`${file.path}\` - ${file.description || 'Generated'}\n`
                }
                response += `\n**Summary:** ${args.summary}`
              }
            } else if (toolName === 'plan_project') {
              planOutput = args
              if (!response) response = this.formatPlanResponse(args)
            } else if (toolName === 'summarize_project') {
              if (!response) response = this.formatSummaryResponse(args)
            }
          } catch (toolErr) {
            console.error('[AIService] Tool call parse error:', toolErr.message)
          }
        }
      }

      // Try parsing files from response text if no tool calls
      if (generatedFiles.length === 0 && toolMode !== 'chat_only') {
        const parsed = this.tryParseFilesFromResponse(response)
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

      const isProviderError = error instanceof ProviderError
      const logData = {
        id: runId,
        project_id: projectId,
        chat_id: chatId,
        user_id: userId,
        tool_mode: 'error',
        scope: requestedScope || 'project',
        intent_type: classifyIntent(userMessage),
        files_generated: 0,
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
        provider: this.providerName,
        model: this.modelName,
      }

      if (isProviderError) {
        logData.error_type = error.error_type
        logData.provider_status_code = error.status_code
        logData.raw_error = error.raw_error
      }

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
    const compressedMessages = this.compressContext(messages)
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
    const compressedMessages = this.compressContext(messages)

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
    const compressedMessages = this.compressContext(messages)

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
  compressContext(messages) {
    if (!messages || messages.length <= 20) return messages || []

    // Keep the last 16 messages, summarize older ones
    const recent = messages.slice(-16)
    const older = messages.slice(0, -16)

    // Create a summary of older messages
    const summary = {
      role: 'system',
      content: `[Previous conversation summary: ${older.length} messages exchanged covering: ${
        older.filter(m => m.role === 'user').slice(0, 5).map(m => m.content.slice(0, 60)).join('; ')
      }]`,
      created_at: older[older.length - 1]?.created_at
    }

    return [summary, ...recent]
  }

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
            file_type: file.file_type || this.detectFileType(file.path),
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

    // Auto-create canvas if missing
    if (!canvasDoc) {
      canvasDoc = await db.projectCanvas.create({
        project_id: projectId,
        canvas_content: {
          project_overview: '', project_goals: [], key_decisions: [],
          architecture_notes: [], master_prompts: [], working_prompts: [],
          failed_prompts: [], successful_patterns: [], feature_requirements: [],
          technical_specs: [], constraints: [], open_tasks: [], completed_tasks: []
        }
      })
    }

    const canvas = { ...(canvasDoc.canvas_content || {}) }
    let changed = false

    // Extract insights from the exchange
    const insights = this.extractInsights(userMessage, response, files, plan)

    if (insights.goal) {
      canvas.project_goals = canvas.project_goals || []
      const exists = canvas.project_goals.some(g =>
        (g.text || g).toLowerCase().includes(insights.goal.toLowerCase().slice(0, 50))
      )
      if (!exists) {
        canvas.project_goals.push({
          id: uuidv4(), text: insights.goal,
          status: 'active', confidence: 'provisional',
          created_at: new Date().toISOString()
        })
        changed = true
      }
    }

    if (insights.decision) {
      canvas.key_decisions = canvas.key_decisions || []
      canvas.key_decisions.push({
        id: uuidv4(), text: insights.decision,
        status: 'active', confidence: 'provisional',
        created_at: new Date().toISOString()
      })
      changed = true
    }

    if (insights.architecture) {
      canvas.architecture_notes = canvas.architecture_notes || []
      canvas.architecture_notes.push({
        id: uuidv4(), text: insights.architecture,
        status: 'active', confidence: 'provisional',
        created_at: new Date().toISOString()
      })
      changed = true
    }

    if (insights.completedTask) {
      canvas.completed_tasks = canvas.completed_tasks || []
      canvas.completed_tasks.push({
        id: uuidv4(), text: insights.completedTask,
        status: 'finalized', confidence: 'confirmed',
        created_at: new Date().toISOString()
      })
      changed = true
    }

    if (insights.specs?.length) {
      canvas.technical_specs = canvas.technical_specs || []
      for (const spec of insights.specs) {
        canvas.technical_specs.push({
          id: uuidv4(), text: spec,
          status: 'active', confidence: 'provisional',
          created_at: new Date().toISOString()
        })
      }
      changed = true
    }

    // Always record successful prompt patterns when files are generated
    if (files.length > 0) {
      canvas.successful_patterns = canvas.successful_patterns || []
      canvas.successful_patterns.push({
        id: uuidv4(),
        text: `[${this.providerName}/${this.modelName}] "${userMessage.slice(0, 150)}${userMessage.length > 150 ? '...' : ''}"`,
        status: 'active', confidence: 'confirmed',
        created_at: new Date().toISOString()
      })
      changed = true
    }

    // Always update the project overview from the exchange summary
    if (!canvas.project_overview && insights.overviewHint) {
      canvas.project_overview = insights.overviewHint
      changed = true
    }

    // Save updated canvas
    if (changed) {
      await db.projectCanvas.update(projectId, canvas)

      // Create canvas event
      await db.canvasEvents.create({
        project_id: projectId,
        change_summary: `Auto-updated: ${[
          insights.goal ? 'goal' : '',
          insights.decision ? 'decision' : '',
          insights.completedTask ? 'task' : '',
          files.length ? `${files.length} files` : ''
        ].filter(Boolean).join(', ')}`
      })

      // VERIFICATION: confirm canvas was written
      const verify = await db.projectCanvas.findByProjectId(projectId)
      if (!verify || !verify.canvas_content) {
        console.error('[AIService] CANVAS VERIFICATION FAILED: Canvas not found after update')
        return false
      }
    }

    return changed
  }

  extractInsights(userMessage, response, files, plan) {
    const insights = {}
    const lowerUser = userMessage.toLowerCase()
    const lowerResponse = (response || '').toLowerCase()

    // Detect goals
    if (lowerUser.includes('i want') || lowerUser.includes('i need') ||
        lowerUser.includes('build me') || lowerUser.includes('create') ||
        lowerUser.includes('make')) {
      insights.goal = userMessage.slice(0, 200)
    }

    // Detect decisions from AI response
    const decisionPatterns = [
      /(?:I'll use|we'll use|using|I chose|implemented with)\s+([^.]{10,80})/i,
      /(?:stack|framework|library):\s*([^.\n]{10,80})/i,
    ]
    for (const pattern of decisionPatterns) {
      const match = response?.match(pattern)
      if (match) {
        insights.decision = match[0].slice(0, 200)
        break
      }
    }

    // Detect architecture from plan or response
    if (plan?.architecture) {
      insights.architecture = plan.architecture.slice(0, 300)
    }

    // Detect technical specs
    const specPatterns = [
      /(?:tech stack|technologies|dependencies):\s*([^\n]{10,200})/i,
      /(?:built with|powered by)\s+([^.]{10,100})/i,
    ]
    const specs = []
    for (const pattern of specPatterns) {
      const match = response?.match(pattern)
      if (match) specs.push(match[0].slice(0, 200))
    }
    if (specs.length) insights.specs = specs

    // Detect completed tasks
    if (files.length > 0) {
      insights.completedTask = `Generated ${files.length} file(s): ${files.map(f => f.path).join(', ')}`
    }

    // Overview hint
    if (lowerUser.length > 20 && !lowerUser.startsWith('hello') && !lowerUser.startsWith('hi ')) {
      insights.overviewHint = userMessage.slice(0, 300)
    }

    return insights
  }

  async indexForSearch(projectId, chatId, userMessage, response, files) {
    const entries = []
    if (response) {
      entries.push({
        project_id: projectId, content_type: 'message',
        content_text: response.slice(0, 1000), source_id: chatId
      })
    }
    for (const file of files) {
      entries.push({
        project_id: projectId, content_type: 'file',
        content_text: `${file.path}: ${file.description || ''} ${(file.content || '').slice(0, 500)}`,
        source_id: file.id
      })
    }
    if (entries.length > 0) {
      await db.searchIndex.bulkInsert(entries)
    }
  }

  async logGenerationRun(data) {
    try {
      // Only send columns that exist in the generation_runs table
      const safeData = {
        id: data.id,
        project_id: data.project_id,
        chat_id: data.chat_id,
        user_id: data.user_id,
        tool_mode: data.tool_mode,
        files_generated: data.files_generated,
        duration: data.duration,
        success: data.success,
        error: data.error || null,
        provider: data.provider,
        model: data.model,
      }
      await db.generationRuns.create(safeData)
    } catch (error) {
      console.error('[AIService] Failed to log run:', error.message)
    }
  }

  tryParseFilesFromResponse(response) {
    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)```/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1])
        if (parsed.files) return parsed
      }
      const parsed = JSON.parse(response)
      if (parsed.files) return parsed
    } catch { /* not JSON */ }
    return { files: [] }
  }

  detectFileType(path) {
    const ext = path.split('.').pop()?.toLowerCase()
    const typeMap = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      html: 'html', css: 'css', scss: 'css', json: 'json', md: 'markdown',
      py: 'python', sql: 'sql', svg: 'svg', png: 'image'
    }
    return typeMap[ext] || 'text'
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
        spriteOpts = this.parseSpriteOpts(userMessage)
      } else if (userMessage.match(/icon/i)) {
        mode = 'icon'
        spriteOpts = this.parseIconOpts(userMessage)
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

  parseSpriteOpts(message) {
    const name = message.match(/(?:character|sprite)\s+(?:named?\s+)?["']?(\w+)["']?/i)?.[1] || 'Character'
    const statesMatch = message.match(/states?[:\s]+([^.]+)/i)
    const states = statesMatch ? statesMatch[1].split(/[,;]+/).map(s => s.trim()).filter(Boolean) : ['idle', 'walk', 'jump', 'attack']
    const frameCount = parseInt(message.match(/(\d+)\s*frames?/i)?.[1]) || 4
    const style = message.match(/style[:\s]+([^.]+)/i)?.[1]?.trim() || 'pixel art, 16-bit, clean outlines'
    return { name, states, frameCount, style }
  }

  parseIconOpts(message) {
    const itemsMatch = message.match(/icons?\s+(?:for\s+)?([^.]+)/i)
    const items = itemsMatch ? itemsMatch[1].split(/[,;]+/).map(s => s.trim()).filter(Boolean) : undefined
    const count = parseInt(message.match(/(\d+)\s*icons?/i)?.[1]) || items?.length || 6
    const style = message.match(/style[:\s]+([^.]+)/i)?.[1]?.trim()
    return { items, count, style }
  }


  formatPlanResponse(plan) {
    let r = `## Implementation Plan\n\n### Overview\n${plan.overview}\n\n### Architecture\n${plan.architecture}\n\n`
    if (plan.file_structure?.length) {
      r += `### File Structure\n\`\`\`\n${plan.file_structure.join('\n')}\n\`\`\`\n\n`
    }
    if (plan.phases?.length) {
      r += `### Implementation Phases\n`
      plan.phases.forEach((phase, i) => {
        r += `\n**Phase ${i + 1}: ${phase.name}**\n${phase.description}\n`
        phase.tasks?.forEach(task => { r += `- ${task}\n` })
      })
    }
    if (plan.considerations?.length) {
      r += `\n### Considerations\n`
      plan.considerations.forEach(c => { r += `- ${c}\n` })
    }
    return r
  }

  formatProposedPlanResponse(plan) {
    let r = `## Proposed Plan\n\n${plan.summary}\n\n`
    if (plan.file_actions?.length) {
      r += `### File Actions\n`
      for (const action of plan.file_actions) {
        const icon = action.action === 'create' ? '+' : action.action === 'update' ? '~' : '-'
        r += `- \`${icon}\` **${action.path}** — ${action.reason || action.description || action.action}\n`
        if (action.grounded_on?.length) {
          r += `  *Grounded on: ${action.grounded_on.slice(0, 2).join(', ')}*\n`
        }
      }
      r += '\n'
    }
    if (Array.isArray(plan.reasoning) && plan.reasoning.length > 0) {
      r += `### Reasoning\n`
      for (const step of plan.reasoning) { r += `- ${step}\n` }
      r += '\n'
    } else if (plan.reasoning) {
      r += `### Reasoning\n${plan.reasoning}\n\n`
    }
    if (plan.constraints_checked) {
      const cc = plan.constraints_checked
      const checks = [
        cc.has_file_actions ? '✓ has file actions' : '✗ missing file actions',
        cc.no_illegal_create ? '✓ no illegal creates' : '✗ illegal creates found',
        cc.minimal_patch ? '✓ minimal patch' : '⚠ broad changes',
        cc.grounded_in_file_context ? '✓ grounded in file context' : '✗ NOT grounded',
      ]
      r += `### Grounding Checks\n${checks.join(' · ')}\n\n`
    }
    if (plan.design_preset) {
      r += `*Design preset: ${plan.design_preset}*\n\n`
    }
    r += `*Awaiting your approval — click Execute to proceed, Revise to modify, or Cancel to abort.*`
    return r
  }

  formatSummaryResponse(summary) {
    let r = `## Project Summary\n\n${summary.summary}\n\n`
    if (summary.completed?.length) {
      r += `### Completed\n`
      summary.completed.forEach(item => { r += `- ${item}\n` })
    }
    if (summary.in_progress?.length) {
      r += `\n### In Progress\n`
      summary.in_progress.forEach(item => { r += `- ${item}\n` })
    }
    if (summary.next_steps?.length) {
      r += `\n### Next Steps\n`
      summary.next_steps.forEach(item => { r += `- ${item}\n` })
    }
    return r
  }
}
