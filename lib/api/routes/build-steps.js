/**
 * Stepped Build Pipeline — 5 discrete API endpoints
 *
 *   POST /api/build/plan       { projectId, chatId, message, attachments } → { runId, plan }
 *   POST /api/build/copy       { runId }                                     → { copy }
 *   POST /api/build/tokens     { runId }                                     → { tokens }
 *   POST /api/build/images     { runId }                                     → { imageCount, imagesStockFallback }
 *   POST /api/build/compose    { runId }                                     → { fileCount, files: [{path,size}] }
 *   GET  /api/build/state      ?runId=X                                      → { phase, results, error }
 *
 * Each endpoint runs ONE phase and persists output via `phase_states`
 * collection. The frontend calls them sequentially (or auto-advances),
 * showing per-phase previews to the user. Replaces the 5-minute streaming
 * monolith with 5 x ~60s calls.
 */
import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db as supaDb } from '@/lib/supabase/db'
import { runPhasePlan } from '@/lib/ai/phased-pipeline/phase-1-plan'
import { runPhaseCopy } from '@/lib/ai/phased-pipeline/phase-2-copy'
import { runPhaseDesignTokens } from '@/lib/ai/phased-pipeline/phase-3-design-tokens'
import { runPhaseImages } from '@/lib/ai/phased-pipeline/phase-4-images'
import { runPhaseCompose } from '@/lib/ai/phased-pipeline/phase-5-compose'
import { phaseStates } from '@/lib/ai/phased-pipeline/phase-states'
import { AIService } from '@/lib/ai/service'
import { GeminiProvider } from '@/lib/ai/providers/gemini'
import { OpenAIProvider } from '@/lib/ai/providers/openai'

/**
 * Run an async-generator phase to completion, collecting events and returning
 * the final yielded value. Swallows each event to a local array the caller can
 * inspect if needed (we currently don't surface them — the HTTP response gives
 * just the final state, which is fine for the stepped UX since the user sees
 * each phase's result in its own chat bubble).
 */
async function drainPhase(gen) {
  const events = []
  let result = null
  while (true) {
    const { value, done } = await gen.next()
    if (done) {
      result = value
      break
    }
    events.push(value)
  }
  return { result, events }
}

function buildProvider(authUser, provider, model) {
  // Derive AIService from user's selected provider/model. Positional
  // constructor: (providerName, model). Falls back to Claude Sonnet 4.5.
  const svc = new AIService(provider || 'anthropic', model || 'claude-sonnet-4-5-20250929')
  // Build phases don't go through credit-metered chat endpoints, but AIService
  // guards every provider call behind approveCreditGate(). Approve here so the
  // provider is usable by the phase functions below.
  svc.approveCreditGate()
  return svc
}

function buildGeminiProvider() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!key) {
    console.warn('[build-steps] GEMINI_API_KEY not configured — Phase 4 will use stock fallback')
    return null
  }
  // Use stable model name (preview was deprecated by Google in mid-2025).
  // Override per-deployment with GEMINI_MODEL_IMAGE if Google releases a newer one.
  const model = process.env.GEMINI_MODEL_IMAGE || 'gemini-2.5-flash-image'
  return new GeminiProvider(key, model, {})
}

function buildOpenAIImageProvider() {
  // Used as image-gen fallback when Gemini Nano Banana is unavailable.
  // Default to gpt-image-1; if the user's account hasn't completed
  // organization verification, runPhaseImages will retry with dall-e-3
  // (which has no verification requirement).
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    console.warn('[build-steps] OPENAI_API_KEY not configured — no image fallback before stock')
    return null
  }
  return new OpenAIProvider(key, process.env.OPENAI_MODEL_IMAGE || 'gpt-image-1', {})
}

