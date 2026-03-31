/**
 * Post-processing helpers for AI service responses.
 *
 * Pure transformation functions called after model/tool output is available.
 * No DB writes, no streaming, no provider calls, no retry logic.
 */

import { v4 as uuidv4 } from 'uuid'

// ── Empty canvas template ───────────────────────────────────────────────

export const EMPTY_CANVAS_CONTENT = {
  project_overview: '', project_goals: [], key_decisions: [],
  architecture_notes: [], master_prompts: [], working_prompts: [],
  failed_prompts: [], successful_patterns: [], feature_requirements: [],
  technical_specs: [], constraints: [], open_tasks: [], completed_tasks: []
}

// ── Canvas insight merger ───────────────────────────────────────────────

/**
 * Apply extracted insights to a canvas object (pure — no DB).
 * Returns { canvas, changed, changeSummary }.
 *
 * @param {object} canvasContent - Current canvas_content (will be shallow-copied)
 * @param {object} insights      - Output of extractInsights()
 * @param {object} opts          - { files, providerTag, userMessage }
 */
export function applyInsightsToCanvas(canvasContent, insights, opts = {}) {
  const canvas = { ...(canvasContent || {}) }
  let changed = false
  const changes = []

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
      changes.push('goal')
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
    changes.push('decision')
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
    changes.push('task')
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

  const files = opts.files || []
  if (files.length > 0) {
    canvas.successful_patterns = canvas.successful_patterns || []
    const tag = opts.providerTag || 'unknown'
    const msg = opts.userMessage || ''
    canvas.successful_patterns.push({
      id: uuidv4(),
      text: `[${tag}] "${msg.slice(0, 150)}${msg.length > 150 ? '...' : ''}"`,
      status: 'active', confidence: 'confirmed',
      created_at: new Date().toISOString()
    })
    changed = true
    changes.push(`${files.length} files`)
  }

  if (!canvas.project_overview && insights.overviewHint) {
    canvas.project_overview = insights.overviewHint
    changed = true
  }

  const changeSummary = `Auto-updated: ${changes.filter(Boolean).join(', ')}`

  return { canvas, changed, changeSummary }
}

// ── Inline response text builders ───────────────────────────────────────

/**
 * Build a human-readable file summary when the AI doesn't provide one.
 */
export function buildFilesSummaryText(toolName, savedFiles, args) {
  let text = `## ${args.plan || 'File Changes'}\n\n`
  text += `**Files ${toolName === 'create_files' ? 'Created' : 'Updated'}:**\n`
  for (const file of savedFiles) {
    text += `- \`${file.path}\` - ${file.description || 'Generated'}\n`
  }
  text += `\n**Summary:** ${args.summary || ''}`
  return text
}

// ── Error log payload builder ───────────────────────────────────────────

/**
 * Build the error-case log data for a failed generation run.
 */
export function buildErrorLogData({ runId, projectId, chatId, userId, requestedScope, intentType, startTime, error, providerName, modelName }) {
  const data = {
    id: runId,
    project_id: projectId,
    chat_id: chatId,
    user_id: userId,
    tool_mode: 'error',
    scope: requestedScope || 'project',
    intent_type: intentType,
    files_generated: 0,
    duration: Date.now() - startTime,
    success: false,
    error: error.message,
    provider: providerName,
    model: modelName,
  }

  if (error.error_type) {
    data.error_type = error.error_type
    data.provider_status_code = error.status_code
    data.raw_error = error.raw_error
  }

  return data
}
