/**
 * File Ops Bridge — translates validated plan + AI tool output into correct file operations.
 * Uses the plan's file_actions as source of truth for action types.
 */

/**
 * Normalize a file path: strip leading ./ and /
 */
function normalizePath(p) {
  return (p || '').replace(/^\.\//, '').replace(/^\//, '')
}

/**
 * Build a lookup map from the plan's file_actions: normalized_path → action.
 */
function buildPlanActionMap(planFileActions) {
  const map = new Map()
  for (const fa of (planFileActions || [])) {
    const norm = normalizePath(fa.path)
    map.set(norm, fa.action)
    if (fa.path !== norm) map.set(fa.path, fa.action)
  }
  return map
}

/**
 * Resolve the correct action for a file operation.
 *
 * Priority:
 * 1. Plan file_actions (corrected by feature_planner) — highest trust
 * 2. findExisting result — if file exists, force 'update'; if not, force 'create'
 * 3. Tool name fallback — lowest trust
 *
 * @param {string} filePath
 * @param {Map} planActionMap — from buildPlanActionMap
 * @param {function} findExisting — (path) => fileRecord | null
 * @param {string} toolName — 'create_files' | 'update_files'
 * @returns {string} 'create' | 'update'
 */
function resolveAction(filePath, planActionMap, findExisting, toolName) {
  const norm = normalizePath(filePath)

  // Priority 1: plan says what this file should be
  const planAction = planActionMap.get(norm) || planActionMap.get(filePath)
  if (planAction === 'create' || planAction === 'update' || planAction === 'delete') {
    // Cross-check: plan says 'create' but file actually exists → force update
    const exists = findExisting(filePath)
    if (planAction === 'create' && exists) return 'update'
    // Plan says 'update' but file doesn't exist → force create
    if (planAction === 'update' && !exists) return 'create'
    return planAction
  }

  // Priority 2: filesystem reality
  const exists = findExisting(filePath)
  if (exists) return 'update'

  // Priority 3: tool name
  return toolName === 'update_files' ? 'update' : 'create'
}

/**
 * Convert raw AI tool output into correct pending diff entries.
 *
 * @param {object[]} toolFiles — args.files from create_files/update_files tool call
 * @param {object} opts
 * @param {object[]} opts.planFileActions — validated plan's file_actions
 * @param {function} opts.findExisting — (path) => fileRecord | null
 * @param {string} opts.toolName — 'create_files' | 'update_files'
 * @param {function} opts.detectFileType — (path) => string
 * @returns {object[]} pendingDiffs
 */
function buildPendingDiffs(toolFiles, { planFileActions, findExisting, toolName, detectFileType }) {
  const planMap = buildPlanActionMap(planFileActions)
  const diffs = []

  for (const file of (toolFiles || [])) {
    const action = resolveAction(file.path, planMap, findExisting, toolName)
    const existing = findExisting(file.path)
    diffs.push({
      path: normalizePath(file.path),
      action,
      newContent: file.content,
      oldContent: existing?.content || null,
      description: file.description || file.changes || '',
      fileType: file.file_type || detectFileType(file.path),
    })
  }

  return diffs
}

module.exports = { normalizePath, buildPlanActionMap, resolveAction, buildPendingDiffs }
