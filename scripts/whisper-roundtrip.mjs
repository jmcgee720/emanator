// Live Whisper round-trip verifier. Generates a tiny speech WAV locally
// (a silent file the API will classify as no speech, or a URL-downloaded
// sample if available), sends it through TranscribeService, and prints
// what comes back.
//
// Run: node scripts/whisper-roundtrip.mjs
// Requires: EMERGENT_LLM_KEY + EMERGENT_PROXY_URL in env.

// Load env from .env.local
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Minimal dotenv so we don't pull another dep.
try {
  const envPath = join(root, '.env.local')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m) {
        const key = m[1]
        let val = m[2].trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        if (!process.env[key]) process.env[key] = val
      }
    }
  }
} catch (err) {
  console.warn('[whisper-roundtrip] Could not load .env.local:', err.message)
}

// Synthesize a 2-second 16kHz mono WAV with a soft sine tone. Whisper
// will typically return an empty string (or the tone-interpretation
// word "you" that it commonly picks up from pure tones). Either way the
// API returns a 200 and we've verified the round-trip.
function buildSineWav({ durationSec = 2, hz = 300, sampleRate = 16000 } = {}) {
  const samples = durationSec * sampleRate
  const bytesPerSample = 2
  const dataSize = samples * bytesPerSample
  const fileSize = 44 + dataSize
  const buf = Buffer.alloc(fileSize)
  let p = 0
  // RIFF header
  buf.write('RIFF', p); p += 4
  buf.writeUInt32LE(fileSize - 8, p); p += 4
  buf.write('WAVE', p); p += 4
  // fmt chunk
  buf.write('fmt ', p); p += 4
  buf.writeUInt32LE(16, p); p += 4            // chunk size
  buf.writeUInt16LE(1, p); p += 2             // PCM format
  buf.writeUInt16LE(1, p); p += 2             // channels
  buf.writeUInt32LE(sampleRate, p); p += 4
  buf.writeUInt32LE(sampleRate * bytesPerSample, p); p += 4 // byte rate
  buf.writeUInt16LE(bytesPerSample, p); p += 2              // block align
  buf.writeUInt16LE(16, p); p += 2                          // bits per sample
  // data chunk
  buf.write('data', p); p += 4
  buf.writeUInt32LE(dataSize, p); p += 4
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    const v = Math.round(Math.sin(2 * Math.PI * hz * t) * 12000) // moderate amplitude
    buf.writeInt16LE(v, p)
    p += 2
  }
  return buf
}

async function main() {
  if (!process.env.EMERGENT_LLM_KEY && !process.env.OPENAI_API_KEY) {
    console.error('[whisper-roundtrip] No API key found in env. Set EMERGENT_LLM_KEY or OPENAI_API_KEY.')
    process.exit(1)
  }

  const { getTranscribeService } = await import('../lib/ai/transcribe-service.js')

  const wav = buildSineWav({ durationSec: 2, hz: 440, sampleRate: 16000 })
  console.log('[whisper-roundtrip] Generated %d-byte WAV buffer', wav.length)

  const svc = getTranscribeService()
  const startedAt = Date.now()
  try {
    const { text, raw } = await svc.transcribe(wav, 'tone.wav', { language: 'en' })
    const elapsed = Date.now() - startedAt
    console.log('[whisper-roundtrip] SUCCESS in %dms', elapsed)
    console.log('[whisper-roundtrip] text:', JSON.stringify(text))
    console.log('[whisper-roundtrip] raw:', typeof raw === 'object' ? JSON.stringify(raw).slice(0, 200) : String(raw).slice(0, 200))
    process.exit(0)
  } catch (err) {
    console.error('[whisper-roundtrip] FAILED after %dms:', Date.now() - startedAt)
    console.error('[whisper-roundtrip] error:', err?.user_message || err?.message || err)
    console.error('[whisper-roundtrip] status:', err?.status_code)
    process.exit(2)
  }
}

main()
