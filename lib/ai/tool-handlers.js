/**
 * Tool Handlers — extracted from message-stream.js for maintainability.
 * 
 * Each handler receives:
 *  - args: parsed tool arguments
 *  - toolCall: raw tool call object (for id)
 *  - ctx: mutable context object with all stream state
 *  - deps: imported dependencies (handleReadFiles, handleVerifyBuild, etc.)
 * 
 * Each handler returns:
 *  - { events: [...], loopContinue: bool, breakLoop: bool }
 *  - events are SSE events to yield back to the client
 */

import { handleReadFiles, handleVerifyBuild, handleExecCommand } from '../e2b/agent-tools.js'
import { saveMemoryEntries } from '../e2b/memory-service.js'
import { describeScreenshot, describeScreenshotLocal } from '../e2b/screenshot-service.js'
import { detectFileType, formatDeleteSummary, formatPlanResponse, formatSummaryResponse } from './tool-executor.js'
import { db } from '@/lib/supabase/db'

/**
 * Handle read_files tool — reads file contents and feeds them back into the agent loop
 */
export async function handleReadFilesTool(args, toolCall, ctx) {
  const paths = args.paths || []
  const events = [{ event: 'status', data: { stage: 'reading', detail: `Reading ${paths.length} file(s)...` } }]

  const toolResult = await handleReadFiles(args, { projectId: ctx.projectId, projectFiles: ctx.allProjectFiles, isSelfEdit: ctx.isSelfEdit })

  const readCallId = toolCall.id || ('read_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  // CRITICAL: Tool messages are INTERNAL to the agent loop — do NOT save to chat history
  // They contain raw file dumps (497 lines of code) that bloat the UI and waste tokens.
  // Only the AI needs to see them. The user sees the AI's final synthesis.
  ctx.messages.push({ role: 'assistant', content: ctx.fullContent || null, tool_calls: [{ id: readCallId, type: 'function', function: { name: 'read_files', arguments: toolCall.function.arguments } }] })
  ctx.messages.push({ role: 'tool', tool_call_id: readCallId, content: toolResult, _internal: true })

  // ── Pick the right follow-up directive based on the result ──
  // FILE NOT FOUND → force exec_command. Candidates → force precise retry.
  // Success → existing search_replace nudge. Extracted to /lib/ai/read-files-directive.js
  // so it is independently unit-testable.
  const { pickReadFilesDirective } = await import('./read-files-directive.js')
  const directive = pickReadFilesDirective(toolResult, ctx.agentLoopCount)
  if (directive) {
    ctx.messages.push({ role: 'user', content: directive })
  }

  ctx.fullContent = ''
  ctx.toolCalls = []
  ctx.toolOpts.tool_choice = 'auto'
  ctx.agentLoopCount = (ctx.agentLoopCount || 0) + 1

  if (ctx.agentLoopCount >= 4) {
    ctx.effectiveToolSet = ctx.effectiveToolSet.filter(t => t.function?.name !== 'read_files')
    console.log('[AgentLoop] Removed read_files from tool set after 2 reads')
  }

  return { events, loopContinue: ctx.agentLoopCount <= ctx.MAX_AGENT_LOOPS, breakLoop: true }
}

/**
 * Handle verify_build tool — checks compilation status
 */
export async function handleVerifyBuildTool(args, toolCall, ctx) {
  const events = [{ event: 'status', data: { stage: 'verifying', detail: 'Checking compilation...' } }]

  const verifyResult = await handleVerifyBuild(args, { projectId: ctx.projectId, projectFiles: ctx.allProjectFiles, isSelfEdit: ctx.isSelfEdit })

  const verifyCallId = toolCall.id || ('verify_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  ctx.messages.push({ role: 'assistant', content: ctx.fullContent || null, tool_calls: [{ id: verifyCallId, type: 'function', function: { name: 'verify_build', arguments: toolCall.function.arguments } }] })
  ctx.messages.push({ role: 'tool', tool_call_id: verifyCallId, content: verifyResult, _internal: true })

  ctx.fullContent = ''
  ctx.toolCalls = []
  ctx.toolOpts.tool_choice = 'auto'
  ctx.agentLoopCount = (ctx.agentLoopCount || 0) + 1

  return { events, loopContinue: ctx.agentLoopCount <= ctx.MAX_AGENT_LOOPS, breakLoop: true }
}

/**
 * Handle exec_command tool — runs shell commands
 */
export async function handleExecCommandTool(args, toolCall, ctx) {
  const events = [{ event: 'status', data: { stage: 'executing', detail: `Running: ${args.command?.slice(0, 50)}...` } }]

  const execResult = await handleExecCommand(args, { projectId: ctx.projectId })

  const execCallId = toolCall.id || ('exec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  ctx.messages.push({ role: 'assistant', content: ctx.fullContent || null, tool_calls: [{ id: execCallId, type: 'function', function: { name: 'exec_command', arguments: toolCall.function.arguments } }] })
  ctx.messages.push({ role: 'tool', tool_call_id: execCallId, content: execResult, _internal: true })

  ctx.fullContent = ''
  ctx.toolCalls = []
  ctx.toolOpts.tool_choice = 'auto'
  ctx.agentLoopCount = (ctx.agentLoopCount || 0) + 1

  return { events, loopContinue: ctx.agentLoopCount <= ctx.MAX_AGENT_LOOPS, breakLoop: true }
}

/**
 * Handle screenshot_verify tool — takes and describes a screenshot
 */
export async function handleScreenshotVerifyTool(args, toolCall, ctx) {
  const url = args.url || ''
  const expected = args.description || ''
  console.log(`[AgentLoop] screenshot_verify: ${url} (selfEdit: ${ctx.isSelfEdit})`)
  const events = [{ event: 'status', data: { stage: 'screenshotting', detail: `Taking screenshot of ${url.slice(0, 40)}...` } }]

  let screenshotResult
  try {
    if (ctx.isSelfEdit) {
      screenshotResult = await describeScreenshotLocal(url || 'http://localhost:3000')
    } else {
      screenshotResult = await describeScreenshot(ctx.projectId, url)
    }
  } catch (ssErr) {
    screenshotResult = `Screenshot failed: ${ssErr.message}`
  }

  if (expected) {
    screenshotResult += `\n\n**Expected**: ${expected}`
  }

  const ssCallId = toolCall.id || ('ss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  ctx.messages.push({ role: 'assistant', content: ctx.fullContent || null, tool_calls: [{ id: ssCallId, type: 'function', function: { name: 'screenshot_verify', arguments: toolCall.function.arguments } }] })
  ctx.messages.push({ role: 'tool', tool_call_id: ssCallId, content: screenshotResult, _internal: true })

  ctx.fullContent = ''
  ctx.toolCalls = []
  ctx.toolOpts.tool_choice = 'auto'
  ctx.agentLoopCount = (ctx.agentLoopCount || 0) + 1

  return { events, loopContinue: ctx.agentLoopCount <= ctx.MAX_AGENT_LOOPS, breakLoop: true }
}

/**
 * Handle update_memory tool — saves memory entries for cross-conversation context
 */
export async function handleUpdateMemoryTool(args, toolCall, ctx) {
  const entries = args.entries || []
  console.log(`[AgentLoop] update_memory: ${entries.length} entries`)
  const events = [{ event: 'status', data: { stage: 'saving_memory', detail: `Saving ${entries.length} memory entries...` } }]

  const saved = await saveMemoryEntries(ctx.projectId, entries)
  const memCallId = toolCall.id || ('mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
  const memResult = `Saved ${saved.length} memory entries: ${saved.map(s => `${s.key} (${s.action})`).join(', ')}. These will be available in future conversations.`

  ctx.messages.push({ role: 'assistant', content: ctx.fullContent || null, tool_calls: [{ id: memCallId, type: 'function', function: { name: 'update_memory', arguments: toolCall.function.arguments } }] })
  ctx.messages.push({ role: 'tool', tool_call_id: memCallId, content: memResult })

  ctx.fullContent = ''
  ctx.toolCalls = []
  ctx.toolOpts.tool_choice = 'auto'
  ctx.agentLoopCount = (ctx.agentLoopCount || 0) + 1

  return { events, loopContinue: ctx.agentLoopCount <= ctx.MAX_AGENT_LOOPS, breakLoop: true }
}

/**
 * Handle update_canvas tool — updates the project canvas/checklist
 */
export async function handleUpdateCanvasTool(args, ctx) {
  const events = []
  try {
    const canvasContent = args.canvas_content || ''
    const canvasSummary = args.summary || 'Canvas updated.'
    if (canvasContent && ctx.projectId) {
      await db.projectCanvas.update(ctx.projectId, canvasContent).catch(async () => {
        await db.projectCanvas.create({ project_id: ctx.projectId, canvas_content: canvasContent })
      })
      events.push({ event: 'canvas_update', data: { projectId: ctx.projectId, content: canvasContent } })
      console.log('[SelfEdit-Canvas] AI updated canvas via tool, summary:', canvasSummary)
      if (!ctx.fullContent) {
        ctx.fullContent = `Updated the canvas — ${canvasSummary}`
        events.push({ event: 'token', data: { content: ctx.fullContent } })
      }
    }
  } catch (canvasErr) {
    console.warn('[update_canvas] Error:', canvasErr.message)
  }
  return { events, loopContinue: false, breakLoop: false, continueLoop: true }
}

/**
 * Handle delete_files tool — generates delete diffs
 */
export function handleDeleteFilesTool(args, ctx, findExisting) {
  const events = [{ event: 'status', data: { stage: 'generating_diffs', detail: `Building delete diffs for ${args.files?.length || 0} file(s)...` } }]

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
    ctx.diffFiles.push(diffEntry)
    events.push({ event: 'diff_file', data: diffEntry })
  }

  if (!ctx.fullContent) {
    ctx.fullContent = formatDeleteSummary(ctx.diffFiles, args)
    events.push({ event: 'token', data: { content: ctx.fullContent } })
  }

  return { events, loopContinue: false, breakLoop: false }
}

/**
 * Handle plan_project tool — formats and stores a project plan
 */
export function handlePlanProjectTool(args, ctx) {
  const events = []
  ctx.planOutput = args
  if (!ctx.fullContent) {
    ctx.fullContent = formatPlanResponse(args)
    events.push({ event: 'token', data: { content: ctx.fullContent } })
  }
  return { events, loopContinue: false, breakLoop: false }
}

/**
 * Handle summarize_project tool — formats a project summary
 */
export function handleSummarizeProjectTool(args, ctx) {
  const events = []
  if (!ctx.fullContent) {
    ctx.fullContent = formatSummaryResponse(args)
    events.push({ event: 'token', data: { content: ctx.fullContent } })
  }
  return { events, loopContinue: false, breakLoop: false }
}
