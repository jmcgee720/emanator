const { matchPromptPattern } = require('./prompt_library')
const { db } = require('../supabase/db')

/**
 * Detect active objective from recent changelog and memory.
 * Returns the objective string or null.
 */
async function detectActiveObjective(projectId) {
  if (!projectId) return null

  // Source 1: Last successful/applied changelog entry (most recent task the system completed)
  try {
    const recent = await db.changelog.findByProject(projectId, 3)
    if (recent && recent.length > 0) {
      // Find the most recent entry with a real task and non-rejection result
      const active = recent.find(
        (e) =>
          e.user_task &&
          e.user_task.length > 5 &&
          (!e.rejection_reasons || e.rejection_reasons.length === 0)
      )
      if (active) {
        return {
          source: 'changelog',
          task: active.user_task,
          task_mode: active.task_mode || 'plan',
          plan_summary: active.plan_summary || null,
        }
      }
    }
  } catch (err) {
    // changelog table may not exist — non-critical
  }

  // Source 2: Builder memory — look for an explicit active_objective key
  try {
    const memory = await db.projectMemory.findByProjectId(projectId)
    const objectiveEntry = (memory || []).find(
      (e) => e.key === 'active_objective' && e.value
    )
    if (objectiveEntry) {
      const val =
        typeof objectiveEntry.value === 'string'
          ? objectiveEntry.value
          : JSON.stringify(objectiveEntry.value)
      if (val.length > 5) {
        return { source: 'memory', task: val, task_mode: 'plan', plan_summary: null }
      }
    }
  } catch (err) {
    // memory table may not exist — non-critical
  }

  return null
}

async function request_router({ input, projectId, userId, memoryEntries }) {
  const entries =
    memoryEntries ||
    (projectId ? await db.projectMemory.findByProjectId(projectId) : [])
  const match = matchPromptPattern(entries, input, projectId, userId)

  // ── Active objective detection ──
  // If an active objective exists, suppress "ask user" paths
  const activeObjective = await detectActiveObjective(projectId)

  if (match && match.type === 'ambiguous_match') {
    // Normally this would trigger a clarification / "ask user" path.
    // If there IS an active objective, force continuation instead.
    if (activeObjective) {
      // Pick the top candidate (highest score) and treat as a match
      const best =
        match.candidates && match.candidates.length > 0
          ? match.candidates[0]
          : null
      if (best) {
        return {
          type: 'prompt_pattern_match',
          pattern: best,
          _continued_from: activeObjective,
        }
      }
      // No usable candidate — still route to planner via match type
      return {
        type: 'match',
        _continued_from: activeObjective,
      }
    }
    // No active objective — allow ambiguous path
    return { type: 'ambiguous_match', candidates: match.candidates }
  }

  if (match) {
    return { type: 'prompt_pattern_match', pattern: match }
  }

  // ── no_match path ──
  // If there is an active objective, route to planner instead of dead-ending
  if (activeObjective) {
    return {
      type: 'match',
      _continued_from: activeObjective,
    }
  }

  return { type: 'no_match' }
}

module.exports = { request_router, detectActiveObjective }
