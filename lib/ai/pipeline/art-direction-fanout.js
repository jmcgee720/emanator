// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: ART-DIRECTION FAN-OUT ──
// Extracted from message-stream.js Step 1.5. Partitions user uploads by
// role (brand / aesthetic / structural) and fans them out to four
// parallel-intent Vision calls:
//
//   brand      → assets.js              (rendered in generated site)
//   aesthetic  → art direction prose    (planner semantic grounding)
//                + design tokens        (palette / fonts / radius / vibe)
//                + recipe family        (saas-clean / editorial-serif / …)
//   structural → layout blueprint       (section-order / hero-composition / …)
//
// Each call is wrapped in its own try/catch and timing bucket so a
// single failed Vision call never aborts the rest of the fan-out. The
// orchestrator keeps streaming SSE events inline via `yield *`.
// ══════════════════════════════════════════════════════════════════════

import {
  analyzeDesignTokens as _analyzeDesignTokens,
  analyzeLayoutBlueprint as _analyzeLayoutBlueprint,
  classifyRecipeFamily as _classifyRecipeFamily,
} from '../design-tokens.js'
import { mapImageAssets as _mapImageAssets } from '../brief-utils.js'

/**
 * @typedef {Object} ArtDirectionFanoutResult
 * @property {?string} artDirection
 * @property {?Object} designTokens
 * @property {?Object} recipeFamily
 * @property {?Object} layoutBlueprint
 * @property {Array<Object>} imageAssets
 */

/**
 * Fan-out art-direction + design-tokens + recipe-family + layout-blueprint
 * from user attachments. Pushes per-phase timings into `buildTimings`
 * (mutated) and yields the same SSE events the orchestrator used to
 * emit inline.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.attachments - raw attachments from user message
 * @param {Object} opts.provider - LLM provider (has .chat, .chatVisionStructured, etc.)
 * @param {Array<{stage, ms}>} opts.buildTimings - mutated: per-phase ms pushed in
 * @param {Object} [opts.deps] - inject helpers for test override
 * @returns {AsyncGenerator<{event, data}, ArtDirectionFanoutResult>}
 */
export async function* runArtDirectionFanout({ attachments, provider, buildTimings, deps }) {
  const analyzeDesignTokens = deps?.analyzeDesignTokens || _analyzeDesignTokens
  const analyzeLayoutBlueprint = deps?.analyzeLayoutBlueprint || _analyzeLayoutBlueprint
  const classifyRecipeFamily = deps?.classifyRecipeFamily || _classifyRecipeFamily
  const mapImageAssets = deps?.mapImageAssets || _mapImageAssets
  const analyzeArtDirection = deps?.analyzeArtDirection
    || (await import('../art-direction.js')).analyzeArtDirection

  const result = {
    artDirection: null,
    designTokens: null,
    recipeFamily: null,
    layoutBlueprint: null,
    imageAssets: [],
  }

  const tick = (stage, startedAt) => {
    if (Array.isArray(buildTimings)) buildTimings.push({ stage, ms: Date.now() - startedAt })
  }

  const imageAttachments = (attachments || []).filter((a) => a?.type === 'image' && a?.data)
  if (imageAttachments.length === 0) return result

  const brandAttachments      = imageAttachments.filter((a) => !a.role || a.role === 'brand')
  const aestheticAttachments  = imageAttachments.filter((a) => a.role === 'aesthetic')
  const structuralAttachments = imageAttachments.filter((a) => a.role === 'structural')

  // Fallback: no explicit aesthetic uploads → reuse brand uploads for
  // palette/font extraction. Matches legacy single-slot UX behaviour.
  const aestheticForTokens = aestheticAttachments.length > 0 ? aestheticAttachments : brandAttachments

  yield {
    event: 'status',
    data: {
      stage: 'art_direction',
      detail: `Analyzing ${imageAttachments.length} reference image${imageAttachments.length > 1 ? 's' : ''}...`,
    },
  }

  // ── Art direction prose ──
  const __artT = Date.now()
  try {
    result.artDirection = await analyzeArtDirection(aestheticForTokens, provider)
    if (result.artDirection) {
      yield { event: 'art_direction', data: { summary: result.artDirection, imageCount: aestheticForTokens.length } }
    }
  } catch (e) {
    console.warn('[ArtDirectionFanout] Art direction failed, continuing without:', e.message)
  }
  tick('art_direction', __artT)

  // ── Design tokens ──
  const __tokT = Date.now()
  try {
    result.designTokens = await analyzeDesignTokens(aestheticForTokens, provider)
    if (result.designTokens) {
      yield { event: 'design_tokens', data: { tokens: result.designTokens } }
      console.log('[ArtDirectionFanout] Design tokens: vibe=' + result.designTokens.vibe + ' primary=' + result.designTokens.primary)
    }
  } catch (e) {
    console.warn('[ArtDirectionFanout] Design token extraction failed:', e.message)
  }
  tick('design_tokens', __tokT)

  // ── Recipe family ──
  const __famT = Date.now()
  try {
    result.recipeFamily = await classifyRecipeFamily(aestheticForTokens, provider)
    if (result.recipeFamily) {
      yield { event: 'recipe_family', data: result.recipeFamily }
      console.log('[ArtDirectionFanout] Recipe family:', result.recipeFamily.family, `(${result.recipeFamily.confidence.toFixed(2)})`, '—', result.recipeFamily.reason)
    }
  } catch (e) {
    console.warn('[ArtDirectionFanout] Recipe family classifier failed:', e.message)
  }
  tick('recipe_family', __famT)

  // ── Layout blueprint (structural only) ──
  if (structuralAttachments.length > 0) {
    const __bpT = Date.now()
    try {
      result.layoutBlueprint = await analyzeLayoutBlueprint(structuralAttachments, provider)
      if (result.layoutBlueprint) {
        yield {
          event: 'layout_blueprint',
          data: { blueprint: result.layoutBlueprint, sourceCount: structuralAttachments.length },
        }
        console.log('[ArtDirectionFanout] Layout blueprint:', result.layoutBlueprint.sections_order.join(' → '))
      }
    } catch (e) {
      console.warn('[ArtDirectionFanout] Layout blueprint extraction failed:', e.message)
    }
    tick('layout_blueprint', __bpT)
  }

  // ── Brand-asset role tagging ──
  result.imageAssets = mapImageAssets(brandAttachments)

  return result
}
