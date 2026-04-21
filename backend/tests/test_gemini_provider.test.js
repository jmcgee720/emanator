/**
 * Unit tests for GeminiProvider. Mocks the @google/generative-ai SDK
 * so we don't hit the live API.
 */

// Mock the SDK before import.
const mockGenerateContent = jest.fn()
const mockGenerateContentStream = jest.fn()
const mockGetGenerativeModel = jest.fn()

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  SchemaType: {},
}))

import { GeminiProvider, _toGeminiParts, _sanitizeSchema, _extractText } from '../../lib/ai/providers/gemini.js'

beforeEach(() => {
  mockGenerateContent.mockReset()
  mockGenerateContentStream.mockReset()
  mockGetGenerativeModel.mockReset()
  mockGetGenerativeModel.mockReturnValue({
    generateContent: mockGenerateContent,
    generateContentStream: mockGenerateContentStream,
  })
})

describe('GeminiProvider.chat', () => {
  test('calls generateContent with converted system + contents', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'hi there' } })
    const p = new GeminiProvider('fake-key', 'gemini-2.5-pro')
    const out = await p.chat([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
    ])
    expect(out).toBe('hi there')

    const modelParams = mockGetGenerativeModel.mock.calls[0][0]
    expect(modelParams.model).toBe('gemini-2.5-pro')
    expect(modelParams.systemInstruction).toBe('you are helpful')

    const contents = mockGenerateContent.mock.calls[0][0].contents
    expect(contents).toHaveLength(1)
    expect(contents[0].role).toBe('user')
    expect(contents[0].parts[0].text).toBe('hello')
  })

  test('multi-part content with image_url data URI becomes inlineData', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } })
    const p = new GeminiProvider('fake-key', 'gemini-2.5-pro')
    await p.chat([
      { role: 'user', content: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ]},
    ])
    const parts = mockGenerateContent.mock.calls[0][0].contents[0].parts
    expect(parts).toHaveLength(2)
    expect(parts[0].text).toBe('describe this')
    expect(parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'AAAA' })
  })

  test('concatenates multiple system messages', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'x' } })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await p.chat([
      { role: 'system', content: 'be concise' },
      { role: 'system', content: 'respond in english' },
      { role: 'user', content: 'hi' },
    ])
    const modelParams = mockGetGenerativeModel.mock.calls[0][0]
    expect(modelParams.systemInstruction).toContain('be concise')
    expect(modelParams.systemInstruction).toContain('respond in english')
  })

  test('maps assistant role to model role', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'x' } })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await p.chat([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ])
    const contents = mockGenerateContent.mock.calls[0][0].contents
    expect(contents[0].role).toBe('user')
    expect(contents[1].role).toBe('model') // assistant → model
    expect(contents[2].role).toBe('user')
  })

  test('passes temperature + max_tokens through generationConfig', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'x' } })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await p.chat([{ role: 'user', content: 'hi' }], { temperature: 0.2, max_tokens: 500 })
    const cfg = mockGetGenerativeModel.mock.calls[0][0].generationConfig
    expect(cfg.temperature).toBe(0.2)
    expect(cfg.maxOutputTokens).toBe(500)
  })

  test('response_format json_object sets responseMimeType', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{}' } })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await p.chat(
      [{ role: 'user', content: 'hi' }],
      { response_format: { type: 'json_object' } },
    )
    const cfg = mockGetGenerativeModel.mock.calls[0][0].generationConfig
    expect(cfg.responseMimeType).toBe('application/json')
  })
})

describe('GeminiProvider.chatWithToolsStream', () => {
  async function* toAsyncIter(arr) { for (const x of arr) yield x }

  test('converts OpenAI tools to functionDeclarations', async () => {
    mockGenerateContentStream.mockResolvedValue({
      stream: toAsyncIter([
        { text: () => 'thinking...', functionCalls: () => [] },
        { text: () => '', functionCalls: () => [{ name: 'create_files', args: { files: [] } }] },
      ]),
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    const gen = p.chatWithToolsStream(
      [{ role: 'user', content: 'make a file' }],
      [{ type: 'function', function: { name: 'create_files', description: 'create files', parameters: { type: 'object', properties: {} } } }],
      {},
    )
    const events = []
    for await (const ev of gen) events.push(ev)

    const modelParams = mockGetGenerativeModel.mock.calls[0][0]
    expect(modelParams.tools).toBeDefined()
    expect(modelParams.tools[0].functionDeclarations[0].name).toBe('create_files')

    const toolCallEv = events.find((e) => e.type === 'tool_calls')
    expect(toolCallEv).toBeDefined()
    expect(toolCallEv.tool_calls[0].function.name).toBe('create_files')
    expect(events[events.length - 1].type).toBe('done')
  })

  test('streams text tokens as they arrive', async () => {
    mockGenerateContentStream.mockResolvedValue({
      stream: toAsyncIter([
        { text: () => 'Hello ', functionCalls: () => [] },
        { text: () => 'world', functionCalls: () => [] },
      ]),
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    const gen = p.chatWithToolsStream([{ role: 'user', content: 'hi' }], [], {})
    const tokens = []
    for await (const ev of gen) {
      if (ev.type === 'token') tokens.push(ev.content)
    }
    expect(tokens).toEqual(['Hello ', 'world'])
  })

  test('tool_choice maps to toolConfig ANY with allowedFunctionNames', async () => {
    mockGenerateContentStream.mockResolvedValue({
      stream: toAsyncIter([{ text: () => '', functionCalls: () => [] }]),
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    const gen = p.chatWithToolsStream(
      [{ role: 'user', content: 'x' }],
      [{ type: 'function', function: { name: 'f', description: '', parameters: { type: 'object' } } }],
      { tool_choice: { type: 'function', function: { name: 'f' } } },
    )
    for await (const _ of gen) { /* drain */ }
    const modelParams = mockGetGenerativeModel.mock.calls[0][0]
    expect(modelParams.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['f'] },
    })
  })
})

describe('GeminiProvider.generateStructured', () => {
  test('forces application/json responseMimeType', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{"ok":true}' } })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    const result = await p.generateStructured([{ role: 'user', content: 'give me {ok}' }], {})
    expect(result).toEqual({ ok: true })
    const cfg = mockGetGenerativeModel.mock.calls[0][0].generationConfig
    expect(cfg.responseMimeType).toBe('application/json')
  })

  test('returns error shape when response is not valid JSON', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'not json' } })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    const result = await p.generateStructured([{ role: 'user', content: 'x' }], {})
    expect(result.error).toBeDefined()
    expect(result.raw).toBe('not json')
  })
})

