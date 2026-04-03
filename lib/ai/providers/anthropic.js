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

  _convertMessages(messages) {
    let system = ''
    const filtered = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (system ? '\n\n' : '') + msg.content
      } else {
        filtered.push({ role: msg.role, content: msg.content })
      }
    }
    return { system, messages: filtered }
  }

  _convertTools(openaiTools) {
    if (!openaiTools?.length) return []
    return openaiTools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }))
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
    const { system, messages: converted } = this._convertMessages(messages)
    const anthropicTools = this._convertTools(tools)
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

      for await (const event of stream) {
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

      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async chatWithTools(messages, tools, options = {}) {
    const { system, messages: converted } = this._convertMessages(messages)
    const anthropicTools = this._convertTools(tools)
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