function parseBriefFromMessage(message) {
  const text = String(message || '').trim()
  const extract = (label) => {
    const regex = new RegExp(label.replace(/[()]/g, '\\$&') + ':\\s*(.+?)(?:\\n[A-Z]|$)', 's')
    const m = text.match(regex)
    return m ? m[1].trim() : ''
  }
  const hasLabeledFields = /Brand name.*:|Project description:|Pages to build:|Must-have features:/i.test(text)
  let derivedName = ''
  if (!hasLabeledFields && text.length > 0 && text.length < 400) {
    const forMatch = text.match(/\bfor\s+(?:a|an|the)?\s*([^.!?\n]{3,60})/i)
    if (forMatch) derivedName = forMatch[1].trim().replace(/^(a|an|the)\s+/i, '')
    else {
      derivedName = text
        .replace(/^(build|create|make|design|generate)\s+(a|an|the)?\s*/i, '')
        .replace(/\b(landing\s*page|site|website|app|dashboard|platform|tool|page)\b/gi, '')
        .replace(/\s+/g, ' ').trim().slice(0, 60)
    }
  }
  return {
    rawMessage: text,
    brandName: extract('Brand name (MUST use this exact name throughout the UI)') || extract('Brand name') || extract('Project name') || derivedName,
    projectDesc: extract('Project description') || extract('Project') || (!hasLabeledFields ? text : ''),
    colorDirection: extract('Color direction') || extract('Colors') || '',
    mustHaveFeatures: extract('Must-have features (implement ALL of these with full UI)') || extract('Must-have features') || '',
    heroHeadline: extract('Hero headline/tagline') || extract('Headline/tagline') || '',
    keyMessaging: extract('Key messaging to weave throughout') || extract('Key messaging') || '',
    pagesNeeded: extract('Pages to build (create navigation between these)') || extract('Pages to build') || extract('Pages needed') || '',
    mostImportantPage: extract('Most important page (build this with the most detail)') || extract('Most important page') || '',
    referencesSites: extract('Design references (match this quality/style)') || extract('Design references') || extract('Reference sites') || '',
    thingsToAvoid: extract('AVOID these (critical)') || extract('Avoid') || '',
    toneOfVoice: extract('Tone of voice') || extract('Tone') || '',
    targetAudience: extract('Target audience') || '',
  }
}

