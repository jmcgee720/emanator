/**
 * ChangeLog
 * Stores grounded planner metadata for audit and debugging.
 */
import { db } from '@/lib/supabase/db'

/**
 * Log a planning event with full grounding metadata.
 */
export async function logPlanEvent({
  projectId,
  chatId,
  userId,
  userTask,
  taskMode = 'plan',
  contextPaths = [],
  validatorResult = null,
  planHash = null,
  rejectionReasons = [],
  planSummary = null,
  fileActions = null,
  constraintsChecked = null,
}) {
  try {
    await db.changelog.create({
      project_id: projectId,
      chat_id: chatId,
      user_id: userId,
      user_task: userTask?.slice(0, 1000) || '',
      task_mode: taskMode,
      context_paths: contextPaths,
      validator_result: validatorResult ? {
        valid: validatorResult.valid,
        errors: validatorResult.errors || [],
        warnings: validatorResult.warnings || [],
        error_count: validatorResult.errors?.length || 0,
        warning_count: validatorResult.warnings?.length || 0,
        mode: validatorResult.mode || null,
      } : null,
      plan_hash: planHash,
      rejection_reasons: rejectionReasons,
      plan_summary: planSummary?.slice(0, 500) || null,
      file_actions: fileActions ? fileActions.map(a => ({
        action: a.action,
        path: a.path,
        reason: a.reason || null,
        grounded_on: a.grounded_on || [],
      })) : null,
      constraints_checked: constraintsChecked || null,
    })
  } catch (err) {
    console.error('[ChangeLog] Failed to log plan event:', err.message)
  }
}
