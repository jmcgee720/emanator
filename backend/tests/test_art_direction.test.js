/**
 * Tests for the art-direction analyzer.
 */

import { analyzeArtDirection } from '../../lib/ai/art-direction.js'

describe('analyzeArtDirection', () => {
  test('returns null when no attachments', async () => {
    const provider = { chat: jest.fn() }
    const result = await analyzeArtDirection([], provider)
    expect(result).toBeNull()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  test('returns null when attachments have no images', async () => {
    const provider = { chat: jest.fn() }
    const result = await analyzeArtDirection([{ type: 'text', name: 'notes.txt', data: 'aGVsbG8=' }], provider)
    expect(result).toBeNull()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  test('returns null when image attachment has no data', async () => {
    const provider = { chat: jest.fn() }
    const result = await analyzeArtDirection([{ type: 'image', name: 'x.png' }], provider)
    expect(result).toBeNull()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  test('calls provider.chat with vision content when image provided', async () => {
    const provider = {
      chat: jest.fn().mockResolvedValue('Aesthetic: Clean editorial.\nPalette: Black/white/coral.\nTypography: Geometric sans.\nLayout: Grid.\nMotion: None.\nAVOID: Neon gradients.'),
    }
    const result = await analyzeArtDirection([
      { type: 'image', name: 'hero.png', data: 'aGVsbG8=' },
    ], provider)
    expect(result).toMatch(/Aesthetic:/)
    expect(result).toMatch(/Palette:/)
    expect(provider.chat).toHaveBeenCalledTimes(1)
    const [messages] = provider.chat.mock.calls[0]
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(Array.isArray(messages[1].content)).toBe(true)
    const imageBlock = messages[1].content.find((b) => b.type === 'image_url')
    expect(imageBlock).toBeDefined()
    expect(imageBlock.image_url.url).toMatch(/^data:image\/(png|jpeg|webp|gif);base64,/)
  })

  test('caps at 4 images to respect token budget', async () => {
    const provider = {
      chat: jest.fn().mockResolvedValue('Aesthetic: ok.\nPalette: ok.\nTypography: ok.\nLayout: ok.\nMotion: ok.\nAVOID: ok.'),
    }
    const atts = Array.from({ length: 7 }, (_, i) => ({ type: 'image', name: `${i}.png`, data: 'aGVsbG8=' }))
    await analyzeArtDirection(atts, provider)
    const [messages] = provider.chat.mock.calls[0]
    const imageBlocks = messages[1].content.filter((b) => b.type === 'image_url')
    expect(imageBlocks.length).toBe(4)
  })

  test('returns null when provider throws (non-blocking)', async () => {
    const provider = { chat: jest.fn().mockRejectedValue(new Error('rate limit')) }
    const result = await analyzeArtDirection([{ type: 'image', name: 'x.png', data: 'aGVsbG8=' }], provider)
    expect(result).toBeNull()
  })

  test('returns null when provider returns empty/tiny string', async () => {
    const provider = { chat: jest.fn().mockResolvedValue('') }
    const result = await analyzeArtDirection([{ type: 'image', name: 'x.png', data: 'aGVsbG8=' }], provider)
    expect(result).toBeNull()
  })

  test('accepts already-formed data URLs', async () => {
    const provider = {
      chat: jest.fn().mockResolvedValue('Aesthetic: x.\nPalette: x.\nTypography: x.\nLayout: x.\nMotion: x.\nAVOID: x.'),
    }
    await analyzeArtDirection([
      { type: 'image', name: 'y.jpg', data: 'data:image/jpeg;base64,bG9s' },
    ], provider)
    const [messages] = provider.chat.mock.calls[0]
    const imageBlock = messages[1].content.find((b) => b.type === 'image_url')
    expect(imageBlock.image_url.url).toBe('data:image/jpeg;base64,bG9s')
  })
})
