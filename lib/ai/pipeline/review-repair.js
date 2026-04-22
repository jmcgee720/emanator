// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: REVIEW + REPAIR ──
// Extracted from message-stream.js Steps 5 + 5b.
//
//   Step 5  — LLM review of the built files, then LLM repair wave if the
//             review flags anything missing/broken.
//   Step 5b — Deterministic post-repair safety net that catches the
//             three structural regressions prompt rules can't guarantee
//             (duplicate router navbar, ignored LOGO_URL, ignored HERO_URL).
//
// Each step is independently fault-tolerant. The generator yields every
// SSE event the inline block produced (status / review_result / files_saved
// / repair progress) and returns the reviewResult for the observatory.
// ══════════════════════════════════════════════════════════════════════

import { reviewBuild as _reviewBuild, repairBuild as _repairBuild } from '../brief-reviewer.js'
import { runPostRepair as _runPostRepair } from '../post-repair.js'

/**
 * Run the review + repair + post-repair chain against the current
 * project state.
 *
 * @param {Object} opts
 * @param {Object} opts.plan - build plan (reads imageAssets)
 * @param {Array<{path, content?}>} opts.allSavedFiles
 * @param {string} opts.projectId
 * @param {Object} opts.db - adapter with projectFiles.findByProjectId
 * @param {Object} opts.aiService - provider + saveFiles
 * @param {(stage: string, startedAt: number) => void} opts.tick - timings recorder
 * @param {Object} [opts.deps]
 * @returns {AsyncGenerator<{event, data}, {reviewResult: ?Object}>}
 */
export async function* runReviewAndRepair({ plan, allSavedFiles, projectId, db, aiService, tick, deps }) {
  const reviewBuild = deps?.reviewBuild || _reviewBuild
  const repairBuild = deps?.repairBuild || _repairBuild
  const runPostRepair = deps?.runPostRepair || _runPostRepair

  if (!Array.isArray(allSavedFiles) || allSavedFiles.length === 0) {
    return { reviewResult: null }
  }

  let reviewResult = null

  // ── Step 5: LLM review + auto-repair ──
  yield { event: 'status', data: { stage: 'reviewing', detail: 'Reviewing build for missing flows...' } }
  try {
    // saveFiles returns {path, id, action} without content; re-fetch from DB
    // for the reviewer's content samples. On failure, review is best-effort.
    let filesWithContent = []
    try {
      const dbFiles = await db.projectFiles.findByProjectId(projectId)
      filesWithContent = (dbFiles || []).map((f) => ({ path: f.path, content: f.content || '' }))
    } catch {
      filesWithContent = allSavedFiles.map((f) => ({ path: f.path, content: '' }))
    }

    reviewResult = await reviewBuild({ plan, filesBuilt: filesWithContent, provider: aiService.provider })
    yield { event: 'review_result', data: reviewResult }
    console.log('[ReviewRepair] Review:', reviewResult.ok ? 'OK' : `missing=${reviewResult.missing.length} broken=${reviewResult.broken.length}`)

    if (!reviewResult.ok) {
      yield {
        event: 'status',
        data: {
          stage: 'repairing',
          detail: `Auto-repairing ${reviewResult.missing.length + reviewResult.broken.length} issue(s)...`,
        },
      }
      const repairGen = repairBuild({
        plan,
        review: reviewResult,
        filesBuilt: filesWithContent,
        provider: aiService.provider,
        saveFiles: async (files) => aiService.saveFiles(projectId, files, false),
      })
      let repairResult = { filesRepaired: [] }
      while (true) {
        const next = await repairGen.next()
        if (next.done) { repairResult = next.value || repairResult; break }
        yield next.value
      }
      console.log('[ReviewRepair] Repair:', repairResult.filesRepaired.length, 'file(s)')
    }
  } catch (err) {
    console.warn('[ReviewRepair] Review/repair skipped:', err.message)
  }

  // ── Step 5b: Deterministic post-repair safety net ──
  const postRepairStartedAt = Date.now()
  try {
    const dbFilesFinal = await db.projectFiles.findByProjectId(projectId)
    const fileList = (dbFilesFinal || []).map((f) => ({ path: f.path, content: f.content || '' }))
    const { updates, modifiedPaths } = runPostRepair(fileList, { imageAssets: plan.imageAssets })
    if (updates.length > 0) {
      await aiService.saveFiles(projectId, updates, false)
      console.log('[ReviewRepair] Post-repair applied to', modifiedPaths.length, 'file(s):', modifiedPaths.join(', '))
      yield {
        event: 'files_saved',
        data: { files: modifiedPaths.map((p) => ({ path: p, action: 'post_repair', id: p })) },
      }
    }
  } catch (err) {
    console.warn('[ReviewRepair] Post-repair skipped:', err.message)
  }
  if (typeof tick === 'function') tick('post_repair', postRepairStartedAt)

  return { reviewResult }
}
