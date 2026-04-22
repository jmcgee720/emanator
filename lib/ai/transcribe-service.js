import OpenAI from 'openai'
import { toFile } from 'openai/uploads'
import { classifyProviderError } from './errors.js'

/**
 * Whisper transcription service. Uses the same env-key convention as
 * the rest of the AI pipeline:
 *   - direct OPENAI_API_KEY    → bypasses Emergent proxy
 *   - EMERGENT_LLM_KEY         → routed through EMERGENT_PROXY_URL
 * Model: `whisper-1` (OpenAI Whisper).
 */
export class TranscribeService {
  constructor() {
    const directKey = process.env.OPENAI_API_KEY
    const emergentKey = process.env.EMERGENT_LLM_KEY
    const apiKey = directKey || emergentKey
    if (!apiKey) {
      throw new Error('No platform API key configured for transcription')
    }
    const opts = { apiKey }
    if (!directKey && emergentKey && process.env.EMERGENT_PROXY_URL) {
      opts.baseURL = process.env.EMERGENT_PROXY_URL
    }
    this.client = new OpenAI(opts)
  }

  /**
   * Transcribe an audio Buffer / Blob / File / Uint8Array.
   *
   * @param {Buffer|Blob|Uint8Array|Object} audio - raw audio bytes
   * @param {string} [filename='audio.webm'] - hint for the Whisper API
   * @param {Object} [opts]
   * @param {string} [opts.language] - ISO-639-1 code (e.g. 'en')
   * @param {string} [opts.prompt]   - context hint
   * @param {'json'|'text'|'verbose_json'} [opts.response_format='json']
   * @returns {Promise<{text: string, raw: any}>}
   */
  async transcribe(audio, filename = 'audio.webm', opts = {}) {
    try {
      const file = await toFile(audio, filename)
      const res = await this.client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: opts.response_format || 'json',
        ...(opts.language ? { language: opts.language } : {}),
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
        ...(Number.isFinite(opts.temperature) ? { temperature: opts.temperature } : {}),
      })
      const text = typeof res === 'string' ? res : (res?.text || '')
      return { text, raw: res }
    } catch (err) {
      throw classifyProviderError(err, 'openai', 'whisper-1')
    }
  }
}

// Module-level singleton so every route reuses one OpenAI client.
let _service = null
export function getTranscribeService() {
  if (!_service) _service = new TranscribeService()
  return _service
}
