// ── Agent Core (v2) ──
// Emergent-style autonomous tool-using agent loop.
//
// Design principles (in stark contrast to the legacy message-stream.js):
//   • ONE loop, no modes. No chat_only vs tool_calling vs plan_mode vs
//     direct_edit vs self-edit. The model + tool definitions decide what
//     happens.
//   • No prompt-policing. No "forbidden patterns", no "required patterns",
//     no detectors trying to catch narration. If the model wants to act,
//     it calls a tool. If it wants to talk, it emits text-only and the
//     loop terminates naturally.
//   • No tool_choice forcing. Always 'auto'. The tool descriptions are
//     the only signal the model needs.
//   • No synthesis pass, no dangling-intent detector, no ultra-short
//     response detector. There is no "loop ended but we didn't get an
//     answer" state — the loop only ends when the model decides it has
//     finished (text-only response) or hits the safety ceiling.
//   • Real tools, real results. No directive injection into tool results,
//     no auto-recovery fuzzy-find. The model sees what actually happened.
//
// Input: { provider, systemPrompt, userMessage, tools, maxIterations, signal }
// Yields: text_delta | tool_use | tool_result | done | error events.
//
// `provider` must expose chatWithToolsStream(messages, toolDefs, options)
// as an async generator yielding { type: 'token', content } and finally
// { type: 'tool_calls', tool_calls: [...] } in OpenAI-compatible shape.
//
// `tools` is an array of { name, description, input_schema, execute }.
//
// The whole module is ~150 lines. That's the point.

const DEFAULT_MAX_ITERATIONS = 100

/**
 * Run an Emergent-style agent loop.
 *
 * @param {object}  opts
 * @param {object}  opts.provider          — LLM provider (must have chatWithToolsStream)
 * @param {string}  opts.systemPrompt      — single system prompt; no policing, no modes
 * @param {string|Array}  opts.userMessage — the user's request (string or Anthropic content blocks for vision)
 * @param {Array}   opts.tools             — tool registry: { name, description, input_schema, execute }
 * @param {Array}   [opts.priorMessages]   — optional prior conversation turns (role+content shape)
 * @param {number}  [opts.maxIterations]   — safety ceiling (default 50)
 * @param {AbortSignal} [opts.signal]      — cancellation signal
 * @yields {object} events: text_delta | tool_use | tool_result | done | error
 */