describe('GeminiProvider.generateImage (Nano Banana)', () => {
  test('returns {b64_json, mimeType, model} from inlineData part', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{
          content: { parts: [
            { text: 'here you go' },
            { inlineData: { data: 'AAAA', mimeType: 'image/png' } },
          ]},
          usageMetadata: { totalTokenCount: 100 },
        }],
      },
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    const out = await p.generateImage('a red dog')
    expect(out.b64_json).toBe('AAAA')
    expect(out.mimeType).toBe('image/png')
    expect(out.model).toBe('gemini-2.5-flash-image-preview')
    expect(out.usage.totalTokenCount).toBe(100)

    const modelParams = mockGetGenerativeModel.mock.calls[0][0]
    expect(modelParams.model).toBe('gemini-2.5-flash-image-preview')

    const contents = mockGenerateContent.mock.calls[0][0].contents
    expect(contents[0].parts[0].text).toBe('a red dog')
  })

  test('attaches reference images as inlineData parts', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ inlineData: { data: 'OUT', mimeType: 'image/jpeg' } }] } }],
      },
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await p.generateImage('edit this to be blue', {
      reference_images: [
        { data: 'REF1', mimeType: 'image/png' },
        { data: 'REF2', mimeType: 'image/jpeg' },
      ],
    })
    const parts = mockGenerateContent.mock.calls[0][0].contents[0].parts
    // 1 prompt + 2 references
    expect(parts).toHaveLength(3)
    expect(parts[0].text).toContain('edit this to be blue')
    expect(parts[1].inlineData).toEqual({ data: 'REF1', mimeType: 'image/png' })
    expect(parts[2].inlineData).toEqual({ data: 'REF2', mimeType: 'image/jpeg' })
  })

  test('throws when response lacks inline image data', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: 'I can only describe it' }] } }],
      },
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await expect(p.generateImage('a red dog')).rejects.toThrow()
  })

  test('custom model override via options.model', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { candidates: [{ content: { parts: [{ inlineData: { data: 'X', mimeType: 'image/png' } }] } }] },
    })
    const p = new GeminiProvider('k', 'gemini-2.5-pro')
    await p.generateImage('x', { model: 'gemini-3-flash-image-preview' })
    expect(mockGetGenerativeModel.mock.calls[0][0].model).toBe('gemini-3-flash-image-preview')
  })
})

describe('Helpers', () => {
  describe('_extractText', () => {
    test('passes through strings', () => {
      expect(_extractText('hello')).toBe('hello')
    })
    test('joins text parts from multi-part array', () => {
      expect(_extractText([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'image_url', image_url: { url: 'x' } },
      ])).toBe('a\nb')
    })
    test('returns empty string for non-string, non-array', () => {
      expect(_extractText(null)).toBe('')
      expect(_extractText({})).toBe('')
    })
  })

  describe('_toGeminiParts', () => {
    test('string → single text part', () => {
      expect(_toGeminiParts('hi')).toEqual([{ text: 'hi' }])
    })
    test('array with text + image data URI', () => {
      expect(_toGeminiParts([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,Z' } },
      ])).toEqual([
        { text: 'a' },
        { inlineData: { mimeType: 'image/jpeg', data: 'Z' } },
      ])
    })
    test('http:// image URLs are dropped (Gemini wants bytes inline)', () => {
      const parts = _toGeminiParts([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ])
      expect(parts).toEqual([{ text: 'a' }])
    })
    test('empty array produces a single empty text part (API requires at least 1)', () => {
      expect(_toGeminiParts([])).toEqual([{ text: '' }])
    })
  })

  describe('_sanitizeSchema', () => {
    test('strips additionalProperties + $schema', () => {
      const out = _sanitizeSchema({
        type: 'object',
        $schema: 'http://json-schema',
        additionalProperties: false,
        properties: { x: { type: 'string' } },
      })
      expect(out).toEqual({
        type: 'object',
        properties: { x: { type: 'string' } },
      })
    })
    test('recurses into nested objects + arrays', () => {
      const out = _sanitizeSchema({
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: {} },
      })
      expect(out).toEqual({
        type: 'array',
        items: { type: 'object', properties: {} },
      })
    })
    test('pass-through for primitives', () => {
      expect(_sanitizeSchema('string')).toBe('string')
      expect(_sanitizeSchema(null)).toBe(null)
    })
  })
})
