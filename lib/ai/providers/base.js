/**
 * Base AI Provider Interface
 * All AI providers must implement this interface
 */

export class BaseAIProvider {
  constructor(apiKey, model) {
    this.apiKey = apiKey
    this.model = model
  }

  /**
   * Send a chat completion request
   * @param {Array} messages - Array of message objects {role, content}
   * @param {Object} options - Additional options (temperature, max_tokens, etc.)
   * @returns {Promise<string>} - The assistant's response
   */
  async chat(messages, options = {}) {
    throw new Error('chat() must be implemented by provider')
  }

  /**
   * Stream a chat completion, yielding text chunks
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Additional options
   * @yields {{ type: 'token', content: string } | { type: 'done' }}
   */
  async *chatStream(messages, options = {}) {
    // Default fallback: call chat() and yield the whole thing at once
    const result = await this.chat(messages, options)
    yield { type: 'token', content: result }
    yield { type: 'done' }
  }

  /**
   * Stream a chat completion with tool calling
   * Yields text tokens as they arrive, then yields tool_calls at the end
   * @param {Array} messages
   * @param {Array} tools
   * @param {Object} options
   * @yields {{ type: 'token', content: string } | { type: 'tool_calls', tool_calls: Array } | { type: 'done' }}
   */
  async *chatWithToolsStream(messages, tools, options = {}) {
    // Default fallback: call chatWithTools() and yield result
    const result = await this.chatWithTools(messages, tools, options)
    if (result.content) {
      yield { type: 'token', content: result.content }
    }
    if (result.tool_calls?.length) {
      yield { type: 'tool_calls', tool_calls: result.tool_calls }
    }
    yield { type: 'done' }
  }

  /**
   * Send a chat completion with function/tool calling
   */
  async chatWithTools(messages, tools, options = {}) {
    throw new Error('chatWithTools() must be implemented by provider')
  }

  /**
   * Generate structured output (JSON mode)
   */
  async generateStructured(messages, schema, options = {}) {
    throw new Error('generateStructured() must be implemented by provider')
  }
}