export async function* runAgent({
  provider,
  systemPrompt,
  userMessage,
  tools,
  priorMessages = [],
  maxIterations = DEFAULT_MAX_ITERATIONS,
  signal,
  forceFirstToolCall = null,
}) {
  if (!provider || typeof provider.chatWithToolsStream !== 'function') {
    yield { type: 'error', message: 'agent-core: provider must implement chatWithToolsStream' }
    return
  }
  if (!Array.isArray(tools)) {
    yield { type: 'error', message: 'agent-core: tools must be an array' }
    return
  }

  const toolDefs = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }))
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  // Defensive: priorMessages must be iterable for the spread below.
  // A non-array (null / undefined / object) would crash the loop
  // before the model has a chance to respond, surfacing as the
  // confusing 'priorMessages is not defined' style error in chat.
  const safePriorMessages = Array.isArray(priorMessages) ? priorMessages : []

  const messages = [
    { role: 'system', content: systemPrompt },
    ...safePriorMessages,
    { role: 'user', content: userMessage }, // userMessage can be string or content blocks array
  ]

  for (let iter = 0; iter < maxIterations; iter++) {
    if (signal?.aborted) {
      yield { type: 'error', message: 'agent-core: aborted' }
      return
    }

    let textBuffer = ''
    let toolCalls = []

    try {
      // First-iteration tool forcing — used when the current user turn
      // contains images, to require the model to call
      // submit_screenshot_inventory before any text response. Without this,
      // the model rationalizes past system-prompt instructions and
      // fabricates positive assessments. Subsequent iterations use auto.
      // Lower temperature for code tasks = more deterministic, fewer tokens, faster generation
      const providerOpts = {
        temperature: 0.2,
        max_tokens: 8192,
      }
      if (forceFirstToolCall && iter === 0) {
        // Some models (Fable 5, older Gemini variants) don't support forced
        // tool use. Detect them by checking the provider's model string.
        // If unsupported, skip tool_choice and rely on system prompt alone.
        const modelStr = String(provider.model || '').toLowerCase()
        const supportsForcing = !modelStr.includes('fable') && !modelStr.includes('gemini-1')
        if (supportsForcing) {
          providerOpts.tool_choice = {
            type: 'function',
            function: { name: forceFirstToolCall },
          }
        } else {
          console.log('[agent-core] model does not support forced tool use, skipping tool_choice:', provider.model)
        }
      }
      for await (const chunk of provider.chatWithToolsStream(messages, toolDefs, providerOpts)) {
        if (signal?.aborted) {
          yield { type: 'error', message: 'agent-core: aborted' }
          return
        }
        if (chunk.type === 'token') {
          textBuffer += chunk.content
          yield { type: 'text_delta', content: chunk.content }
        } else if (chunk.type === 'tool_calls') {
          toolCalls = Array.isArray(chunk.tool_calls) ? chunk.tool_calls : []
        }
        // tool_args_delta ignored — live partial previews are a v1 concept
      }
    } catch (err) {
      // Surface the actual upstream error (status, model, first 200 chars
      // of the response body) so users can distinguish "Anthropic is down"
      // from "your API key is invalid" from "you hit a rate limit". The
      // previous generic 'temporarily unavailable' message masked all three
      // and left users guessing.
      const status = err?.status || err?.response?.status || err?.statusCode || null
      const rawBody = err?.response?.data || err?.body || err?.message || String(err)
      const bodyText = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
      const detail = bodyText.slice(0, 240).replace(/\s+/g, ' ')
      const modelInfo = err?.model || err?._model || null
      const parts = [
        'agent-core: provider stream failed',
        status ? `HTTP ${status}` : null,
        modelInfo ? `model=${modelInfo}` : null,
        detail,
      ].filter(Boolean)
      yield { type: 'error', message: parts.join(' · ') }
      return
    }

    // Termination: model emitted no tool calls → it considers itself done.
    if (toolCalls.length === 0) {
      yield { type: 'done', reason: 'text_response', messages, iterations: iter + 1 }
      return
    }

    // Persist the assistant turn (text + tool_calls) into history
    messages.push({
      role: 'assistant',
      content: textBuffer || null,
      tool_calls: toolCalls,
    })

    // Execute every tool call sequentially. Results MUST follow in the same
    // order as the calls (Anthropic requires every tool_use to have a
    // matching tool_result before the next assistant turn).
    for (const tc of toolCalls) {
      const toolName = tc.function?.name || 'unknown'
      const toolId = tc.id || 'call_' + Math.random().toString(36).slice(2, 10)

      let args = {}
      try {
        args = typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments || {})
      } catch {
        args = {}
      }

      yield { type: 'tool_use', name: toolName, id: toolId, args }

      const tool = toolMap.get(toolName)
      let result
      if (!tool) {
        result = `Error: tool "${toolName}" is not registered. Available tools: ${[...toolMap.keys()].join(', ')}`
      } else {
        try {
          const raw = await tool.execute(args, { signal })
          // Pass arrays through as-is so tools can return Anthropic
          // content blocks (e.g. screenshot_preview returns a text+image
          // pair so Claude can SEE the captured pixels). String results
          // stay strings. Plain objects get JSON.stringified.
          if (typeof raw === 'string') {
            result = raw
          } else if (Array.isArray(raw)) {
            result = raw
          } else {
            result = JSON.stringify(raw)
          }
        } catch (err) {
          result = `Error executing ${toolName}: ${err?.message || String(err)}`
        }
      }

      yield { type: 'tool_result', name: toolName, id: toolId, content: result }
      messages.push({ role: 'tool', tool_call_id: toolId, content: result })
    }
    // Loop continues — model will see the tool_results and decide what to do next
  }

  yield { type: 'error', message: `agent-core: stopped at maxIterations (${maxIterations})`, messages }
}
