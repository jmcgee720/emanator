// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: OBSERVATORY EMIT ──
// Extracted from message-stream.js Step 6. Rolls the build manifest,
// emits the `build_manifest` SSE event, and persists a compact
// `project.integrity.json` snapshot the Preview tab can introspect.
//
// Pure side-effectful emitter: receives all inputs, yields one event,
// writes one file. No business logic of its own — just composition.
// ══════════════════════════════════════════════════════════════════════

import { buildManifest } from '../build-observatory.js'

/**
 * Emit the build observatory manifest for the current project.
 *
 * @param {Object} opts
 * @param {Object} opts.plan - the build plan (imageAssets, designTokens, layoutBlueprint, recipeFamily, verifyResult)
 * @param {Array<Object>} opts.attachments - raw user attachments (for role counts)
 * @param {Array<{stage, ms}>} opts.buildTimings
 * @param {Object} opts.visualLoopSummary - output of runVisualFidelityLoop (or null)
 * @param {string} opts.projectId
 * @param {Object} opts.db
 * @param {Object} opts.aiService
 * @returns {AsyncGenerator<{event: string, data: any}>}
 */
export async function* emitBuildObservatory({
  plan,
  attachments,
  buildTimings,
  visualLoopSummary,
  projectId,
  db,
  aiService,
}) {
  try {
    const dbFilesFinal = await db.projectFiles.findByProjectId(projectId)
    const projectFiles = (dbFilesFinal || []).map((f) => ({ path: f.path, content: f.content || '' }))
    const manifest = buildManifest({
      imageAssets: plan.imageAssets,
      rawAttachments: attachments,
      designTokens: plan.designTokens,
      layoutBlueprint: plan.layoutBlueprint,
      recipeFamily: plan.recipeFamily,
      timings: buildTimings,
      projectFiles,
      screenshotVerify: plan.verifyResult || null,
      visualLoopSummary: visualLoopSummary?.rounds?.length ? visualLoopSummary : null,
    })
    yield { event: 'build_manifest', data: manifest }

    const integrityContent = JSON.stringify({
      assets: manifest.assets,
      integrity: manifest.integrity,
      warnings: manifest.warnings,
      qualityScore: manifest.qualityScore,
      generatedAt: new Date().toISOString(),
    }, null, 2)
    await aiService.saveFiles(projectId, [{ path: 'project.integrity.json', content: integrityContent }], false)
  } catch (err) {
    console.warn('[ObservatoryEmit] Manifest emission failed:', err.message)
  }
}
