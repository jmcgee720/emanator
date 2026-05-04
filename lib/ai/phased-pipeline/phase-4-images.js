/**
 * Phase 4: Images
 *
 * Input:   plan.imageManifest + design tokens + optional user reference images
 * Output:  { images: [ { role, dataUrl, subject, source } ] }
 *
 * Generation chain — first success wins, per image:
 *   1) Gemini Nano Banana (gemini-2.5-flash-image-preview) — preferred,
 *      supports reference images for brand-consistent style transfer.
 *   2) OpenAI gpt-image-1 — robust fallback when the user's Google AI
 *      Studio account is on Free tier (which blocks image gen) or any
 *      other Gemini-side outage.
 *   3) Subject-aware stock photo from the curated Unsplash library.
 *      Picks images whose alt text matches the actual subject of the
 *      manifest item — so a coffee shop never gets pizza fallbacks.
 */
import { getStockPhotos, detectImageCategories } from '../image-prefetch.js'

const BATCH_TIMEOUT_MS = 90_000 // 90s for all images — well under 300s function cap

export async function* runPhaseImages(ctx) {
  const { geminiProvider, openaiImageProvider, priorResults, attachments } = ctx
  const plan = priorResults.plan
  const tokens = priorResults.design_tokens?.tokens
  const phaseStart = Date.now()

  if (!plan?.imageManifest?.length) {
    return { images: [], _ms: Date.now() - phaseStart }
  }

  yield {
    event: 'status',
    data: {
      stage: 'images',
      detail: `Generating ${plan.imageManifest.length} custom images via Gemini Nano Banana${openaiImageProvider ? ' (OpenAI fallback ready)' : ''}...`,
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
      subject: base,
      prompt: buildGenPrompt(base, treatment, mood),
    }
  })

  const startedAt = Date.now()
  const watchdog = setTimeout(() => {
    console.warn('[PhaseImages] watchdog fired — some image calls still pending')
  }, BATCH_TIMEOUT_MS)

  const canGemini = typeof geminiProvider?.generateImage === 'function'
  const canOpenAI = typeof openaiImageProvider?.generateImage === 'function'
  if (!canGemini && !canOpenAI) {
    console.warn('[PhaseImages] No image-gen providers available — falling back to stock library')
  }

  // Capture per-image errors so the UI can explain WHY a fallback happened.
  const genErrors = []

  const perImage = prompts.map((p) => generateOneImage({
    placement: p,
    refImages,
    geminiProvider: canGemini ? geminiProvider : null,
    openaiImageProvider: canOpenAI ? openaiImageProvider : null,
    plan,
    genErrors,
  }))

  const settled = await Promise.all(perImage)
  const results = settled.filter(Boolean)
  clearTimeout(watchdog)

  const generatedCount = results.filter((r) => r.source === 'nano_banana').length
  const openaiCount = results.filter((r) => r.source === 'openai_image').length
  const stockCount = results.filter((r) => r.source === 'stock').length

  yield {
    event: 'images_ready',
    data: {
      total: results.length,
      generated: generatedCount,
      openai: openaiCount,
      stock: stockCount,
      ms: Date.now() - startedAt,
    },
  }

  return { images: results, genErrors, _ms: Date.now() - phaseStart }
}

/**
 * Try Gemini → OpenAI → smart stock for a single image. Records
 * granular errors against `genErrors` so the UI can explain fallbacks.
 */
async function generateOneImage({ placement, refImages, geminiProvider, openaiImageProvider, plan, genErrors }) {
  // Attempt 1: Gemini Nano Banana
  if (geminiProvider) {
    try {
      const res = await geminiProvider.generateImage(placement.prompt, { reference_images: refImages })
      if (res?.b64_json) {
        return {
          role: placement.role,
          dataUrl: `data:${res.mimeType || 'image/png'};base64,${res.b64_json}`,
          subject: placement.prompt,
          source: 'nano_banana',
        }
      }
      genErrors.push({ role: placement.role, provider: 'gemini', message: 'no_b64_returned' })
    } catch (err) {
      const msg = err?.user_message || err?.raw_error || err?.message || String(err)
      genErrors.push({ role: placement.role, provider: 'gemini', message: msg })
      console.error(`[PhaseImages] ${placement.role} gemini failed:`, msg)
    }
  }

  // Attempt 2: OpenAI gpt-image-1 (preferred) → falls back to dall-e-3
  // if the OpenAI account hasn't completed organization verification
  // (gpt-image-1 requires it; dall-e-3 doesn't).
  if (openaiImageProvider) {
    const openaiAttempt = await tryOpenAIWithFallback(openaiImageProvider, placement, genErrors)
    if (openaiAttempt) return openaiAttempt
  }

  // Attempt 3: Subject-aware stock fallback
  const stock = pickStockFor(placement, plan)
  if (stock) {
    return { role: placement.role, dataUrl: stock.url, subject: placement.subject || placement.prompt, source: 'stock' }
  }
  return null
}

