// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: AUTO-SNAPSHOT ──
// Extracted from message-stream.js Step 6 finalize. Writes a named
// snapshot of the project's files to the `snapshots` table so the user
// can rollback any build later.
//
// Purely best-effort — the snapshots table is optional, and a failure
// here never propagates to the caller.
// ══════════════════════════════════════════════════════════════════════

/**
 * Create an "auto_build" snapshot of the project's current file state.
 *
 * @param {Object} opts
 * @param {Object} opts.db - adapter with `projectFiles.findByProjectId` + `snapshots.create`
 * @param {string} opts.projectId
 * @param {Object} opts.brief - { summary?, rawBrief? } — used for the snapshot title
 * @param {Object} opts.plan - { brand: {name}, waves: [] } — used for metadata
 * @param {Object} opts.archetype - { id } — recorded in metadata
 * @param {string} opts.runId - pipeline run id
 * @returns {Promise<{created: boolean, name?: string}>}
 */
export async function createAutoSnapshot({ db, projectId, brief, plan, archetype, runId }) {
  try {
    const files = await db.projectFiles.findByProjectId(projectId)
    if (!files || files.length === 0) return { created: false }

    const shortBrief = (brief?.summary || brief?.rawBrief || '').slice(0, 60).trim() || plan?.brand?.name || 'build'
    const name = `Build · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${shortBrief}`

    await db.snapshots.create({
      project_id: projectId,
      name,
      files_snapshot: files.map((f) => ({
        path: f.path,
        content: f.content || '',
        file_type: f.file_type,
      })),
      canvas_snapshot: null,
      metadata: {
        file_count: files.length,
        archetype: archetype?.id,
        brand: plan?.brand?.name,
        waves: plan?.waves?.length || 0,
        kind: 'auto_build',
        run_id: runId,
      },
    })
    console.log('[AutoSnapshot] Created:', name)
    return { created: true, name }
  } catch (e) {
    console.warn('[AutoSnapshot] Failed (non-critical):', e.message)
    return { created: false }
  }
}
