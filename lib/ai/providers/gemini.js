import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { BaseAIProvider } from './base.js'
import { classifyProviderError } from '../errors.js'

/**
 * Google Gemini Provider
 *
 * Implements the BaseAIProvider contract using `@google/generative-ai`.
 * Works with both:
 *  - Direct Google API keys (GOOGLE_API_KEY / GEMINI_API_KEY)
 *  - Emergent Universal Key proxied via EMERGENT_PROXY_URL
 *
 * Maps OpenAI-shaped message arrays + tool specs to Gemini's format,
 * and maps Gemini's responses back to the OpenAI-shape our callers expect
 * (so `provider.chat()` / `chatWithToolsStream()` return identical shapes
 * regardless of provider).
 */
export class GeminiProvider extends BaseAIProvider {
  constructor(apiKey, model = 'gemini-2.5-pro', options = {}) {
    super(apiKey, model)
    const clientOpts = {}
    if (options.baseURL) clientOpts.baseUrl = options.baseURL
    this.client = new GoogleGenerativeAI(apiKey, clientOpts)
  }

  _wrapError(err) {
    throw classifyProviderError(err, 'gemini', this.model)
  }

  /**
   * Convert OpenAI-shaped messages[] into Gemini's {systemInstruction, contents[]}.
   * - `system` messages are concatenated into `systemInstruction`
   * - `user` / `assistant` messages become `contents[]` with role `user` / `model`
   * - Multi-part content (text + image_url from Vision) is mapped to Gemini's
   *   `parts: [{text}, {inlineData: {mimeType, data}}]` format.
   */
  _convertMessages(messages) {
    let systemInstruction = ''
    const contents = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction += (systemInstruction ? '\n\n' : '') + _extractText(msg.content)
        continue
      }
      const role = msg.role === 'assistant' ? 'model' : 'user'
      const parts = _toGeminiParts(msg.content)
      contents.push({ role, parts })
    }
    return { systemInstruction, contents }
  }

  /**
   * Convert OpenAI tool schema to Gemini's functionDeclarations shape.
   * Gemini expects the JSON-schema-ish `parameters` under `parameters`.
   */
  _convertTools(openaiTools) {
    if (!openaiTools?.length) return null
    return [{
      functionDeclarations: openaiTools.map((t) => ({
        name: t.function.name,
        description: t.function.description || '',
        parameters: _sanitizeSchema(t.function.parameters),
      })),
    }]
  }

  async chat(messages, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages)
    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 4096,
        ...(options.response_format?.type === 'json_object'
          ? { responseMimeType: 'application/json' }
          : {}),
      },
    })

    try {
      const result = await genModel.generateContent({ contents })
      return result.response.text() || ''
    } catch (err) {
      this._wrapError(err)
    }
  }

  async *chatStream(messages, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages)
    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 4096,
      },
    })

    try {
      const stream = await genModel.generateContentStream({ contents })
      for await (const chunk of stream.stream) {
        const text = chunk.text()
        if (text) yield { type: 'token', content: text }
      }
      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async *chatWithToolsStream(messages, tools, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages)
    const geminiTools = this._convertTools(tools)

    const modelParams = {
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 8192,
      },
    }
    if (geminiTools) modelParams.tools = geminiTools
    if (options.tool_choice?.type === 'function' && options.tool_choice?.function?.name) {
      modelParams.toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [options.tool_choice.function.name],
        },
      }
    }

    const genModel = this.client.getGenerativeModel(modelParams)

    try {
      const stream = await genModel.generateContentStream({ contents })
      const toolCalls = []

      for await (const chunk of stream.stream) {
        // Text tokens stream as they arrive
        const text = chunk.text()
        if (text) yield { type: 'token', content: text }

        // Function calls arrive as complete objects (not deltas).
        const fns = chunk.functionCalls?.() || []
        for (const fn of fns) {
          toolCalls.push({
            id: `gemini-call-${toolCalls.length}-${Date.now()}`,
            type: 'function',
            function: {
              name: fn.name,
              arguments: typeof fn.args === 'string' ? fn.args : JSON.stringify(fn.args || {}),
            },
          })
          // Emit a synthetic full-args delta so the streaming UI renders
          // immediately (Gemini doesn't stream partial tool args the way
          // OpenAI/Claude do).
          yield {
            type: 'tool_args_delta',
            index: toolCalls.length - 1,
            name: fn.name,
            delta: toolCalls[toolCalls.length - 1].function.arguments,
          }
        }
      }

      if (toolCalls.length > 0) {
        yield { type: 'tool_calls', tool_calls: toolCalls }
      }
      yield { type: 'done' }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async chatWithTools(messages, tools, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages)
    const geminiTools = this._convertTools(tools)

    const modelParams = {
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 8192,
      },
    }
    if (geminiTools) modelParams.tools = geminiTools

    const genModel = this.client.getGenerativeModel(modelParams)
    try {
      const result = await genModel.generateContent({ contents })
      const response = result.response
      const text = response.text() || ''
      const fns = response.functionCalls?.() || []
      const toolCalls = fns.map((fn, i) => ({
        id: `gemini-call-${i}-${Date.now()}`,
        type: 'function',
        function: {
          name: fn.name,
          arguments: typeof fn.args === 'string' ? fn.args : JSON.stringify(fn.args || {}),
        },
      }))
      return {
        content: text || null,
        tool_calls: toolCalls,
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }
    } catch (err) {
      this._wrapError(err)
    }
  }

  async generateStructured(messages, schema, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages)
    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.max_tokens ?? 4096,
        responseMimeType: 'application/json',
      },
    })
    try {
      const result = await genModel.generateContent({ contents })
      const text = result.response.text() || ''
      try { return JSON.parse(text) } catch { return { error: 'Failed to parse JSON response', raw: text } }
    } catch (err) {
      this._wrapError(err)
    }
  }

  /**
   * Generate an image using Nano Banana (`gemini-2.5-flash-image-preview`).
   * Returns `{ b64_json, mimeType, usage }` so callers can match the
   * OpenAI Images.generate shape without caring about the provider.
   *
   * Supports reference images: pass `options.reference_images = [{ data, mimeType }]`
   * and Gemini will edit / compose rather than generate from scratch.
   */
  async generateImage(prompt, options = {}) {
    const imageModel = options.model || process.env.GEMINI_MODEL_IMAGE || 'gemini-2.5-flash-image'
    const genModel = this.client.getGenerativeModel({ model: imageModel })

    const parts = [{ text: String(prompt || '') }]
    for (const ref of options.reference_images || []) {
      if (ref?.data) {
        parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.data } })
      }
    }

    try {
      const result = await genModel.generateContent({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: options.temperature ?? 0.9 },
      })
      const candidate = result.response.candidates?.[0]
      const imgPart = (candidate?.content?.parts || []).find((p) => p?.inlineData?.data)
      if (!imgPart) {
        throw new Error('Gemini image response did not include inline image data')
      }
      return {
        b64_json: imgPart.inlineData.data,
        mimeType: imgPart.inlineData.mimeType || 'image/png',
        model: imageModel,
        usage: candidate?.usageMetadata || null,
      }
    } catch (err) {
      this._wrapError(err)
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Extract plain text out of either a string or an OpenAI multi-part
 * content array. Drops image parts (they go through parts separately).
 */
function _extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

/**
 * Convert an OpenAI content value (string OR multi-part array) into
 * Gemini `parts: [...]`. Text parts become `{text}` and image_url data
 * URIs become `{inlineData: {mimeType, data}}`. Non-data URLs (http)
 * are skipped — Gemini wants bytes inline.
 */
function _toGeminiParts(content) {
  if (typeof content === 'string') {
    return [{ text: content }]
  }
  if (!Array.isArray(content)) return [{ text: String(content || '') }]

  const parts = []
  for (const p of content) {
    if (p?.type === 'text' && typeof p.text === 'string') {
      parts.push({ text: p.text })
      continue
    }
    if (p?.type === 'image_url' && p.image_url?.url) {
      const url = p.image_url.url
      const m = /^data:([^;]+);base64,(.*)$/.exec(url)
      if (m) {
        parts.push({ inlineData: { mimeType: m[1], data: m[2] } })
      }
      // External URLs dropped — Gemini needs inline bytes.
    }
  }
  if (parts.length === 0) parts.push({ text: '' })
  return parts
}

/**
 * Gemini's function-declaration schema rejects a few fields that OpenAI
 * accepts (e.g., `additionalProperties`, `$schema`). Strip them to
 * keep tool calls compatible between providers. Shallow clone — the
 * original object isn't mutated.
 */
function _sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue
    if (v && typeof v === 'object') {
      out[k] = Array.isArray(v) ? v.map(_sanitizeSchema) : _sanitizeSchema(v)
    } else {
      out[k] = v
    }
  }
  // Convert JSON-schema `type: "string"` to Gemini's SchemaType enum when
  // the SDK version expects uppercase. Most recent SDKs accept both; we
  // emit lowercase for compatibility.
  return out
}

// Re-exported for tests
export { _toGeminiParts, _sanitizeSchema, _extractText, SchemaType }
