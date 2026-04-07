/**
 * Canvas operations — update canvas, index search, log generation runs.
 * Extracted from service.js to reduce file size.
 */

import { extractInsights, sanitizeLogPayload, buildSearchEntries } from './stream-helpers.js'
import { EMPTY_CANVAS_CONTENT, applyInsightsToCanvas } from './post-process.js'
import { db } from '@/lib/supabase/db'

/**
 * Update canvas after exchange — always updates, logs errors
 */
export async function updateCanvasFromExchange(projectId, userMessage, response, files, plan, providerTag) {
  let canvasDoc = await db.projectCanvas.findByProjectId(projectId)

  if (!canvasDoc) {
    canvasDoc = await db.projectCanvas.create({
      project_id: projectId,
      canvas_content: { ...EMPTY_CANVAS_CONTENT }
    })
  }

  const insights = extractInsights(userMessage, response, files, plan)
  const { canvas, changed, changeSummary } = applyInsightsToCanvas(
    canvasDoc.canvas_content,
    insights,
    { files, providerTag, userMessage }
  )

  if (changed) {
    await db.projectCanvas.update(projectId, canvas)
    // canvasEvents logging is best-effort — skip if table doesn't exist
    try { await db.canvasEvents?.create?.({ project_id: projectId, change_summary: changeSummary }) } catch {}

    const verify = await db.projectCanvas.findByProjectId(projectId)
    if (!verify || !verify.canvas_content) {
      console.error('[AIService] CANVAS VERIFICATION FAILED: Canvas not found after update')
      return false
    }
  }

  return changed
}

/**
 * Index exchange for search
 */
export async function indexForSearch(projectId, chatId, userMessage, response, files) {
  const entries = buildSearchEntries(projectId, chatId, response, files)
  if (entries.length > 0 && db.searchIndex?.bulkInsert) {
    await db.searchIndex.bulkInsert(entries)
  }
}

/**
 * Log a generation run to the database
 */
export async function logGenerationRun(data) {
  try {
    await db.generationRuns.create(sanitizeLogPayload(data))
  } catch (error) {
    console.error('[AIService] Failed to log run:', error.message)
  }
}
