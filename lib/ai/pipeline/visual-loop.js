// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: VISUAL-FIDELITY LOOP ──
// Extracted from message-stream.js (Session 32). N-round verify → repair
// → re-verify cycle. Up to `maxRounds` (default 3); short-circuits early
// when Vision signals MATCH or nothing is repairable.
//
// Exported as an async generator so the orchestrator can still yield
// every SSE event inline (screenshot_verify, status, visual_repair_*).
// The generator's return value is the final `visualLoopSummary` so the
// caller can thread it into the build manifest.
// ══════════════════════════════════════════════════════════════════════

import {
  verifyBuild as _verifyBuild,
  findingsToReviewShape as _findingsToReviewShape,
  shouldContinueVisualLoop as _shouldContinueVisualLoop,
} from '../screenshot-verify.js'
import { repairBuild as _repairBuild } from '../brief-reviewer.js'

/**
 * @typedef {Object} VisualLoopSummary
 * @property {Array<{round, findings, matches, confidence, filesRepaired}>} rounds
 * @property {number} totalFilesRepaired
 * @property {boolean} finalMatches
 * @property {number} initialFindings
 */

/**
 * Run the N-round visual-fidelity loop against the current project files.
 * Mutates `plan.verifyResult` with the latest verdict so downstream
 * consumers (build manifest) can reflect it. No side effects otherwise.
 *
 * Accepts optional `deps` for dependency injection — primarily to allow
 * the Jest suite to exercise the control flow without hitting the Vision
 * API. Defaults bind to the real pipeline primitives.
 *
 * @param {Object} opts
 * @param {Object} opts.plan - the build plan (reads referenceImages, mutates verifyResult)
 * @param {string} opts.projectId
 * @param {Object} opts.db - db adapter with `projectFiles.findByProjectId`
 * @param {Object} opts.aiService - needs `.provider` and `.saveFiles(projectId, files, flag)`
 * @param {number} [opts.maxRounds=3]
 * @param {Object} [opts.deps] - inject `{verifyBuild, repairBuild, findingsToReviewShape, shouldContinueVisualLoop}` for tests
 * @returns {AsyncGenerator<{event: string, data: any}, VisualLoopSummary>}
 */
export async function* runVisualFidelityLoop({ plan, projectId, db, aiService, maxRounds, deps }) {
  const verifyBuild = deps?.verifyBuild || _verifyBuild
  const findingsToReviewShape = deps?.findingsToReviewShape || _findingsToReviewShape
  const shouldContinueVisualLoop = deps?.shouldContinueVisualLoop || _shouldContinueVisualLoop
  const repairBuild = deps?.repairBuild || _repairBuild
  const MAX_ROUNDS = Number(maxRounds ?? process.env.VISUAL_REPAIR_MAX_ROUNDS ?? 3)
  const summary = {
    rounds: [],
    totalFilesRepaired: 0,
    finalMatches: false,
    initialFindings: 0,
  }

  if (!plan?.referenceImages?.length) return summary

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const dbFilesForVerify = await db.projectFiles.findByProjectId(projectId)
      const fileList = (dbFilesForVerify || []).map((f) => ({ path: f.path, content: f.content || '' }))
      const verifyResult = await verifyBuild({
        files: fileList,
        referenceImages: plan.referenceImages,
        provider: aiService.provider,
      })

      if (!verifyResult) {
        console.log(`[VisualLoop] Round ${round + 1}: no verdict (skipping loop)`)
        break
      }

      plan.verifyResult = verifyResult
      if (round === 0) summary.initialFindings = verifyResult.findings.length
      yield { event: 'screenshot_verify', data: { ...verifyResult, round: round + 1 } }
      console.log(
        `[VisualLoop] Round ${round + 1}/${MAX_ROUNDS}:`,
        verifyResult.matches ? 'MATCH' : `${verifyResult.findings.length} finding(s)`,
        `(confidence ${Math.round(verifyResult.confidence * 100)}%)`,
      )

      summary.rounds.push({
        round: round + 1,
        findings: verifyResult.findings.length,
        matches: verifyResult.matches,
        confidence: verifyResult.confidence,
        filesRepaired: 0,
      })

      const gate = shouldContinueVisualLoop(verifyResult, round, MAX_ROUNDS)
      if (gate.stop) {
        summary.finalMatches = verifyResult.matches
        if (gate.reason === 'max-rounds') {
          console.log(`[VisualLoop] Max rounds reached with ${verifyResult.findings.length} unresolved finding(s)`)
        } else {
          console.log(`[VisualLoop] Stopping (${gate.reason})`)
        }
        break
      }

      const synthesizedReview = findingsToReviewShape(verifyResult)
      if (synthesizedReview.broken.length === 0) {
        console.log(`[VisualLoop] Round ${round + 1}: no repairable findings (skipping)`)
        break
      }

      yield {
        event: 'status',
        data: {
          stage: 'visual_repair',
          detail: `Round ${round + 1}/${MAX_ROUNDS}: repairing ${synthesizedReview.broken.length} visual mismatch(es)…`,
        },
      }

      const repairFiles = fileList.map((f) => ({ path: f.path, content: f.content, file_type: undefined }))
      const repairGen = repairBuild({
        plan,
        review: synthesizedReview,
        filesBuilt: repairFiles,
        provider: aiService.provider,
        saveFiles: async (files) => aiService.saveFiles(projectId, files, false),
      })
      let repairResult = { filesRepaired: [] }
      while (true) {
        const next = await repairGen.next()
        if (next.done) { repairResult = next.value || repairResult; break }
        yield next.value
      }

      summary.rounds[summary.rounds.length - 1].filesRepaired = repairResult.filesRepaired.length
      summary.totalFilesRepaired += repairResult.filesRepaired.length
      yield { event: 'visual_repair_complete', data: { round: round + 1, filesRepaired: repairResult.filesRepaired } }

      if (repairResult.filesRepaired.length === 0) {
        console.log(`[VisualLoop] Round ${round + 1}: repair made zero changes, exiting loop`)
        break
      }
    }

    if (summary.rounds.length > 0) {
      yield { event: 'visual_loop_summary', data: summary }
      console.log('[VisualLoop] Summary:', JSON.stringify(summary))
    }
  } catch (err) {
    console.warn('[VisualLoop] Skipped due to error:', err.message)
  }

  return summary
}
