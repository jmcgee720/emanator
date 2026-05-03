import OpenAI from 'openai'
import { BaseAIProvider } from './base.js'
import { classifyProviderError } from '../errors.js'

/**
 * Reasoning models (gpt-5.x, o-series) use different param names:
 *   • `max_completion_tokens` instead of `max_tokens`
 *   • temperature is fixed (must be omitted)
 * This helper canonicalizes the params dict so callers can keep using
 * `max_tokens` + `temperature` regardless of model.
 */
function isReasoningModel(model) {
  if (!model) return false
  const m = String(model).toLowerCase()
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')
}

function buildOpenAIParams(model, params) {
  const out = { ...params, model }
  if (isReasoningModel(model)) {
    if (out.max_tokens != null) {
      out.max_completion_tokens = out.max_tokens
      delete out.max_tokens
    }
    delete out.temperature
  }
  return out
}

/**
 * OpenAI Provider Implementation with Streaming
 */
export class OpenAIProvider extends BaseAIProvider {
  constructor(apiKey, model = 'gpt-4o', options = {}) {
    super(apiKey, model)
    const clientOpts = { apiKey }
    if (options.baseURL) clientOpts.baseURL = options.baseURL
    this.client = new OpenAI(clientOpts)
  }

  _wrapError(err) {
    throw classifyProviderError(err, 'openai', this.model)
  }

  async chat(messages, options = {}) {
    try {
      const response = await this.client.chat.completions.create(buildOpenAIParams(this.model, {
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 4096,
        ...options
      }))
      return response.choices[0]?.message?.content || ''
    } catch (err) {
      this._wrapError(err)
    }
  }

  /**
   * Stream chat completion token-by-token
   */
  async *chatStream(messages, options = {}) {
    try {
      const stream = await this.client.chat.completions.create(buildOpenAIParams(this.model, {
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 4096,
        stream: true,
      }))
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          yield { type: 'token', content: delta }
        }
      }
      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  /**
   * Stream chat with tools — yields tokens for text, then tool_calls at end
   */
  async *chatWithToolsStream(messages, tools, options = {}) {
    try {
      const stream = await this.client.chat.completions.create(buildOpenAIParams(this.model, {
        messages,
        tools,
        tool_choice: options.tool_choice || 'auto',
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 8192,
        stream: true,
      }))

      // Accumulate tool call deltas
      const toolCallAccumulator = {}

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta

        // Stream text content
        if (delta?.content) {
          yield { type: 'token', content: delta.content }
        }

        // Accumulate tool call deltas
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' }
              }
              console.log('[OpenAIStream] New tool call started:', tc.function?.name || '(pending)')
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id
            if (tc.function?.name) toolCallAccumulator[idx].function.name += tc.function.name
            if (tc.function?.arguments) {
              toolCallAccumulator[idx].function.arguments += tc.function.arguments
              // Emit delta so callers can do incremental work (e.g. live preview)
              yield { type: 'tool_args_delta', index: idx, name: toolCallAccumulator[idx].function.name, delta: tc.function.arguments }
            }
          }
        }
      }

      // Emit accumulated tool calls
      const toolCalls = Object.values(toolCallAccumulator)
      if (toolCalls.length > 0) {
        yield { type: 'tool_calls', tool_calls: toolCalls }
      }

      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async chatWithTools(messages, tools, options = {}) {
    try {
      const response = await this.client.chat.completions.create(buildOpenAIParams(this.model, {
        messages,
        tools,
        tool_choice: options.tool_choice || 'auto',
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 4096,
        ...options
      }))
      const choice = response.choices[0]
      return {
        content: choice?.message?.content,
        tool_calls: choice?.message?.tool_calls || [],
        finish_reason: choice?.finish_reason
      }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async generateStructured(messages, schema, options = {}) {
    try {
      const response = await this.client.chat.completions.create(buildOpenAIParams(this.model, {
        messages,
        response_format: { type: 'json_object' },
        temperature: options.temperature ?? 0.5,
        max_tokens: options.max_tokens ?? 4096,
        ...options
      }))
      const content = response.choices[0]?.message?.content || '{}'
      try {
        return JSON.parse(content)
      } catch {
        return { error: 'Failed to parse JSON response', raw: content }
      }
    } catch (err) {
      this._wrapError(err)
    }
  }

  /**
   * Generate an image using OpenAI Images API
   */
  async generateImage(prompt, options = {}) {
    try {
      const response = await this.client.images.generate({
        model: options.model || process.env.OPENAI_MODEL_IMAGE || 'gpt-image-1',
        prompt,
        n: 1,
        size: options.size || '1024x1024',
        quality: options.quality || 'auto',
      })

      const imageData = response.data?.[0]
      if (!imageData) throw new Error('No image data returned')

      return {
        b64_json: imageData.b64_json || null,
        url: imageData.url || null,
        revised_prompt: imageData.revised_prompt || null,
      }
    } catch (err) {
      this._wrapError(err)
    }
  }
}
