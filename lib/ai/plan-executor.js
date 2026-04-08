// ── Plan Executor ──
import { buildProjectGroundingBlock } from './service.js'
// Extracted from service.js for modularity. Called via .call(this) from AIService.
import { formatContextAsSystemMessage, classifyScope } from './context.js'
import { AI_TOOLS, detectToolMode } from './tools.js'
import { classifyIntent, getIntentWorkflow, resolveTaskMode, detectTaskMode, isRefinementRequest, findMainPagePath } from './intents.js'
import { buildFilesystemContext, formatFilesystemContextBlock, invalidateCache, validateFileOperations } from './filesystem.js'
import { formatDesignContextBlock } from './design-system.js'
import { ProviderError } from './errors.js'
import { loadFileContext, buildGroundedPromptBlock, extractTargetPaths } from './file-context-loader.js'
import { validatePlan, hashPlan, validatePatchGrounding, validateTaskMode } from './plan-validator.js'
import { logPlanEvent } from './changelog.js'
import { inspectToolCalls, detectFileType, tryParseFilesFromResponse, formatPlanResponse, formatDiffSummary } from './tool-executor.js'
import { classifyStreamError } from './stream-helpers.js'
import { buildFilesSummaryText, buildErrorLogData } from './post-process.js'
import { buildProjectManagerPrompt, buildRefinementPrompt, buildNewPagePrompt } from './prompt-builder.js'
import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'


export async function* executePlanStreamImpl({ projectId, chatId, userMessage, userId, scope, designPrefs, planData, runId, startTime, selfEditTarget }) {
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

Execute ALL file actions listed above. Use create_files for new files, update_files for modifications, and delete_files for removals. Generate complete, production-ready code.

CRITICAL: Each file's "content" field MUST contain the COMPLETE, VALID, RUNNABLE source code. Do NOT write descriptions, comments, or summaries like "// Main app component" — write the actual implementation with real imports, functions, JSX, and styles.`

      const messages = [
        { role: 'system', content: systemMessage },
        ...((context.chat?.messages || []).slice(-3).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 500) : '' }))),
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
      for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, AI_TOOLS, { temperature: 0.7, max_tokens: 16384 }))) {
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
              // ── Content Quality Guard: reject files that are descriptions, not code ──
              const filesArr = args.files || []
              const badFiles = filesArr.filter(f => {
                if (!f.content || !f.path) return true
                const c = f.content.trim()
                if (f.path.endsWith('.css') || f.path.endsWith('.json') || f.path.endsWith('.md')) return false
                return c.length < 80 || !(
                  c.includes('{') || c.includes('<') || c.includes('function') ||
                  c.includes('import ') || c.includes('export ') || c.includes('const ') ||
                  c.includes('class ') || c.includes('return') || c.includes('=>')
                )
              })
              if (badFiles.length > 0) {
                console.warn('[PlanExecutor-ContentGuard] Detected', badFiles.length, 'file(s) with descriptions instead of code:', badFiles.map(f => f.path).join(', '))
                // Skip this tool call — will be retried below
                continue
              }

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
        // ── Retry if Content Guard rejected description-only files ──
        console.log('[PlanExecutor] No valid diffs produced. Retrying with stronger prompt...')
        yield { event: 'status', data: { stage: 'retrying', detail: 'Regenerating with complete code...' } }

        messages.push({ role: 'assistant', content: fullContent || '(incomplete)' })
        messages.push({ role: 'user', content: 'CRITICAL: Your previous response contained file descriptions or comments instead of actual source code. Each file MUST contain COMPLETE, VALID, RUNNABLE source code — not a comment like "// Main app component" or a description. Write the full implementation now with real JSX, HTML, CSS, etc.' })

        fullContent = ''
        toolCalls = []
        for await (const chunk of this._streamWithFallback(() => this.provider.chatWithToolsStream(messages, AI_TOOLS, { temperature: 0.7, max_tokens: 16384 }))) {
          if (chunk.type === 'token') {
            fullContent += chunk.content
            yield { event: 'token', data: { content: chunk.content } }
          } else if (chunk.type === 'tool_calls') {
            toolCalls = chunk.tool_calls
          }
        }

        // Process retry tool calls
        for (const toolCall of toolCalls) {
          try {
            const retryArgs = JSON.parse(toolCall.function.arguments)
            const retryToolName = toolCall.function.name
            if (retryToolName === 'create_files' || retryToolName === 'update_files') {
              const { buildPendingDiffs } = await import('@/lib/self_builder/file_ops_bridge')
              const pendingDiffs = buildPendingDiffs(retryArgs.files, {
                planFileActions: planData?.file_actions,
                findExisting,
                toolName: retryToolName,
                detectFileType: (p) => detectFileType(p),
              })
              for (const d of pendingDiffs) {
                diffFiles.push(d)
                yield { event: 'diff_file', data: d }
              }
            }
          } catch (retryErr) {
            console.error('[PlanExecutor] Retry tool call parse error:', retryErr.message)
          }
        }
      }

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


export async function applyDiffsImpl(projectId, chatId, userId, approvedFiles, planData) {
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

