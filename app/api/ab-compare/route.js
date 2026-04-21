import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { AIService } from '@/lib/ai/service'
import { creditsDb, CREDIT_COSTS } from '@/lib/credits/service'

/**
 * A/B provider-comparison endpoint (Session: Multi-provider compare).
 *
 * Fires the same prompt through multiple provider/model combinations in
 * parallel and merges their streamed output into a single SSE response.
 * Each event is tagged with its `lane` index so the client can route it
 * to the correct side-by-side panel.
 *
 * Request body: {
 *   prompt: string,
 *   systemPrompt?: string,
 *   lanes: [{ provider: 'openai'|'anthropic'|'gemini', model: string }, ...] (2-4 lanes)
 * }
 *
 * Response SSE events:
 *   event: start      data: { lanes: [{ index, provider, model }, ...] }
 *   event: token      data: { lane, delta }
 *   event: lane_done  data: { lane, ms, content }
 *   event: lane_error data: { lane, error }
 *   event: done       data: { ms, lanes }
 *
 * Costs: charges the user ONCE per lane (CREDIT_COSTS.comparison).
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LANES = 4
const COMPARISON_CREDIT_COST = CREDIT_COSTS.comparison || CREDIT_COSTS.chat_message || 0.5

export async function POST(request) {
  const authUser = await getAuthUser(request)
  if (!authUser) {
    return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }

  const body = await request.json().catch(() => ({}))
  const prompt = String(body.prompt || '').trim()
  const systemPrompt = String(body.systemPrompt || '').trim()
  const lanes = Array.isArray(body.lanes) ? body.lanes.slice(0, MAX_LANES) : []

  if (!prompt) {
    return handleCORS(NextResponse.json({ error: 'Prompt required' }, { status: 400 }))
  }
  if (lanes.length < 2) {
    return handleCORS(NextResponse.json({ error: 'At least 2 lanes required' }, { status: 400 }))
  }

  // Credit pre-check: require enough for ALL lanes. Deduct per-lane on completion.
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) {
    return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
  }
  const required = COMPARISON_CREDIT_COST * lanes.length
  try {
    const bal = await creditsDb.getBalance(dbUser.id)
    if (bal.balance < required) {
      return handleCORS(NextResponse.json({
        error: `Not enough credits. Need ${required.toFixed(2)}, have ${bal.balance.toFixed(2)}.`,
        credits_exhausted: true, balance: bal.balance, required,
      }, { status: 402 }))
    }
  } catch {}

  const encoder = new TextEncoder()
  const started = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event, data) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) }
        catch { closed = true }
      }

      send('start', { lanes: lanes.map((l, i) => ({ index: i, provider: l.provider, model: l.model })) })

      const messages = []
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
      messages.push({ role: 'user', content: prompt })

      // Fire all lanes in parallel. Each lane runs its provider.chatStream
      // and emits token / lane_done / lane_error events tagged with its
      // index. Promise.allSettled so one lane's failure never aborts the others.
      const laneTasks = lanes.map((lane, index) => runLane({
        index, lane, messages, dbUser, send,
      }))
      await Promise.allSettled(laneTasks)

      send('done', { ms: Date.now() - started, lanes: lanes.length })
      try { controller.close() } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function runLane({ index, lane, messages, dbUser, send }) {
  const t0 = Date.now()
  let fullContent = ''
  try {
    const svc = new AIService(lane.provider, lane.model)
    const iter = svc.provider.chatStream(messages, { temperature: 0.7, max_tokens: 1500 })
    for await (const ev of iter) {
      if (ev?.type === 'token' && ev.content) {
        fullContent += ev.content
        send('token', { lane: index, delta: ev.content })
      }
    }
    const ms = Date.now() - t0
    send('lane_done', { lane: index, ms, content: fullContent, provider: lane.provider, model: lane.model })
    // Deduct once per lane after success
    creditsDb.deductCredits(dbUser.id, 'comparison').catch(() => {})
  } catch (err) {
    send('lane_error', {
      lane: index,
      error: String(err?.user_message || err?.message || err).slice(0, 300),
      provider: lane.provider,
      model: lane.model,
      ms: Date.now() - t0,
    })
  }
}

export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 204 }))
}
