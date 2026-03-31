/**
 * PlanValidator
 * Validates planner output against grounding rules.
 * Rejects hallucinated, placeholder, or structurally invalid plans.
 */
import { detectSingleFileIntent } from '@/lib/self_builder/feature_planner'
import crypto from 'crypto'

/**
 * Compute a stable hash for a plan to detect repeated rejected plans.
 */
export function hashPlan(plan) {
  const canonical = JSON.stringify({
    summary: plan.summary || '',
    file_actions: (plan.file_actions || []).map(a => ({ path: a.path, action: a.action })),
    reasoning: plan.reasoning || [],
  })
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * Validate a proposed plan against grounding rules.
 * Returns { valid: boolean, errors: string[], warnings: string[] }
 */
export function validatePlan(plan, fileContext, previousRejectedHash = null, userMessage = null, opts = {}) {
  const errors = []
  const warnings = []
  const VALID_ACTIONS = new Set(['create', 'update', 'delete'])
  const allowedPathPrefix = opts.allowedPathPrefix || null
  const activeProjectId = opts.activeProjectId || null

  // 0. Project ID grounding — plan must target the active project
  if (activeProjectId && (!plan.projectId || plan.projectId !== activeProjectId)) {
    errors.push('Plan targets wrong project. Confirm project context.')
  }

  // 1. file_actions must exist and be non-empty
  if (!plan.file_actions || !Array.isArray(plan.file_actions) || plan.file_actions.length === 0) {
    errors.push('file_actions is missing or empty')
  }

  // 1b. Validate each file_action entry structure
  const seenPaths = new Set()
  for (const action of (plan.file_actions || [])) {
    const norm = (action.path || '').replace(/^\.\//, '').replace(/^\//, '')

    // Empty or missing path
    if (!norm) {
      errors.push('file_action has empty or missing path')
      continue
    }

    // Invalid action value
    if (!VALID_ACTIONS.has(action.action)) {
      errors.push(`"${norm}": invalid action "${action.action}" — must be create, update, or delete`)
    }

    // Duplicate path
    if (seenPaths.has(norm)) {
      errors.push(`"${norm}": duplicate path in file_actions`)
    }
    seenPaths.add(norm)

    // Path scope enforcement (self-edit target restriction)
    if (allowedPathPrefix && !norm.startsWith(allowedPathPrefix)) {
      errors.push(`"${norm}": outside allowed self-edit scope "${allowedPathPrefix}"`)
    }
  }

  // 2. Check grounded_in_file_context constraint
  if (plan.constraints_checked && plan.constraints_checked.grounded_in_file_context === false) {
    errors.push('Plan self-reports as not grounded in file context')
  }

  // 3-4. Placeholder checks removed — only file_actions[].content is scanned (check #8)

  // 5. Strict file existence validation — create/update must match filesystem
  if (fileContext) {
    const existingSet = new Set((fileContext.existingPaths || []).map(p => p.replace(/^\.\//, '').replace(/^\//, '')))
    for (const rawPath of (fileContext.existingPaths || [])) existingSet.add(rawPath)
    // Build content lookup for no-op detection
    const contentByPath = new Map()
    for (const f of (fileContext.files || [])) {
      if (f.exists && f.content != null) {
        const fnorm = (f.path || '').replace(/^\.\//, '').replace(/^\//, '')
        contentByPath.set(f.path, f.content)
        contentByPath.set(fnorm, f.content)
      }
    }
    for (const action of (plan.file_actions || [])) {
      const norm = (action.path || '').replace(/^\.\//, '').replace(/^\//, '')
      const exists = existingSet.has(action.path) || existingSet.has(norm)
      if (action.action === 'create' && exists) {
        errors.push(`"${action.path}": marked create but file exists — must be update`)
      }
      if (action.action === 'update' && !exists) {
        errors.push(`"${action.path}": marked update but file does not exist — must be create`)
        errors.push(`"${action.path}": file not found in current project. Confirm project context.`)
      }
      if (action.action === 'delete' && !exists) {
        errors.push(`"${action.path}": file not found in current project. Confirm project context.`)
      }
      // No-op update: plan content identical to existing file
      if (action.action === 'update' && exists) {
        const planContent = action.content || action.new_content || null
        const existingContent = contentByPath.get(action.path) || contentByPath.get(norm)
        if (planContent != null && existingContent != null && planContent.trim() === existingContent.trim()) {
          errors.push(`"${action.path}": no-op update — plan content identical to existing file`)
        }
      }
    }
  }

  // 6. Check for repeated rejected plan
  if (previousRejectedHash) {
    const currentHash = hashPlan(plan)
    if (currentHash === previousRejectedHash) {
      errors.push('Plan is identical to a previously rejected plan')
    }
  }

  // 7. Strict single-file enforcement
  if (userMessage && (plan.file_actions || []).length > 1) {
    const singleTarget = detectSingleFileIntent(userMessage)
    if (singleTarget) {
      errors.push(`Single-file prompt detected but plan has ${plan.file_actions.length} file_actions — must be exactly 1`)
    }
  }

  // 8. Filler content in file action code blocks (only scans file_actions[].content)
  const FILLER_PATTERNS = [
    /lorem ipsum/i,
    /\bTODO\b/,
    /\bFIXME\b/,
    /sample text/i,
    /dummy text/i,
  ]
  for (const action of (plan.file_actions || [])) {
    const content = action.content || action.new_content || ''
    if (content) {
      for (const re of FILLER_PATTERNS) {
        if (re.test(content)) {
          errors.push(`"${action.path}": file content contains filler: "${content.match(re)?.[0]}"`)
          break
        }
      }
    }
  }

  // 9. Minimal patch check — hard reject if too many files
  if ((plan.file_actions || []).length > 10) {
    errors.push(`Plan touches ${plan.file_actions.length} files — exceeds maximum of 10`)
  } else if ((plan.file_actions || []).length > 5) {
    warnings.push(`Plan touches ${plan.file_actions.length} files — consider splitting into smaller patches`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hash: hashPlan(plan),
  }
}

/**
 * Enforce task-mode invariants on AI output.
 */
export function validateTaskMode(taskMode, { hasFileActions, hasFileContent, hasGroundedContext, diffStatus }) {
  const errors = []
  if (taskMode === 'inspect' && hasFileActions) {
    errors.push('inspect mode must not produce file_actions')
  }
  if (taskMode === 'plan' && hasFileContent) {
    errors.push('plan mode must not produce file contents — only file_actions are allowed')
  }
  if (taskMode === 'patch' && !hasGroundedContext) {
    errors.push('patch mode requires grounded file context')
  }
  if (taskMode === 'apply' && diffStatus !== 'pending') {
    errors.push('apply mode requires metadata.diffStatus === "pending"')
  }
  return { valid: errors.length === 0, errors, mode: 'task_mode_rejected' }
}

/**
 * Validate AI output against request-mode contract.
 * Returns { valid, errors, mode: 'request_mode_rejected' }
 */
export function validateRequestModeOutput(requestMode, { hasProposedPlan, hasFileActions, hasFileContent, hasDiffFiles }) {
  const errors = []

  if (requestMode === 'read_only_report') {
    if (hasProposedPlan) errors.push('read_only_report must not produce Proposed Plan')
    if (hasFileActions) errors.push('read_only_report must not produce file_actions')
    if (hasFileContent) errors.push('read_only_report must not produce file contents')
    if (hasDiffFiles) errors.push('read_only_report must not produce diff files')
  }

  if (requestMode === 'apply_pending_diff') {
    if (hasProposedPlan) errors.push('apply_pending_diff must not produce Proposed Plan')
    if (hasFileActions) errors.push('apply_pending_diff must not produce file_actions')
  }

  if (requestMode === 'discard_pending_diff') {
    if (hasProposedPlan) errors.push('discard_pending_diff must not produce Proposed Plan')
    if (hasFileActions) errors.push('discard_pending_diff must not produce file_actions')
  }

  if (requestMode === 'plan_only') {
    if (hasFileContent) errors.push('plan_only must not produce file contents')
    if (hasDiffFiles) errors.push('plan_only must not produce diff files')
  }

  if (requestMode === 'patch_only') {
    if (hasProposedPlan) errors.push('patch_only must not re-propose a plan — execute directly')
  }

  // plan_patch: always valid (current behavior)
  return { valid: errors.length === 0, errors, mode: 'request_mode_rejected' }
}

const PATCH_FILLER_PATTERNS = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /sample text/i,
  /dummy text/i,
]

/**
 * Validate diff entries before Diff Preview. V1: low-risk checks only.
 */
export function validatePatchGrounding(diffEntries, filesByPath, planContext) {
  const errors = []

  const anchorsByPath = new Map()
  if (planContext?.file_actions) {
    for (const fa of planContext.file_actions) {
      if (fa.grounded_on?.length) anchorsByPath.set(fa.path, fa.grounded_on)
    }
  }

  for (const diff of diffEntries) {
    const { path, newContent, oldContent, action } = diff
    if (action === 'delete' || !newContent) continue

    // 1. Filler content check
    for (const pattern of PATCH_FILLER_PATTERNS) {
      if (pattern.test(newContent)) {
        errors.push(`"${path}": generated code contains filler: "${newContent.match(pattern)?.[0]}"`)
        break
      }
    }

    // 2. No-op patch
    if (action === 'update' && oldContent && newContent.trim() === oldContent.trim()) {
      errors.push(`"${path}": patch is a no-op — new content identical to existing`)
    }

    // 3. oldContent vs actual file
    if (action === 'update' && filesByPath) {
      const norm = path.replace(/^\.\//, '').replace(/^\//, '')
      const realFile = filesByPath.get(path) || filesByPath.get(norm)
      if (realFile && oldContent && realFile.content !== oldContent) {
        errors.push(`"${path}": diff oldContent does not match actual file — patch may be hallucinated`)
      }
    }

    // 3.5 Large rewrite detection
    if (action === 'update' && oldContent && newContent && oldContent.length > 100) {
      const oldLines = oldContent.split('\n').map(l => l.trim())
      const newSet = new Set(newContent.split('\n').map(l => l.trim()))
      const preserved = oldLines.filter(l => newSet.has(l)).length
      const changedRatio = 1 - (preserved / oldLines.length)
      if (changedRatio > 0.70) {
        errors.push(`"${path}": Large rewrite detected — split into smaller patches`)
      }
    }

    // 4. Anchor grounding check for updates
    if (action === 'update') {
      const anchors = anchorsByPath.get(path)
      if (anchors?.length) {
        const norm = path.replace(/^\.\//, '').replace(/^\//, '')
        const realFile = filesByPath?.get(path) || filesByPath?.get(norm)
        if (realFile?.content) {
          const hasAnchor = anchors.some(a => /^NONEXISTENT/i.test(a) || realFile.content.includes(a))
          if (!hasAnchor) {
            errors.push(`"${path}": none of the grounded_on anchors exist in the actual file — patch is ungrounded`)
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, mode: 'patch_grounding' }
}