async function requireAuthedUser(request) {
  const authUser = await getAuthUser(request)
  if (!authUser) return { err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return { err: NextResponse.json({ error: 'Access denied' }, { status: 403 }) }
  return { authUser, dbUser }
}

export async function handle(route, method, path, request) {
  // GET /api/build/state?runId=X — frontend polls this on refresh/resume
  if (route === '/build/state' && method === 'GET') {
    const { err } = await requireAuthedUser(request)
    if (err) return handleCORS(err)
    const url = new URL(request.url)
    const runId = url.searchParams.get('runId')
    if (!runId) return handleCORS(NextResponse.json({ error: 'runId required' }, { status: 400 }))
    const state = await phaseStates.findByRunId(runId)
    return handleCORS(NextResponse.json(state || { error: 'not_found' }))
  }

  // GET /api/build/ping-nano-banana — diagnostic: tests Gemini image gen with
  // a trivial prompt so we can tell WHY images fall back to stock. Also
  // probes the OpenAI image-gen fallback so the user knows whether image
  // generation will work end-to-end even if Gemini is blocked.
  if (route === '/build/ping-nano-banana' && method === 'GET') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)

    const result = {
      gemini: { ok: false, step: 'not_attempted', message: '' },
      openai: { ok: false, step: 'not_attempted', message: '' },
    }

    // ── Gemini probe ──────────────────────────────────────────────
    const geminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
    if (!geminiKey) {
      result.gemini = { ok: false, step: 'env', message: 'Neither GEMINI_API_KEY nor GOOGLE_API_KEY is set in Vercel env.' }
    } else {
      const geminiProvider = buildGeminiProvider()
      try {
        const t0 = Date.now()
        const res = await geminiProvider.generateImage('A single red coffee bean on a white background. Studio lighting. Macro shot.', {})
        const elapsed = Date.now() - t0
        if (res?.b64_json) {
          result.gemini = { ok: true, step: 'gen_ok', elapsedMs: elapsed, model: res.model, mimeType: res.mimeType, bytes: res.b64_json.length, message: `Nano Banana returned ${res.b64_json.length} bytes in ${elapsed}ms.` }
        } else {
          result.gemini = { ok: false, step: 'no_image_in_response', elapsedMs: elapsed, message: 'Gemini responded but did not include inline image data. Account may be Free tier.' }
        }
      } catch (err) {
        const msg = err?.user_message || err?.raw_error || err?.message || String(err)
        const status = err?.status_code || err?.status || null
        result.gemini = {
          ok: false,
          step: 'api_error',
          status,
          message: msg,
          hint: status === 403 || /permission|access/i.test(msg)
            ? 'Free-tier Google AI Studio account — image gen blocked. OpenAI fallback will handle it.'
            : status === 429 ? 'Rate limit hit — retry in a minute.'
            : 'Unknown Gemini error.',
        }
      }
    }

    // ── OpenAI probe (fallback path) ──────────────────────────────
    const openaiKey = !!process.env.OPENAI_API_KEY
    if (!openaiKey) {
      result.openai = { ok: false, step: 'env', message: 'OPENAI_API_KEY not set in Vercel env — no fallback before stock.' }
    } else {
      const openaiProvider = buildOpenAIImageProvider()
      // Try gpt-image-1 first
      try {
        const t0 = Date.now()
        const res = await openaiProvider.generateImage('A single red coffee bean on a white background. Studio lighting. Macro shot.', { size: '1024x1024', quality: 'medium' })
        const elapsed = Date.now() - t0
        if (res?.b64_json || res?.url) {
          result.openai = { ok: true, step: 'gen_ok', model: 'gpt-image-1', elapsedMs: elapsed, message: `gpt-image-1 returned ${res.b64_json ? res.b64_json.length + ' bytes' : 'a URL'} in ${elapsed}ms.` }
        } else {
          result.openai = { ok: false, step: 'no_image_in_response', model: 'gpt-image-1', elapsedMs: elapsed, message: 'OpenAI responded with no image data.' }
        }
      } catch (gptImageErr) {
        const gptMsg = gptImageErr?.user_message || gptImageErr?.raw_error || gptImageErr?.message || String(gptImageErr)
        // Retry with dall-e-3 — no verification required
        try {
          const t1 = Date.now()
          const res = await openaiProvider.generateImage('A single red coffee bean on a white background. Studio lighting. Macro shot.', { model: 'dall-e-3', size: '1024x1024', quality: 'standard' })
          const elapsed = Date.now() - t1
          if (res?.b64_json || res?.url) {
            result.openai = { ok: true, step: 'gen_ok_dalle', model: 'dall-e-3', elapsedMs: elapsed, gptImageError: gptMsg, message: `gpt-image-1 unavailable (${gptMsg.slice(0, 80)}). Fell back to dall-e-3 — returned in ${elapsed}ms.` }
          } else {
            result.openai = { ok: false, step: 'no_image_in_response', model: 'dall-e-3', message: 'dall-e-3 responded with no image data.' }
          }
        } catch (dalleErr) {
          const dalleMsg = dalleErr?.user_message || dalleErr?.raw_error || dalleErr?.message || String(dalleErr)
          result.openai = { ok: false, step: 'api_error', message: `gpt-image-1: ${gptMsg} | dall-e-3: ${dalleMsg}` }
        }
      }
    }

    // Roll up overall status
    const ok = result.gemini.ok || result.openai.ok
    return handleCORS(NextResponse.json({
      ok,
      summary: ok
        ? `Image generation IS working (${result.gemini.ok ? 'Gemini' : 'OpenAI fallback'})`
        : 'BOTH Gemini and OpenAI image generation failed — phase 4 will fall back to subject-aware stock photos.',
      providers: result,
    }))
  }

  // POST /api/build/edit — user-supplied tweaks to a completed phase's
  // result (e.g. rename brand, adjust palette hex, edit hero headline).
  // Body: { runId, phase, edits: { ...patch } }
  // The patch is shallow-merged into state.results[phase].* — for nested
  // structures (like copy[pageId][section][field]) the client sends the
  // full nested object back, we don't deep-merge.
  //
  // Allowed phases for editing: plan, copy, design_tokens, images.
  // Cannot edit `compose` (it produces files, not editable JSON).
  if (route === '/build/edit' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const { runId, phase, edits } = await request.json()
      if (!runId || !phase || !edits || typeof edits !== 'object') {
        return handleCORS(NextResponse.json({ error: 'runId, phase, and edits are required' }, { status: 400 }))
      }
      const ALLOWED = ['plan', 'copy', 'design_tokens', 'images']
      if (!ALLOWED.includes(phase)) {
        return handleCORS(NextResponse.json({ error: `phase must be one of ${ALLOWED.join(', ')}` }, { status: 400 }))
      }
      const state = await phaseStates.findByRunId(runId)
      if (!state) return handleCORS(NextResponse.json({ error: 'run not found' }, { status: 404 }))
      if (state.userId !== (auth.authUser.id || auth.authUser.sub)) {
        return handleCORS(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
      }
      if (!state.results?.[phase]) {
        return handleCORS(NextResponse.json({ error: `phase ${phase} not complete — nothing to edit` }, { status: 400 }))
      }

      // Shallow-merge edits onto the phase result. The client is expected
      // to send full sub-objects (e.g. the entire `copy.copy` block) when
      // a nested field changes — keeps server logic simple.
      state.results[phase] = { ...state.results[phase], ...edits }
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(runId, state)
      return handleCORS(NextResponse.json({ runId, phase, edited: true, result: state.results[phase] }))
    } catch (e) {
      console.error('[build/edit] failed:', e.message)
      return handleCORS(NextResponse.json({ error: e.message }, { status: 500 }))
    }
  }


  if (route === '/build/plan' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const body = await request.json()
      const { projectId, chatId, message, attachments = [], provider, model } = body
      if (!projectId || !message) {
        return handleCORS(NextResponse.json({ error: 'projectId and message are required' }, { status: 400 }))
      }
      const runId = `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const aiService = buildProvider(auth.authUser, provider, model)
      const brief = parseBriefFromMessage(message)

      const { result } = await drainPhase(runPhasePlan({
        provider: aiService.provider,
        brief,
        attachments,
      }))

      const state = {
        runId,
        projectId,
        chatId: chatId || null,
        userId: auth.authUser.id || auth.authUser.sub,
        phase: 'plan',
        results: { plan: result },
        brief,
        attachments: (attachments || []).filter((a) => a?.type === 'image' && a?.data).map((a) => ({ type: 'image', data: a.data, mimeType: a.mimeType })),
        provider: provider || 'anthropic',
        model: model || 'claude-sonnet-4-5-20250929',
        startedAt: new Date(),
        updatedAt: new Date(),
      }
      await phaseStates.upsertByRunId(runId, state)

      return handleCORS(NextResponse.json({
        runId,
        plan: result,
        nextStep: { id: 'copy', label: 'Write copy', endpoint: '/api/build/copy' },
      }))
    } catch (e) {
      console.error('[build/plan] failed:', e.message)
      return handleCORS(NextResponse.json({ error: e.message, phase: 'plan' }, { status: 500 }))
    }
  }

  if (route === '/build/copy' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const body = await request.json()
      const { runId } = body
      const state = await phaseStates.findByRunId(runId)
      if (!state) return handleCORS(NextResponse.json({ error: 'run not found' }, { status: 404 }))
      if (state.userId !== (auth.authUser.id || auth.authUser.sub)) return handleCORS(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
      if (!state.results?.plan) return handleCORS(NextResponse.json({ error: 'plan phase not complete' }, { status: 400 }))

      const aiService = buildProvider(auth.authUser, state.provider, state.model)
      const { result } = await drainPhase(runPhaseCopy({
        provider: aiService.provider,
        priorResults: state.results,
      }))

      state.results.copy = result
      state.phase = 'copy'
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(runId, state)

      return handleCORS(NextResponse.json({
        runId,
        copy: result.copy,
        sections: Object.keys(result.copy || {}),
        nextStep: { id: 'design_tokens', label: 'Pick palette + typography', endpoint: '/api/build/tokens' },
      }))
    } catch (e) {
      console.error('[build/copy] failed:', e.message)
      return handleCORS(NextResponse.json({ error: e.message, phase: 'copy' }, { status: 500 }))
    }
  }

  if (route === '/build/tokens' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const { runId } = await request.json()
      const state = await phaseStates.findByRunId(runId)
      if (!state) return handleCORS(NextResponse.json({ error: 'run not found' }, { status: 404 }))
      if (state.userId !== (auth.authUser.id || auth.authUser.sub)) return handleCORS(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
      if (!state.results?.copy) return handleCORS(NextResponse.json({ error: 'copy phase not complete' }, { status: 400 }))

      const aiService = buildProvider(auth.authUser, state.provider, state.model)
      const { result } = await drainPhase(runPhaseDesignTokens({
        provider: aiService.provider,
        priorResults: state.results,
      }))

      state.results.design_tokens = result
      state.phase = 'design_tokens'
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(runId, state)

      return handleCORS(NextResponse.json({
        runId,
        tokens: result.tokens,
        nextStep: { id: 'images', label: 'Generate imagery', endpoint: '/api/build/images' },
      }))
    } catch (e) {
      console.error('[build/tokens] failed:', e.message)
      return handleCORS(NextResponse.json({ error: e.message, phase: 'design_tokens' }, { status: 500 }))
    }
  }

  if (route === '/build/images' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const { runId } = await request.json()
      const state = await phaseStates.findByRunId(runId)
      if (!state) return handleCORS(NextResponse.json({ error: 'run not found' }, { status: 404 }))
      if (state.userId !== (auth.authUser.id || auth.authUser.sub)) return handleCORS(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
      if (!state.results?.design_tokens) return handleCORS(NextResponse.json({ error: 'design_tokens phase not complete' }, { status: 400 }))

      const geminiProvider = buildGeminiProvider()
      const openaiImageProvider = buildOpenAIImageProvider()

      const { result } = await drainPhase(runPhaseImages({
        geminiProvider,
        openaiImageProvider,
        priorResults: state.results,
        attachments: state.attachments || [],
      }))

      // Persist image dataUrls in the dedicated phase_images collection
      // (one doc per image so we never blow past Mongo's 16 MB doc cap).
      // The state row keeps only metadata (role, source, subject).
      await phaseStates.saveImagesForRun(runId, result.images)
      state.results.images = result
      state.phase = 'images'
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(runId, state)

      return handleCORS(NextResponse.json({
        runId,
        imageCount: result.images.length,
        generatedCount: result.images.filter((i) => i.source === 'nano_banana').length,
        openaiCount: result.images.filter((i) => i.source === 'openai_image').length,
        stockCount: result.images.filter((i) => i.source === 'stock').length,
        // Expose per-image error messages so the UI / user can tell WHY
        // Nano Banana fell back to stock (no API key, access denied, quota, etc.)
        generationErrors: result.genErrors || [],
        // Send thumbnails (first 200 chars of each data URL) so UI can render a preview
        thumbnails: result.images.map((img) => ({
          role: img.role,
          source: img.source,
          subject: img.subject?.slice(0, 80) || '',
          preview: typeof img.dataUrl === 'string' ? img.dataUrl : null,
        })),
        nextStep: { id: 'compose', label: 'Compose pages', endpoint: '/api/build/compose' },
      }))
    } catch (e) {
      console.error('[build/images] failed:', e.message)
      return handleCORS(NextResponse.json({ error: e.message, phase: 'images' }, { status: 500 }))
    }
  }

  if (route === '/build/compose' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const { runId } = await request.json()
      const state = await phaseStates.findByRunId(runId)
      if (!state) return handleCORS(NextResponse.json({ error: 'run not found' }, { status: 404 }))
      if (state.userId !== (auth.authUser.id || auth.authUser.sub)) return handleCORS(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
      if (!state.results?.images) return handleCORS(NextResponse.json({ error: 'images phase not complete' }, { status: 400 }))

      // Image dataUrls are stored in a separate collection to keep the
      // state row under 16 MB. Hydrate them back onto the state object
      // before compose runs (compose embeds them inline into JSX).
      await phaseStates.hydrateImages(state, runId)

      const aiService = buildProvider(auth.authUser, state.provider, state.model)
      const { result } = await drainPhase(runPhaseCompose({
        provider: aiService.provider,
        priorResults: state.results,
        db: { projectFiles: supaDb.projectFiles },
        projectId: state.projectId,
      }))

      state.results.compose = result
      state.phase = 'compose'
      state.completedAt = new Date()
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(runId, state)

      return handleCORS(NextResponse.json({
        runId,
        fileCount: result.files.length,
        files: result.files,
        complete: true,
      }))
    } catch (e) {
      console.error('[build/compose] failed:', e.message)
      return handleCORS(NextResponse.json({ error: e.message, phase: 'compose' }, { status: 500 }))
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // POST /build/imagery/generate
  //
  // Lever 2 + 4: generate (or regenerate) imagery for an existing
  // project. Loads the latest phase_state for the project, runs Phase 4
  // (images) with full Nano Banana / OpenAI / stock chain, then re-runs
  // Phase 5 (compose) so the JSX picks up the new image references.
  //
  // Body (all optional):
  //   { projectId }          ← required
  //   { roleFilter: ['hero'] } ← only regenerate specific image roles
  //                              (Lever 4 — per-image regenerate)
  //
  // After a successful run, project.settings.imagery_status = 'generated'.
  // ──────────────────────────────────────────────────────────────────
  if (route === '/build/imagery/generate' && method === 'POST') {
    const auth = await requireAuthedUser(request)
    if (auth.err) return handleCORS(auth.err)
    try {
      const body = await request.json().catch(() => ({}))
      const { projectId, roleFilter } = body
      if (!projectId) {
        return handleCORS(NextResponse.json({ error: 'projectId required' }, { status: 400 }))
      }

      // Gate: caller must own the project.
      const project = await supaDb.projects.findById(projectId)
      if (!project) return handleCORS(NextResponse.json({ error: 'project not found' }, { status: 404 }))
      const userId = auth.authUser.id || auth.authUser.sub
      if (project.user_id !== userId) {
        return handleCORS(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
      }

      const state = await phaseStates.findLatestForProject(projectId)
      if (!state || !state.results?.plan || !state.results?.design_tokens) {
        return handleCORS(NextResponse.json({
          error: 'no build state available — run an initial build first',
        }, { status: 400 }))
      }

      // Optionally narrow the manifest to specific roles. This powers
      // Lever 4 ("regenerate the hero image") — we shrink the manifest
      // BEFORE Phase 4 so we only burn credits on the requested image,
      // then merge back any prior images at compose time.
      const fullManifest = state.results.plan.imageManifest || []
      const priorImages = (await phaseStates.loadImagesForRun(state.runId)) || []
      let narrowedPlan = state.results.plan
      let imagesToReuse = []
      if (Array.isArray(roleFilter) && roleFilter.length > 0) {
        const wanted = new Set(roleFilter)
        narrowedPlan = {
          ...state.results.plan,
          imageManifest: fullManifest.filter((m) => wanted.has(m.role)),
        }
        imagesToReuse = priorImages
          .filter((img) => !wanted.has(img.role))
          .map((img) => ({
            role: img.role,
            dataUrl: img.dataUrl,
            subject: img.subject,
            source: img.source,
          }))
      }

      const geminiProvider = buildGeminiProvider()
      const openaiImageProvider = buildOpenAIImageProvider()

      // Phase 4 — generate (force imageMode 'full' here regardless of how
      // the original build was kicked off).
      const { result: imagesResult } = await drainPhase(runPhaseImages({
        geminiProvider,
        openaiImageProvider,
        priorResults: { ...state.results, plan: narrowedPlan },
        attachments: state.attachments || [],
        imageMode: 'full',
      }))

      // Merge new + reused images. New come first so ordering follows
      // the manifest the user just acted on; the existing PreviewTab
      // mapping is by filename hash so order doesn't change rendering.
      const mergedImages = [...imagesResult.images, ...imagesToReuse]

      // Persist the merged image set so subsequent compose runs can
      // re-hydrate. Old image rows for this run are wiped + replaced.
      await phaseStates.saveImagesForRun(state.runId, mergedImages)
      state.results.images = { ...imagesResult, images: mergedImages, deferred: false }
      state.phase = 'images'
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(state.runId, state)

      // Phase 5 — recompose. JSX is rewritten with image references; the
      // image-extractor in persistContent will catch any inlined base64
      // and re-route to `_assets/__gen_img_<hash>` rows automatically.
      await phaseStates.hydrateImages(state, state.runId)
      const aiService = buildProvider(auth.authUser, state.provider, state.model)
      const { result: composeResult } = await drainPhase(runPhaseCompose({
        provider: aiService.provider,
        priorResults: state.results,
        db: { projectFiles: supaDb.projectFiles },
        projectId,
      }))

      state.results.compose = composeResult
      state.phase = 'compose'
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(state.runId, state)

      // Stamp the project so the UI hides the "Generate brand imagery" CTA.
      try {
        const settings = { ...(project.settings || {}) }
        settings.imagery_status = 'generated'
        settings.imagery_status_at = new Date().toISOString()
        await supaDb.projects.update(projectId, { settings })
      } catch (err) {
        console.warn('[imagery/generate] settings update failed:', err.message)
      }

      return handleCORS(NextResponse.json({
        success: true,
        imageCount: mergedImages.length,
        regenerated: imagesResult.images.length,
        reused: imagesToReuse.length,
        fileCount: composeResult.files?.length || 0,
        imageryStatus: 'generated',
      }))
    } catch (e) {
      console.error('[build/imagery/generate] failed:', e.message, e.stack)
      return handleCORS(NextResponse.json({ error: e.message, phase: 'imagery_generate' }, { status: 500 }))
    }
  }

  return null
}