function pickOpenAISize(role) {
  // gpt-image-1 supports 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape)
  const r = String(role || '').toLowerCase()
  if (r.includes('hero') || r.includes('background') || r.includes('banner')) return '1536x1024'
  if (r.includes('gallery_1') || r.includes('portrait') || r.includes('vertical')) return '1024x1536'
  return '1024x1024'
}

function pickDalleSize(role) {
  // dall-e-3 supports only 1024x1024, 1024x1792 (portrait), 1792x1024 (landscape)
  const r = String(role || '').toLowerCase()
  if (r.includes('hero') || r.includes('background') || r.includes('banner')) return '1792x1024'
  if (r.includes('gallery_1') || r.includes('portrait') || r.includes('vertical')) return '1024x1792'
  return '1024x1024'
}

/**
 * Try gpt-image-1 first, then dall-e-3 if the account isn't verified.
 *
 * gpt-image-1 requires OpenAI organization verification (face/ID scan).
 * dall-e-3 does not. So when gpt-image-1 returns a verification error,
 * we silently retry with dall-e-3 against the same placement.
 *
 * Returns a result object on success, null on total failure.
 */
async function tryOpenAIWithFallback(openaiProvider, placement, genErrors) {
  // Attempt 2a: gpt-image-1 (default)
  try {
    const res = await openaiProvider.generateImage(placement.prompt, {
      size: pickOpenAISize(placement.role),
      quality: 'medium',
    })
    if (res?.b64_json) {
      return { role: placement.role, dataUrl: `data:image/png;base64,${res.b64_json}`, subject: placement.prompt, source: 'openai_image' }
    }
    if (res?.url) {
      return { role: placement.role, dataUrl: res.url, subject: placement.prompt, source: 'openai_image' }
    }
    genErrors.push({ role: placement.role, provider: 'openai', model: 'gpt-image-1', message: 'no_image_in_response' })
  } catch (err) {
    const msg = err?.user_message || err?.raw_error || err?.message || String(err)
    genErrors.push({ role: placement.role, provider: 'openai', model: 'gpt-image-1', message: msg })
    console.error(`[PhaseImages] ${placement.role} gpt-image-1 failed:`, msg)
    // Only retry with dall-e-3 on verification / access errors. Other
    // errors (rate limit, bad prompt, network) won't be helped by the
    // model swap, so let them fall through to stock.
    const looksLikeAccessError = /verify|verifi|access|model|not\s*found|404|403/i.test(msg)
    if (!looksLikeAccessError) return null
  }

  // Attempt 2b: dall-e-3 (no verification required)
  try {
    const res = await openaiProvider.generateImage(placement.prompt, {
      model: 'dall-e-3',
      size: pickDalleSize(placement.role),
      quality: 'standard', // dall-e-3 uses 'standard' or 'hd', not 'medium'
    })
    if (res?.b64_json) {
      return { role: placement.role, dataUrl: `data:image/png;base64,${res.b64_json}`, subject: placement.prompt, source: 'openai_image' }
    }
    if (res?.url) {
      return { role: placement.role, dataUrl: res.url, subject: placement.prompt, source: 'openai_image' }
    }
    genErrors.push({ role: placement.role, provider: 'openai', model: 'dall-e-3', message: 'no_image_in_response' })
  } catch (err) {
    const msg = err?.user_message || err?.raw_error || err?.message || String(err)
    genErrors.push({ role: placement.role, provider: 'openai', model: 'dall-e-3', message: msg })
    console.error(`[PhaseImages] ${placement.role} dall-e-3 failed:`, msg)
  }

  return null
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

/**
 * Pick a stock image whose alt text best matches the actual subject of
 * the manifest item. Falls back to brand-category match, then abstract.
 *
 * Why: previously a coffee-shop brief would route through `food` and
 * return random pizza/salad photos for *every* role. Now we score each
 * candidate against the per-image subject keywords first.
 */
function pickStockFor(placement, plan) {
  const subjectText = String(placement.subject || placement.prompt || '').toLowerCase()
  const brandText = [plan?.brand?.name, plan?.brand?.tagline, plan?.archetype, plan?.brand?.audience]
    .filter(Boolean).join(' ').toLowerCase()

  // Priority 1: detect categories from the per-image SUBJECT, not just the brand
  let categories = detectImageCategories(subjectText)
  // Priority 2: fall back to brand-level categories
  if (categories.length === 0) categories = detectImageCategories(brandText)
  // Priority 3: abstract
  if (categories.length === 0) categories.push('abstract')

  // Pull a generous candidate pool, then score each against subject keywords
  const candidates = getStockPhotos(categories, 6)
  if (candidates.length === 0) return null

  const subjectTokens = subjectText.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
  let best = candidates[0]
  let bestScore = -1
  for (const c of candidates) {
    const altLower = String(c.alt || '').toLowerCase()
    let score = 0
    for (const tok of subjectTokens) {
      if (altLower.includes(tok)) score += 2
    }
    // Add a small random tiebreaker so identical scores rotate across roles
    score += Math.random() * 0.1
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
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
