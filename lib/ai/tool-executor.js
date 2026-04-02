/**
 * Tool execution dispatch helpers.
 *
 * Pure functions extracted from AIService — no streaming, no provider calls,
 * no retry logic, no database logging.  Service.js imports these and keeps
 * all orchestration/yield logic in the class.
 */

// ── Tool-call inspection ────────────────────────────────────────────────

/**
 * Inspect an array of tool calls returned by the AI and classify what they contain.
 */
export function inspectToolCalls(toolCalls) {
  let hasFileContent = false
  let hasFileActions = false
  let hasPlanCall = false
  let hasDeleteCall = false

  for (const tc of toolCalls) {
    try {
      const name = tc.function.name
      if (name === 'create_files' || name === 'update_files') hasFileContent = true
      if (name === 'delete_files') hasDeleteCall = true
      if (name === 'propose_plan') {
        hasPlanCall = true
        try {
          const a = JSON.parse(tc.function.arguments)
          if (a.file_actions?.length > 0) hasFileActions = true
        } catch { /* malformed args */ }
      }
    } catch { /* malformed tool call */ }
  }

  return { hasFileContent, hasFileActions, hasPlanCall, hasDeleteCall }
}

// ── File type detection ─────────────────────────────────────────────────

const FILE_TYPE_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  html: 'html', css: 'css', scss: 'css', json: 'json', md: 'markdown',
  py: 'python', sql: 'sql', svg: 'svg', png: 'image',
}

export function detectFileType(path) {
  const ext = path.split('.').pop()?.toLowerCase()
  return FILE_TYPE_MAP[ext] || 'text'
}

// ── Response text → file parsing ────────────────────────────────────────

export function tryParseFilesFromResponse(response) {
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

// ── Delete-diff construction ────────────────────────────────────────────

export function buildDeleteDiffs(args, findExisting) {
  const diffs = []
  for (const file of (args.files || [])) {
    const existing = findExisting(file.path)
    diffs.push({
      path: file.path,
      action: 'delete',
      newContent: null,
      oldContent: existing?.content || null,
      description: file.reason || 'Deleted',
      fileType: existing?.file_type || detectFileType(file.path),
    })
  }
  return diffs
}

// ── Image-prompt option parsers ─────────────────────────────────────────

export function parseSpriteOpts(message) {
  const name = message.match(/(?:character|sprite)\s+(?:named?\s+)?["']?(\w+)["']?/i)?.[1] || 'Character'
  const statesMatch = message.match(/states?[:\s]+([^.]+)/i)
  const states = statesMatch ? statesMatch[1].split(/[,;]+/).map(s => s.trim()).filter(Boolean) : ['idle', 'walk', 'jump', 'attack']
  const frameCount = parseInt(message.match(/(\d+)\s*frames?/i)?.[1]) || 4
  const style = message.match(/style[:\s]+([^.]+)/i)?.[1]?.trim() || 'pixel art, 16-bit, clean outlines'
  return { name, states, frameCount, style }
}

export function parseIconOpts(message) {
  const itemsMatch = message.match(/icons?\s+(?:for\s+)?([^.]+)/i)
  const items = itemsMatch ? itemsMatch[1].split(/[,;]+/).map(s => s.trim()).filter(Boolean) : undefined
  const count = parseInt(message.match(/(\d+)\s*icons?/i)?.[1]) || items?.length || 6
  const style = message.match(/style[:\s]+([^.]+)/i)?.[1]?.trim()
  return { items, count, style }
}

// ── Response formatters ─────────────────────────────────────────────────

export function formatPlanResponse(plan) {
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

export function formatProposedPlanResponse(plan) {
  // User-facing response: plain conversational text only.
  // The PlanCard component renders the structured plan separately.
  const summary = plan.summary || 'working on your request'
  let r = summary
  if (plan.design_preset) {
    r += `\n\n*Design style: ${plan.design_preset.replace(/_/g, ' ')}*`
  }
  r += `\n\nReady to go — click **Execute** to proceed, **Revise** to adjust, or **Cancel** to abort.`
  return r
}

export function formatSummaryResponse(summary) {
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

export function formatDiffSummary(diffFiles, args) {
  let r = `## ${args.plan || 'File Changes'}\n\n**${diffFiles.length} file(s) ready for review:**\n`
  for (const df of diffFiles) {
    const icon = df.action === 'create' ? '+' : '~'
    r += `- \`${icon}\` **${df.path}** — ${df.description || 'Generated'}\n`
  }
  if (args.summary) r += `\n**Summary:** ${args.summary}`
  return r
}

export function formatDeleteSummary(diffFiles, args) {
  const deletions = diffFiles.filter(d => d.action === 'delete')
  let r = `## ${args.plan || 'File Deletions'}\n\n**${deletions.length} file(s) to delete:**\n`
  for (const df of deletions) {
    r += `- \`-\` **${df.path}** — ${df.description}\n`
  }
  if (args.summary) r += `\n**Summary:** ${args.summary}`
  return r
}
