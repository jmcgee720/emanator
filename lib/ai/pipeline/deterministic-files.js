// ══════════════════════════════════════════════════════════════════════
// ── PIPELINE: DETERMINISTIC-FILE EMITTERS ──
// Extracted from message-stream.js Steps 3a/3b/3c. Three independent
// file emitters that run BEFORE the builder waves so the LLM receives
// a project scaffold it can simply `import` from, not re-implement.
//
//   Step 3a — components/theme.js (CSS variables from design tokens)
//   Step 3b — components/assets.js + SSE brand-VFS map
//   Step 3c — components/primitives/{Hero,FeatureGrid,Pricing,…}.jsx
//
// Each emitter is defensive — non-blocking on failure, idempotent on
// re-invocation. The orchestrator delegates the whole block as a single
// `yield* emitDeterministicFiles(...)` call.
// ══════════════════════════════════════════════════════════════════════

import { buildThemeFile as _buildThemeFile } from '../design-tokens.js'
import {
  buildAssetsFileContent as _buildAssetsFileContent,
  buildBrandVfsMap as _buildBrandVfsMap,
} from '../brief-utils.js'
import { buildPrimitiveFiles as _buildPrimitiveFiles } from '../primitives.js'
import { buildStripeFiles as _buildStripeFiles, needsCommerceTemplates as _needsCommerceTemplates } from '../commerce-templates.js'

/**
 * Emit every deterministic (non-LLM) file the pipeline produces for
 * the project scaffold: theme, assets, VFS map, primitives. Runs in a
 * fixed order so downstream dependencies (primitives importing from
 * ../assets, theme) resolve cleanly.
 *
 * Mutates `plan.primitivesEmitted` with the emitted paths so the
 * builder prompt knows which primitive files to import.
 *
 * @param {Object} opts
 * @param {Object} opts.plan - the build plan (mutated: primitivesEmitted)
 * @param {Array<Object>} opts.imageAssets - role-tagged brand assets
 * @param {string} opts.projectId
 * @param {Object} opts.aiService - needs saveFiles(projectId, files, flag)
 * @param {Object} [opts.deps] - inject emit helpers for tests
 * @returns {AsyncGenerator<{event, data}>}
 */
export async function* emitDeterministicFiles({ plan, imageAssets, projectId, aiService, deps }) {
  const buildThemeFile = deps?.buildThemeFile || _buildThemeFile
  const buildAssetsFileContent = deps?.buildAssetsFileContent || _buildAssetsFileContent
  const buildBrandVfsMap = deps?.buildBrandVfsMap || _buildBrandVfsMap
  const buildPrimitiveFiles = deps?.buildPrimitiveFiles || _buildPrimitiveFiles
  const buildStripeFiles = deps?.buildStripeFiles || _buildStripeFiles
  const needsCommerceTemplates = deps?.needsCommerceTemplates || _needsCommerceTemplates

  // Step 3a — components/theme.js
  try {
    const themeContent = buildThemeFile(plan.designTokens)
    await aiService.saveFiles(projectId, [{ path: 'components/theme.js', content: themeContent }], false)
    console.log('[DeterministicFiles] Emitted theme.js (vibe:', plan.designTokens?.vibe || 'default', ')')
  } catch (e) {
    console.warn('[DeterministicFiles] Failed to emit theme.js:', e.message)
  }

  // Step 3b — components/assets.js + brand-VFS SSE map
  if (Array.isArray(imageAssets) && imageAssets.length > 0) {
    try {
      const assetsContent = buildAssetsFileContent(imageAssets)
      await aiService.saveFiles(projectId, [{ path: 'components/assets.js', content: assetsContent }], false)
      console.log('[DeterministicFiles] Emitted assets.js with', imageAssets.length, 'data URLs')

      const vfsMap = buildBrandVfsMap(imageAssets)
      if (vfsMap.length > 0) {
        yield { event: 'generated_images_map', data: { images: vfsMap, source: 'brand_vfs' } }
        console.log('[DeterministicFiles] Emitted brand VFS map with', vfsMap.length, 'paths')
      }
    } catch (e) {
      console.warn('[DeterministicFiles] Failed to emit assets.js:', e.message)
    }
  }

  // Step 3c — components/primitives/*.jsx (Session 30+33)
  if (plan.layoutBlueprint) {
    try {
      const hasHeroAsset = (imageAssets || []).some((a) => a.role === 'hero' || a.role === 'photo')
      const primitiveFiles = buildPrimitiveFiles(plan.layoutBlueprint, plan.brand, { hasHeroAsset })
      if (primitiveFiles.length > 0) {
        await aiService.saveFiles(projectId, primitiveFiles, false)
        console.log('[DeterministicFiles] Emitted', primitiveFiles.length, 'primitive file(s) from blueprint')
        plan.primitivesEmitted = primitiveFiles.map((f) => f.path)
      }
    } catch (e) {
      console.warn('[DeterministicFiles] Failed to emit primitive files:', e.message)
    }
  }

  // Step 3d — Stripe Checkout scaffolding (P3 backlog, gated by
  // commerce signal). Ships a server-side pricing registry, a checkout
  // route, a payment-status poller, and a PricingButton component. The
  // generated project still needs its own STRIPE_API_KEY at deploy time.
  if (needsCommerceTemplates({ archetype: plan.archetype, brief: plan.brief })) {
    try {
      const stripeFiles = buildStripeFiles(plan)
      if (stripeFiles.length > 0) {
        await aiService.saveFiles(projectId, stripeFiles, false)
        console.log('[DeterministicFiles] Emitted', stripeFiles.length, 'Stripe commerce file(s)')
        plan.commerceEmitted = stripeFiles.map((f) => f.path)
      }
    } catch (e) {
      console.warn('[DeterministicFiles] Failed to emit Stripe files:', e.message)
    }
  }
}
