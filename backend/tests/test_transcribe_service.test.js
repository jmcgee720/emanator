/**
 * Tests for the Whisper transcription wrapper. Mocks the OpenAI client
 * so we never hit the network — asserts the service passes through the
 * right model/params, handles string responses, and threads errors.
 */

// Mock the module before importing — we swap the constructor for a
// class whose `client.audio.transcriptions.create()` returns whatever
// the test sets in `__mockResolve` / `__mockReject`.
const mockState = { resolve: null, reject: null, lastArgs: null, toFileArgs: null }

jest.mock('openai', () => {
  const FakeClient = function FakeClient(opts) {
    mockState.opts = opts
    this.audio = {
      transcriptions: {
        create: jest.fn((args) => {
          mockState.lastArgs = args
          if (mockState.reject) return Promise.reject(mockState.reject)
          return Promise.resolve(mockState.resolve)
        }),
      },
    }
  }
  return { __esModule: true, default: FakeClient }
})

jest.mock('openai/uploads', () => ({
  __esModule: true,
  toFile: jest.fn((audio, filename) => {
    mockState.toFileArgs = { audio, filename }
    return Promise.resolve({ __file: true, name: filename })
  }),
}))

const { TranscribeService, getTranscribeService } = require('../../lib/ai/transcribe-service.js')

beforeEach(() => {
  mockState.resolve = { text: 'hello world' }
  mockState.reject = null
  mockState.lastArgs = null
  mockState.toFileArgs = null
  mockState.opts = null
  delete process.env.OPENAI_API_KEY
  delete process.env.EMERGENT_LLM_KEY
  delete process.env.EMERGENT_PROXY_URL
})

// Config-independent tests need a key available so the constructor doesn't throw.
function withKey() {
  process.env.OPENAI_API_KEY = 'sk-real'
}

describe('TranscribeService — configuration', () => {
  it('uses OPENAI_API_KEY when set', () => {
    process.env.OPENAI_API_KEY = 'sk-real'
    new TranscribeService()
    expect(mockState.opts).toEqual({ apiKey: 'sk-real' })
  })

  it('ignores EMERGENT_LLM_KEY (direct-only mode)', () => {
    process.env.OPENAI_API_KEY = 'sk-real'
    process.env.EMERGENT_LLM_KEY = 'sk-emergent-test'
    process.env.EMERGENT_PROXY_URL = 'https://proxy.example.test/v1'
    new TranscribeService()
    // Must NOT route through a proxy baseURL.
    expect(mockState.opts).toEqual({ apiKey: 'sk-real' })
    expect(mockState.opts.baseURL).toBeUndefined()
  })

  it('throws when OPENAI_API_KEY is missing', () => {
    expect(() => new TranscribeService()).toThrow(/OPENAI_API_KEY not configured/)
  })

  it('singleton getter returns same instance', () => {
    // reset module-level singleton by requiring fresh
    jest.resetModules()
    process.env.OPENAI_API_KEY = 'sk-real'
    const mod = require('../../lib/ai/transcribe-service.js')
    const a = mod.getTranscribeService()
    const b = mod.getTranscribeService()
    expect(a).toBe(b)
  })
})

describe('TranscribeService — transcribe()', () => {
  beforeEach(withKey)

  it('returns {text} from a JSON-shaped response', async () => {
    const svc = new TranscribeService()
    const buf = Buffer.from('fake-audio')
    const { text, raw } = await svc.transcribe(buf, 'voice.webm')
    expect(text).toBe('hello world')
    expect(raw).toEqual({ text: 'hello world' })
  })

  it('returns {text} from a plain-string response', async () => {
    mockState.resolve = 'just text'
    const svc = new TranscribeService()
    const { text } = await svc.transcribe(Buffer.from('x'), 'voice.webm')
    expect(text).toBe('just text')
  })

  it('wraps audio through openai/uploads.toFile with filename', async () => {
    const svc = new TranscribeService()
    const buf = Buffer.from('x')
    await svc.transcribe(buf, 'meeting.mp3')
    expect(mockState.toFileArgs.filename).toBe('meeting.mp3')
    expect(mockState.lastArgs.file).toEqual({ __file: true, name: 'meeting.mp3' })
  })

  it('passes model=whisper-1 and default json format', async () => {
    const svc = new TranscribeService()
    await svc.transcribe(Buffer.from('x'), 'a.webm')
    expect(mockState.lastArgs.model).toBe('whisper-1')
    expect(mockState.lastArgs.response_format).toBe('json')
  })

  it('optional language + prompt are forwarded only when present', async () => {
    const svc = new TranscribeService()
    await svc.transcribe(Buffer.from('x'), 'a', { language: 'en', prompt: 'about AI' })
    expect(mockState.lastArgs.language).toBe('en')
    expect(mockState.lastArgs.prompt).toBe('about AI')

    mockState.lastArgs = null
    await svc.transcribe(Buffer.from('x'), 'a')
    expect(mockState.lastArgs.language).toBeUndefined()
    expect(mockState.lastArgs.prompt).toBeUndefined()
  })

  it('forwards temperature only when finite', async () => {
    const svc = new TranscribeService()
    await svc.transcribe(Buffer.from('x'), 'a', { temperature: 0.3 })
    expect(mockState.lastArgs.temperature).toBe(0.3)

    mockState.lastArgs = null
    await svc.transcribe(Buffer.from('x'), 'a', { temperature: 'nope' })
    expect(mockState.lastArgs.temperature).toBeUndefined()
  })

  it('custom response_format is forwarded', async () => {
    const svc = new TranscribeService()
    await svc.transcribe(Buffer.from('x'), 'a', { response_format: 'verbose_json' })
    expect(mockState.lastArgs.response_format).toBe('verbose_json')
  })
})

describe('TranscribeService — error handling', () => {
  beforeEach(withKey)

  it('classifies provider errors', async () => {
    mockState.reject = Object.assign(new Error('rate limit'), { status: 429 })
    const svc = new TranscribeService()
    await expect(svc.transcribe(Buffer.from('x'), 'a')).rejects.toThrow()
  })

  it('falls back to empty text when response has no .text', async () => {
    mockState.resolve = {}
    const svc = new TranscribeService()
    const { text } = await svc.transcribe(Buffer.from('x'), 'a')
    expect(text).toBe('')
  })
})
