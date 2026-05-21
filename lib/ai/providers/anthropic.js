import Anthropic from '@anthropic-ai/sdk'
import { BaseAIProvider } from './base.js'
import { classifyProviderError } from '../errors.js'

/**
 * Anthropic Provider Implementation with Streaming
 */
export class AnthropicProvider extends BaseAIProvider {
  constructor(apiKey, model = 'claude-sonnet-4-6') {
    super(apiKey, model)
    this.client = new Anthropic({ apiKey })
    this.extendedThinking = false
  }

  setExtendedThinking(enabled) {
    this.extendedThinking = enabled
    return this
  }

  /**
   * Convert OpenAI-style messages → Anthropic's content-block format.
   *
   * Our codebase pushes `role: 'tool'` messages with tool_call_id +
   * content (OpenAI's shape) after every tool execution. Anthropic
   * rejects those — it requires:
   *   • assistant tool calls as content blocks: { type: 'tool_use', id, name, input }
   *   • tool results as USER messages with: { type: 'tool_result', tool_use_id, content }
   *
   * This converter also coalesces consecutive tool results (Anthropic
   * wants them as separate content blocks within a single user message).
   *
   * Prompt caching: when `cacheSystem` is true (default), the system
   * prompt is returned as a content-block array with an `ephemeral`
   * cache_control marker. Anthropic caches input tokens up to and
   * including the marker — subsequent identical requests within ~5
   * minutes pay 10% of the normal input rate for those tokens. The
   * system prompt is the highest-leverage block to cache because it
   * is ~6-8 KB of unchanging instructions on every turn.
   *
   * Anthropic requires a minimum of 1024 cached tokens (Sonnet) or
   * 2048 (Haiku) — below that the marker is ignored and we pay full
   * rate. Our prompts are well above that floor, so this is always
   * worth doing.
   */
  _convertMessages(messages, { cacheSystem = true } = {}) {
    let systemText = ''
    const out = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + (msg.content || '')
        continue
      }

      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        // OpenAI assistant w/ tool_calls → Anthropic assistant w/ tool_use blocks
        const blocks = []
        if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
          blocks.push({ type: 'text', text: msg.content })
        }
        for (const tc of msg.tool_calls) {
          let parsedInput = {}
          try {
            parsedInput = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : (tc.function?.arguments || {})
          } catch {
            parsedInput = {}
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name,
            input: parsedInput,
          })
        }
        out.push({ role: 'assistant', content: blocks })
        continue
      }

      if (msg.role === 'tool') {
        // OpenAI tool result → Anthropic user message w/ tool_result block.
        // Coalesce with the previous user message if the prior was already
        // a tool_result-bearing user (Anthropic prefers grouped results).
        const block = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''),
        }
        const last = out[out.length - 1]
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every(b => b?.type === 'tool_result')) {
          last.content.push(block)
        } else {
          out.push({ role: 'user', content: [block] })
        }
        continue
      }

      // Plain user / assistant message — pass through. Strip `name`,
      // `tool_call_id`, etc. that Anthropic's SDK doesn't expect.
      out.push({ role: msg.role, content: msg.content })
    }

    // Build the system field. When caching is requested AND we have a
    // non-empty system prompt, return as a content-block array with
    // ephemeral cache_control. Otherwise return as a plain string for
    // backwards compatibility with the existing call sites.
    const system = (cacheSystem && systemText.length > 0)
      ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
      : systemText

    return { system, messages: out }
  }

  /**
   * Convert OpenAI-shape tool definitions to Anthropic-shape, with an
   * optional ephemeral cache_control marker on the last tool to enable
   * tool-catalog caching. Anthropic caches everything up to and
   * including a cache_control marker as one block, so placing the
   * marker on the LAST tool caches the entire tool catalog (and the
   * system prompt if it precedes — Anthropic stitches them in order
   * system → tools → messages internally for caching purposes).
   *
   * Tool catalog is ~3-4 KB of stable input on every turn. Caching it
   * is essentially free quality-wise and produces measurable savings.
   */
  _convertTools(openaiTools, { cacheTools = true } = {}) {
    if (!openaiTools?.length) return []
    const tools = openaiTools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }))
    if (cacheTools && tools.length > 0) {
      // Mark the last tool — caches the whole catalog as a unit.
      // We mutate in place because we just built the array.
      tools[tools.length - 1].cache_control = { type: 'ephemeral' }
    }
    return tools
  }

  _wrapError(err) {
    throw classifyProviderError(err, 'anthropic', this.model)
  }

  async chat(messages, options = {}) {
    const { system, messages: converted } = this._convertMessages(messages)
    const params = {
      model: this.model,
      max_tokens: options.max_tokens ?? 4096,
      messages: converted,
    }
    if (system) params.system = system
    if (options.temperature != null) params.temperature = options.temperature
    if (this.extendedThinking) {
      params.thinking = { type: 'enabled', budget_tokens: 2048 }
      delete params.temperature
    }

    try {
      const response = await this.client.messages.create(params)
      return response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
    } catch (err) {
      this._wrapError(err)
    }
  }

  /**
   * Stream chat completion token-by-token using Anthropic's streaming API
   */
  async *chatStream(messages, options = {}) {
    const { system, messages: converted } = this._convertMessages(messages, { cacheSystem: options.cacheControl !== false })
    const params = {
      model: this.model,
      max_tokens: options.max_tokens ?? 4096,
      messages: converted,
    }
    if (system) params.system = system
    if (options.temperature != null) params.temperature = options.temperature
    if (this.extendedThinking) {
      params.thinking = { type: 'enabled', budget_tokens: 2048 }
      delete params.temperature
    }

    try {
      const stream = this.client.messages.stream(params)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield { type: 'token', content: event.delta.text }
        }
      }
      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  /**
   * Stream chat with tools — yields tokens, then tool_calls at end
   */
  async *chatWithToolsStream(messages, tools, options = {}) {
    const { system, messages: converted } = this._convertMessages(messages, { cacheSystem: options.cacheControl !== false })
    const anthropicTools = this._convertTools(tools, { cacheTools: options.cacheControl !== false })
    const params = {
      model: this.model,
      max_tokens: options.max_tokens ?? 8192,
      messages: converted,
      tools: anthropicTools,
    }
    if (system) params.system = system
    if (options.temperature != null) params.temperature = options.temperature
    // Translate OpenAI-format tool_choice to Anthropic format
    if (options.tool_choice?.type === 'function' && options.tool_choice?.function?.name) {
      params.tool_choice = { type: 'tool', name: options.tool_choice.function.name }
    }
    if (this.extendedThinking) {
      params.thinking = { type: 'enabled', budget_tokens: 4096 }
      delete params.temperature
    }

    try {
      const stream = this.client.messages.stream(params)

      // Accumulate tool use blocks
      const toolBlocks = {}
      let currentBlockIdx = null

      // Cache-usage tracking. Anthropic emits initial usage in
      // message_start (with cache_creation_input_tokens and
      // cache_read_input_tokens) and final output token count in
      // message_delta. We collect both and log a single
      // [anthropic-cache] line at end-of-turn so we can grep the
      // production logs to prove the savings are landing.
      let cacheUsage = null

      for await (const event of stream) {
        if (event.type === 'message_start' && event.message?.usage) {
          cacheUsage = { ...event.message.usage }
        }
        if (event.type === 'message_delta' && event.usage?.output_tokens != null && cacheUsage) {
          cacheUsage.output_tokens = event.usage.output_tokens
        }
        if (event.type === 'content_block_start') {
          if (event.content_block?.type === 'tool_use') {
            currentBlockIdx = event.index
            toolBlocks[currentBlockIdx] = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: ''
            }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            yield { type: 'token', content: event.delta.text }
          } else if (event.delta?.type === 'input_json_delta' && toolBlocks[event.index]) {
            toolBlocks[event.index].inputJson += event.delta.partial_json
            // Emit delta so callers can do incremental work (e.g. live preview)
            yield { type: 'tool_args_delta', index: event.index, name: toolBlocks[event.index].name, delta: event.delta.partial_json }
          }
        }
      }

      // Emit accumulated tool calls in OpenAI-compatible format
      const toolCalls = Object.values(toolBlocks).map(tb => ({
        id: tb.id,
        type: 'function',
        function: {
          name: tb.name,
          arguments: tb.inputJson
        }
      }))
      if (toolCalls.length > 0) {
        yield { type: 'tool_calls', tool_calls: toolCalls }
      }

      // Log cache usage + emit a structured `usage` event so the
      // stream handler can record it on the assistant message for
      // billing analytics. Cost math here uses Sonnet 4.5 list prices
      // ($3/M input, $15/M output, $0.30/M cached read = 10%); this
      // is a heuristic, exact billing is per Anthropic invoice.
      if (cacheUsage) {
        const input = cacheUsage.input_tokens || 0
        const cacheCreate = cacheUsage.cache_creation_input_tokens || 0
        const cacheRead = cacheUsage.cache_read_input_tokens || 0
        const output = cacheUsage.output_tokens || 0
        // Cached-read tokens cost 10% of standard input rate. Cache
        // creation is billed at 1.25x standard input (one-time, then
        // amortized over all subsequent reads within the 5-min TTL).
        const baselineCost = ((input + cacheCreate + cacheRead) * 3 / 1_000_000) + (output * 15 / 1_000_000)
        const actualCost = (input * 3 / 1_000_000) + (cacheCreate * 3.75 / 1_000_000) + (cacheRead * 0.30 / 1_000_000) + (output * 15 / 1_000_000)
        const savedDollars = Math.max(0, baselineCost - actualCost)
        console.log('[anthropic-cache]', {
          model: this.model,
          input_tokens: input,
          cache_creation_input_tokens: cacheCreate,
          cache_read_input_tokens: cacheRead,
          output_tokens: output,
          estimated_baseline_cost_usd: Number(baselineCost.toFixed(5)),
          estimated_actual_cost_usd: Number(actualCost.toFixed(5)),
          estimated_savings_usd: Number(savedDollars.toFixed(5)),
          cache_hit: cacheRead > 0,
        })
        yield {
          type: 'usage',
          usage: {
            input_tokens: input,
            cache_creation_input_tokens: cacheCreate,
            cache_read_input_tokens: cacheRead,
            output_tokens: output,
            estimated_actual_cost_usd: Number(actualCost.toFixed(5)),
            estimated_savings_usd: Number(savedDollars.toFixed(5)),
          },
        }
      }

      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async chatWithTools(messages, tools, options = {}) {
    const { system, messages: converted } = this._convertMessages(messages, { cacheSystem: options.cacheControl !== false })
    const anthropicTools = this._convertTools(tools, { cacheTools: options.cacheControl !== false })
    const params = {
      model: this.model,
      max_tokens: options.max_tokens ?? 8192,
      messages: converted,
      tools: anthropicTools,
    }
    if (system) params.system = system
    if (options.temperature != null) params.temperature = options.temperature
    if (this.extendedThinking) {
      params.thinking = { type: 'enabled', budget_tokens: 4096 }
      delete params.temperature
    }

    try {
      const response = await this.client.messages.create(params)
      let content = ''
      const toolCalls = []
      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input)
            }
          })
        }
      }
      return {
        content: content || null,
        tool_calls: toolCalls,
        finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
      }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async generateStructured(messages, schema, options = {}) {
    const { system, messages: converted } = this._convertMessages(messages)
    const structuredSystem = (system ? system + '\n\n' : '') +
      'Respond ONLY with valid JSON matching the requested schema. No explanation text.'
    const params = {
      model: this.model,
      max_tokens: options.max_tokens ?? 4096,
      system: structuredSystem,
      messages: converted,
    }
    if (options.temperature != null) params.temperature = options.temperature

    try {
      const response = await this.client.messages.create(params)
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
      try {
        return JSON.parse(text)
      } catch {
        return { error: 'Failed to parse JSON response', raw: text }
      }
    } catch (err) {
      this._wrapError(err)
    }
  }
}
