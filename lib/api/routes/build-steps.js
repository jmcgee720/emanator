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
  return new GeminiProvider(key, 'gemini-3.1-flash-image-preview', {})
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

      const { result } = await drainPhase(runPhaseImages({
        geminiProvider,
        priorResults: state.results,
        attachments: state.attachments || [],
      }))

      // Persist compact summary (never return 12 x 1MB data URLs in JSON response)
      state.results.images = result
      state.phase = 'images'
      state.updatedAt = new Date()
      await phaseStates.upsertByRunId(runId, state)

      return handleCORS(NextResponse.json({
        runId,
        imageCount: result.images.length,
        generatedCount: result.images.filter((i) => i.source === 'nano_banana').length,
        stockCount: result.images.filter((i) => i.source === 'stock').length,
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

  return null
}
