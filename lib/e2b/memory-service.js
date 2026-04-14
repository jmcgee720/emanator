/**
 * Agent Memory Service
 * 
 * Automatically saves structured memory after each agent action.
 * Memory persists across conversations, giving the AI context about
 * what was built, what failed, and user preferences.
 */

import db from '../supabase/db.js'

/**
 * Save action log entry to project memory.
 * Called automatically after each successful agent action.
 */
export async function saveActionMemory(projectId, action) {
  if (!projectId || !action) return

  try {
    // Build a concise memory entry from the action
    const key = `action_${Date.now()}`
    const value = JSON.stringify({
      type: action.type, // 'edit', 'create', 'build', 'test', 'error'
      files: action.files || [],
      summary: action.summary || '',
      success: action.success !== false,
      timestamp: new Date().toISOString(),
    })

    await db.projectMemory.create({ project_id: projectId, key, value })
    console.log(`[Memory] Saved action: ${action.type} — ${action.summary?.slice(0, 60)}`)
  } catch (err) {
    console.warn('[Memory] Failed to save action:', err.message)
  }
}

/**
 * Save explicit memory entries (from the update_memory tool).
 */
export async function saveMemoryEntries(projectId, entries) {
  if (!projectId || !entries?.length) return []

  const saved = []
  for (const entry of entries.slice(0, 10)) { // Max 10 per call
    try {
      // Check if key already exists — update instead of duplicate
      const existing = await db.projectMemory.findByProjectId(projectId)
      const match = existing.find(e => e.key === entry.key)
      
      if (match) {
        await db.projectMemory.updateById(match.id, { value: entry.value })
        saved.push({ key: entry.key, action: 'updated' })
      } else {
        await db.projectMemory.create({ project_id: projectId, key: entry.key, value: entry.value })
        saved.push({ key: entry.key, action: 'created' })
      }
    } catch (err) {
      console.warn(`[Memory] Failed to save entry "${entry.key}":`, err.message)
    }
  }
  
  // Prune old entries if over limit (keep most recent 50)
  try {
    const all = await db.projectMemory.findByProjectId(projectId)
    if (all.length > 50) {
      const toDelete = all.slice(0, all.length - 50)
      for (const entry of toDelete) {
        await db.projectMemory.deleteById(entry.id)
      }
      console.log(`[Memory] Pruned ${toDelete.length} old entries`)
    }
  } catch {}

  return saved
}

/**
 * Build a memory summary for the system prompt.
 * Returns a concise block that tells the AI what happened before.
 */
export async function buildMemorySummary(projectId) {
  if (!projectId) return ''

  try {
    const entries = await db.projectMemory.findByProjectId(projectId)
    if (!entries?.length) return ''

    // Separate action logs from explicit memories
    const actions = []
    const notes = []
    
    for (const entry of entries) {
      if (entry.key.startsWith('action_')) {
        try {
          const data = JSON.parse(entry.value)
          actions.push(data)
        } catch {
          actions.push({ summary: entry.value, type: 'unknown' })
        }
      } else {
        notes.push({ key: entry.key, value: entry.value })
      }
    }

    let summary = ''

    // Recent actions (last 10)
    if (actions.length > 0) {
      const recent = actions.slice(-10)
      summary += '\n## Recent Actions (from previous conversations)\n'
      for (const a of recent) {
        const status = a.success === false ? 'FAILED' : 'OK'
        const files = a.files?.length ? ` (${a.files.join(', ')})` : ''
        summary += `- [${status}] ${a.type || '?'}: ${a.summary || 'no description'}${files}\n`
      }
    }

    // Explicit notes
    if (notes.length > 0) {
      summary += '\n## Project Notes (saved by AI)\n'
      for (const n of notes) {
        summary += `- **${n.key}**: ${n.value}\n`
      }
    }

    return summary
  } catch (err) {
    console.warn('[Memory] Failed to build summary:', err.message)
    return ''
  }
}
