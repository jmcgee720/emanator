/**
 * Phase 4: Images
 *
 * Input:   plan.imageManifest + design tokens + optional user reference images
 * Output:  { images: [ { role, dataUrl, subject } ] }
 *
 * Uses Gemini Nano Banana (gemini-2.5-flash-image-preview) to generate
 * every image in parallel. User-uploaded brand assets are passed as
 * reference_images so the AI matches the brand's existing look.
 *
 * On failure per-image: falls back to the curated stock photo library
 * (getStockPhotos) so a partial Gemini outage doesn't kill the whole run.
 */
import { getStockPhotos, detectImageCategories } from '../image-prefetch.js'

const BATCH_TIMEOUT_MS = 90_000 // 90s for all images — well under 300s function cap

export async function* runPhaseImages(ctx) {
  const { geminiProvider, priorResults, attachments } = ctx
  const plan = priorResults.plan
  const tokens = priorResults.design_tokens?.tokens
  const phaseStart = Date.now()

  if (!plan?.imageManifest?.length) {
    // No images requested — short-circuit
    return { images: [], _ms: Date.now() - phaseStart }
  }

  yield {
    event: 'status',
    data: {
      stage: 'images',
      detail: `Generating ${plan.imageManifest.length} custom images via Gemini Nano Banana...`,
    },
  }

  // Build reference-image array from user-uploaded brand assets
  const refImages = (attachments || [])
    .filter((a) => a?.type === 'image' && a?.data)
    .slice(0, 3) // Nano Banana handles up to 3 refs well
    .map((a) => ({
      data: stripDataUrlPrefix(a.data),
      mimeType: a.mimeType || inferMimeType(a.data) || 'image/png',
    }))

  // Build per-image prompts using brand + treatment + subject
  const prompts = plan.imageManifest.map((item) => {
    const base = item.subject
    const treatment = tokens?.imageryTreatment || 'photographic_warm'
    const mood = plan.brand?.mood || 'natural'
    return {
      role: item.role,
      prompt: buildGenPrompt(base, treatment, mood),
    }
  })

  // Emit progress as each image completes (best-effort, via per-image Promises)
  const results = []
  const startedAt = Date.now()
  const watchdog = setTimeout(() => {
    console.warn('[PhaseImages] watchdog fired — some image calls still pending')
  }, BATCH_TIMEOUT_MS)

  // Check provider supports generateImage — if not (e.g. user picked Claude and we
  // don't have a Gemini provider), we return stock photos only.
  const canGenerate = typeof geminiProvider?.generateImage === 'function'
  if (!canGenerate) {
    console.warn('[PhaseImages] No Gemini provider — falling back to stock library')
  }

  const perImage = prompts.map((p) =>
    (canGenerate
      ? geminiProvider.generateImage(p.prompt, { reference_images: refImages })
        .then((res) => {
          if (res?.b64_json) {
            return {
              role: p.role,
              dataUrl: `data:${res.mimeType || 'image/png'};base64,${res.b64_json}`,
              subject: p.prompt,
              source: 'nano_banana',
            }
          }
          throw new Error('no_b64_returned')
        })
      : Promise.reject(new Error('no_gemini_provider'))
    ).catch((err) => {
      console.warn(`[PhaseImages] ${p.role} gen failed (${err.message}) — using stock fallback`)
      const stock = pickStockFor(p.role, plan, 1)[0]
      return stock
        ? { role: p.role, dataUrl: stock.url, subject: p.prompt, source: 'stock' }
        : null
    })
  )

  const settled = await Promise.all(perImage)
  for (const item of settled) {
    if (item) results.push(item)
  }
  clearTimeout(watchdog)

  const generatedCount = results.filter((r) => r.source === 'nano_banana').length
  const stockCount = results.filter((r) => r.source === 'stock').length

  yield {
    event: 'images_ready',
    data: {
      total: results.length,
      generated: generatedCount,
      stock: stockCount,
      ms: Date.now() - startedAt,
    },
  }

  return { images: results, _ms: Date.now() - phaseStart }
}

function buildGenPrompt(subject, treatment, mood) {
  const styleHints = {
    photographic_warm: 'Warm photographic style, natural morning light, soft focus background, film grain, muted earth tones. Shot on Fujifilm medium format.',
    photographic_editorial: 'High-end editorial photography, black and white or desaturated, dramatic contrast, elegant composition, magazine-quality.',
    illustrated_playful: 'Flat illustration style, bold colors, rounded shapes, expressive, friendly, modern editorial illustration aesthetic.',
    minimal_product: 'Clean product photography, white background, crisp shadow, centered composition, catalog-quality, minimal styling.',
    technical_abstract: 'Abstract technical rendering, geometric, gradient accents, holographic or neon accents, futuristic, cinematic.',
  }
  const style = styleHints[treatment] || styleHints.photographic_warm
  return `${subject}. ${style} Visual mood: ${mood}. Ultra high quality, wide aspect ratio suitable for a website hero or content card. No text, no watermarks, no logos.`
}

function pickStockFor(role, plan, count) {
  const brief = [plan?.brand?.name, plan?.brand?.tagline, plan?.archetype, plan?.brand?.audience].filter(Boolean).join(' ')
  const categories = detectImageCategories(brief)
  if (categories.length === 0) categories.push('abstract')
  return getStockPhotos(categories, count)
}

function stripDataUrlPrefix(s) {
  if (!s) return ''
  const m = String(s).match(/^data:[^;]+;base64,(.+)$/)
  return m ? m[1] : String(s)
}

function inferMimeType(data) {
  if (!data) return null
  const m = String(data).match(/^data:([^;]+);base64,/)
  return m ? m[1] : null
}
