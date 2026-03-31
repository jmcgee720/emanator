/**
 * Pending-diff helpers for the apply / discard bypass paths.
 *
 * Pure data-extraction and formatting functions — no DB writes,
 * no streaming, no provider calls, no generator yields.
 */

// ── Chat-history scanner ────────────────────────────────────────────────

/**
 * Find the most-recent pending diff message in a chat's message array.
 * Returns the message object or `null`.
 */
export function findPendingDiffMessage(chatMessages) {
  // .reverse() mutates — callers should pass a copy if they need the original order
  return chatMessages.reverse().find(m =>
    m.metadata?.diffStatus === 'pending' && m.metadata?.diffFiles?.length > 0
  ) || null
}

// ── Content builders (markdown) ─────────────────────────────────────────

/**
 * Build the user-facing markdown after diffs have been applied.
 */
export function buildApplyDiffContent(results) {
  return (
    `## Diffs Applied\n\n` +
    `- **Written:** ${results.written.length} file(s)\n` +
    `- **Deleted:** ${results.deleted.length} file(s)` +
    (results.errors.length > 0 ? `\n- **Errors:** ${results.errors.join(', ')}` : '') +
    (results.rolledBack ? '\n- **\u26a0 Rolled back** \u2014 all changes reverted' : '')
  )
}

/**
 * Build the user-facing markdown after diffs have been discarded.
 */
export function buildDiscardContent(diffFiles) {
  const paths = (diffFiles || []).map(d => d.path)
  return (
    `## Diffs Discarded\n\n` +
    paths.map(p => '- `' + p + '`').join('\n') +
    `\n\nNo files were changed.`
  )
}

// ── Prompt builders (for post-apply AI verification) ────────────────────

/**
 * Build the messages array for the post-apply verification call.
 */
export function buildVerifyPrompt(planData, results) {
  return [
    {
      role: 'user',
      content:
        `A plan was just applied. Verify the result.\n\n` +
        `Plan summary: ${planData?.summary || 'N/A'}\n` +
        `Written files: ${results.written.join(', ') || 'none'}\n` +
        `Deleted files: ${results.deleted.join(', ') || 'none'}\n` +
        `Errors during write: ${results.errors.join(', ') || 'none'}\n\n` +
        `Start your answer with exactly YES or NO.\n` +
        `Did this apply achieve the plan's goal? Are there likely syntax errors, missing imports, or incomplete pieces?`,
    },
  ]
}

/**
 * Build the messages array for the post-apply completeness check.
 */
export function buildCompletenessPrompt(userMessage, planData, results) {
  return [
    {
      role: 'user',
      content:
        `A plan was just applied.\n\n` +
        `Original user request: ${userMessage}\n` +
        `Plan summary: ${planData?.summary || 'N/A'}\n` +
        `Files written: ${results.written.join(', ') || 'none'}\n` +
        `Files deleted: ${results.deleted.join(', ') || 'none'}\n\n` +
        `Start your answer with exactly COMPLETE or INCOMPLETE.\n` +
        `Is the user's original request fully addressed? If INCOMPLETE, list the remaining steps as a numbered list (one line each).`,
    },
  ]
}

// ── Response parsers ────────────────────────────────────────────────────

/**
 * Parse the AI completeness response into an array of remaining step strings.
 * Returns [] when the response starts with COMPLETE (or is unparseable).
 */
export function parseCompletenessSteps(completenessContent) {
  if (!completenessContent.trim().toUpperCase().startsWith('INCOMPLETE')) return []
  const lines = completenessContent.split('\n').filter(l => /^\s*\d+[.)]\s/.test(l))
  return lines.map(l => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean)
}

// ── Continuation / done-event data builders ─────────────────────────────

/**
 * Compute continuation metadata from apply results.
 * Returns `{ nextStep, remainingSteps, originalTask }` or `null`.
 */
export function buildContinuationData(planData, verificationPassed, synthesizedSteps, results) {
  const effectiveSteps =
    planData?.next_steps?.length > 0 ? planData.next_steps : synthesizedSteps
  const canContinue = !results.rolledBack && verificationPassed && effectiveSteps.length > 0
  if (!canContinue) return null
  return {
    nextStep: effectiveSteps[0],
    remainingSteps: effectiveSteps.length > 1 ? effectiveSteps.slice(1) : [],
    originalTask: planData?.summary || '',
  }
}

/**
 * Build the `done` event payload for the apply_pending_diff path.
 */
export function buildApplyDoneData(content, { requestedScope, runId, providerName, modelName, results, planData, continuation }) {
  return {
    content,
    toolMode: 'apply_pending_diff',
    scope: requestedScope || 'project',
    runId,
    provider: providerName,
    model: modelName,
    appliedFiles: results.written,
    deletedFiles: results.deleted,
    rolledBack: results.rolledBack || false,
    planData: planData || null,
    continuation: continuation || null,
  }
}

/**
 * Build the `done` event payload for the discard_pending_diff path.
 */
export function buildDiscardDoneData(content, { requestedScope, runId, providerName, modelName, error }) {
  const data = {
    content,
    toolMode: 'discard_pending_diff',
    scope: requestedScope || 'project',
    runId,
    provider: providerName,
    model: modelName,
  }
  if (error) data.error = error
  return data
}
