/**
 * Phased Build Pipeline
 *
 * Replaces the monolithic runNewBriefPipeline with 6 focused phases:
 *
 *   1. Plan        — archetype, section blueprint, image manifest
 *   2. Copy        — all written content (headlines, features, testimonials, etc.)
 *   3. DesignTokens — palette, typography, spacing, imagery treatment
 *   4. Images      — parallel Nano Banana generation from manifest + refs
 *   5. Compose     — stitch plan + copy + tokens + image URLs into JSX
 *   6. Polish      — responsive, hover states, a11y, nav wiring
 *
 * Each phase is a separate LLM call with its own focused prompt. State is
 * persisted between phases in MongoDB (`phase_states` collection) so
 * the pipeline is resumable and every phase fits well under Vercel's 300s
 * function limit.
 *
 * No hardcoded recipes — the AI composes from first principles using the
 * brand's actual mood/subject/brief.
 */
import { runPhasePlan } from './phase-1-plan.js'
import { runPhaseCopy } from './phase-2-copy.js'
import { runPhaseDesignTokens } from './phase-3-design-tokens.js'
import { runPhaseImages } from './phase-4-images.js'
import { runPhaseCompose } from './phase-5-compose.js'
import { runPhasePolish } from './phase-6-polish.js'

/**
 * Orchestrator — async generator that yields SSE-shaped events.
 * Each phase yields its own fine-grained events plus we emit phase boundaries.
 *
 * @param {object} ctx
 * @param {object} ctx.aiService   — service with logGenerationRun
 * @param {object} ctx.provider    — LLM provider (Claude/OpenAI) for text phases
 * @param {object} ctx.geminiProvider — Gemini provider for phase 4 images
 * @param {string} ctx.projectId
 * @param {string} ctx.chatId
 * @param {string} ctx.userId
 * @param {object} ctx.brief       — parsed brief from InlineBrief form or free-text
 * @param {Array}  ctx.attachments — user-uploaded reference images / brand assets
 * @param {object} ctx.db          — mongo collections: projectFiles, phaseStates
 * @param {string} ctx.runId
 */
export async function* runPhasedPipeline(ctx) {
  const { projectId, chatId, userId, runId, db } = ctx
  const pipelineStart = Date.now()

  // Persist a run record we update after each phase — lets us resume later if needed.
  const phaseState = {
    runId,
    projectId,
    chatId,
    userId,
    startedAt: new Date(),
    phase: 'starting',
    results: {}, // filled as each phase returns
  }
  await db.phaseStates.upsertByRunId(runId, phaseState)

  const phases = [
    { id: 'plan',          label: 'Planning structure',  fn: runPhasePlan },
    { id: 'copy',          label: 'Writing copy',         fn: runPhaseCopy },
    { id: 'design_tokens', label: 'Choosing palette + typography', fn: runPhaseDesignTokens },
    { id: 'images',        label: 'Generating imagery',   fn: runPhaseImages },
    { id: 'compose',       label: 'Composing pages',      fn: runPhaseCompose },
    { id: 'polish',        label: 'Polishing details',    fn: runPhasePolish },
  ]

  try {
    for (const phase of phases) {
      yield { event: 'phase_start', data: { id: phase.id, label: phase.label, index: phases.indexOf(phase) + 1, total: phases.length } }
      const phaseStart = Date.now()
      try {
        const result = yield* phase.fn({ ...ctx, priorResults: phaseState.results })
        phaseState.results[phase.id] = result
        phaseState.phase = phase.id
        await db.phaseStates.upsertByRunId(runId, phaseState)
        yield { event: 'phase_done', data: { id: phase.id, ms: Date.now() - phaseStart } }
      } catch (err) {
        console.error(`[PhasedPipeline] phase '${phase.id}' threw:`, err.message)
        yield { event: 'phase_error', data: { id: phase.id, message: err.message, recoverable: false } }
        phaseState.phase = `${phase.id}_error`
        phaseState.error = err.message
        await db.phaseStates.upsertByRunId(runId, phaseState)
        yield { event: 'error', data: { message: `Build failed in ${phase.label.toLowerCase()} phase: ${err.message}`, error_type: 'phase_error', phase: phase.id } }
        await ctx.aiService.logGenerationRun({
          id: runId,
          project_id: projectId,
          chat_id: chatId,
          user_id: userId,
          tool_mode: `phased_abort_${phase.id}`,
          files_generated: 0,
          duration: Date.now() - pipelineStart,
          success: false,
          provider: ctx.provider?.providerName || 'unknown',
          model: ctx.provider?.model || 'unknown',
        })
        return { handled: true, aborted: true, lastPhase: phase.id }
      }
    }

    // Happy path — all phases done. Compose wrote files; polish amended them.
    const filesSaved = (phaseState.results.polish?.files || phaseState.results.compose?.files || []).length
    yield { event: 'complete', data: { files_generated: filesSaved, duration: Date.now() - pipelineStart } }

    await ctx.aiService.logGenerationRun({
      id: runId,
      project_id: projectId,
      chat_id: chatId,
      user_id: userId,
      tool_mode: 'phased_pipeline',
      files_generated: filesSaved,
      duration: Date.now() - pipelineStart,
      success: true,
      provider: ctx.provider?.providerName || 'unknown',
      model: ctx.provider?.model || 'unknown',
      pipeline_meta: {
        archetype: phaseState.results.plan?.archetype,
        imagesGenerated: phaseState.results.images?.images?.length || 0,
        phaseDurations: Object.fromEntries(
          phases.map((p) => [p.id, phaseState.results[p.id]?._ms || null])
        ),
      },
    })

    return { handled: true, aborted: false }
  } catch (err) {
    console.error('[PhasedPipeline] orchestrator crash:', err.message, err.stack)
    yield { event: 'error', data: { message: `Build pipeline crashed: ${err.message}`, error_type: 'orchestrator_crash' } }
    return { handled: true, aborted: true, lastPhase: 'orchestrator' }
  }
}
