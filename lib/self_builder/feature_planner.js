/**
 * Feature Planner — plan post-processor for correctness enforcement.
 * Sits between raw AI propose_plan output and plan event emission.
 */

const SINGLE_FILE_SIGNALS = [
  /\b(only|just)\s+(this|one|that|the)\s+file\b/i,
  /\bsingle[- ]?file\b/i,
  /\b(modify|update|edit|fix|patch|change)\s+[`"']?([a-zA-Z0-9_/.\\-]+\.[a-z]{1,4})[`"']?\s*(only)?\b/i,
  /\bminimal\s+(patch|change|edit)\b/i,
]

const PLACEHOLDER_PATTERNS = [
  /\bassume\b/i,
  /\bexisting code\b/i,
  /\bplaceholder\b/i,
  /\binsert here\b/i,
  /\.\.\.\s*$/m,
  /\/\/\s*\.\.\.\s*(rest|remaining|other)/i,
]

/**
 * Detect if the user prompt targets a single specific file.
 * Returns the file path if single-file intent is detected, null otherwise.
 */
function detectSingleFileIntent(userMessage) {
  if (!userMessage) return null
  // Explicit single-file signals
  for (const re of SINGLE_FILE_SIGNALS) {
    const m = userMessage.match(re)
    if (m) {
      // Extract file path from group 2 if present
      if (m[2] && m[2].includes('.')) return m[2]
      // Try to extract any file path from the message
      const pathMatch = userMessage.match(/[`"']?([a-zA-Z0-9_/.\\-]+\.[a-z]{1,4})[`"']?/)
      if (pathMatch) return pathMatch[1]
      return '__single__'
    }
  }
  return null
}

/**
 * Enforce plan correctness. Mutates the plan in-place and returns corrections applied.
 *
 * @param {object} plan — raw propose_plan args from AI
 * @param {object} fileContext — { existingPaths: string[], files: [...] }
 * @param {string} userMessage — original user prompt
 * @returns {{ corrections: string[] }}
 */
function enforcePlanCorrectness(plan, fileContext, userMessage) {
  const corrections = []
  const existingSet = new Set((fileContext?.existingPaths || []).map(p => p.replace(/^\.\//, '').replace(/^\//, '')))

  // 1. Ensure file_actions exists
  if (!plan.file_actions || !Array.isArray(plan.file_actions)) {
    plan.file_actions = []
    corrections.push('file_actions was missing — initialized to empty array')
  }

  // 2. Fix create→update for existing files
  for (const fa of plan.file_actions) {
    const norm = (fa.path || '').replace(/^\.\//, '').replace(/^\//, '')
    if (fa.action === 'create' && (existingSet.has(fa.path) || existingSet.has(norm))) {
      fa.action = 'update'
      corrections.push(`${fa.path}: corrected create→update (file exists)`)
    }
  }

  // 3. Single-file enforcement
  const singleTarget = detectSingleFileIntent(userMessage)
  if (singleTarget && plan.file_actions.length > 1) {
    if (singleTarget !== '__single__') {
      // Keep only the action matching the target file
      const norm = singleTarget.replace(/^\.\//, '').replace(/^\//, '')
      const match = plan.file_actions.find(fa => {
        const faNorm = (fa.path || '').replace(/^\.\//, '').replace(/^\//, '')
        return faNorm === norm || fa.path === singleTarget || faNorm.endsWith(norm)
      })
      if (match) {
        const removed = plan.file_actions.length - 1
        plan.file_actions = [match]
        corrections.push(`single-file enforcement: kept only ${match.path}, removed ${removed} extra action(s)`)
      }
    } else {
      // Generic single-file signal — keep only the first action
      const removed = plan.file_actions.length - 1
      plan.file_actions = [plan.file_actions[0]]
      corrections.push(`single-file enforcement: kept only ${plan.file_actions[0].path}, removed ${removed} extra action(s)`)
    }
  }

  // 4. Strip placeholder language from descriptions
  for (const fa of plan.file_actions) {
    for (const field of ['reason', 'description', 'intent']) {
      if (fa[field]) {
        for (const re of PLACEHOLDER_PATTERNS) {
          if (re.test(fa[field])) {
            fa[field] = fa[field].replace(re, '').trim()
            corrections.push(`${fa.path}: stripped placeholder language from ${field}`)
          }
        }
      }
    }
  }

  // 5. Update constraints_checked to reflect corrections
  if (plan.constraints_checked) {
    plan.constraints_checked.no_illegal_create = plan.file_actions.every(fa => {
      const norm = (fa.path || '').replace(/^\.\//, '').replace(/^\//, '')
      return fa.action !== 'create' || (!existingSet.has(fa.path) && !existingSet.has(norm))
    })
    plan.constraints_checked.has_file_actions = plan.file_actions.length > 0
    plan.constraints_checked.minimal_patch = plan.file_actions.length <= 5
  }

  return { corrections }
}

module.exports = { enforcePlanCorrectness, detectSingleFileIntent }
