import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { getTranscribeService } from '@/lib/ai/transcribe-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // multipart/form-data not supported on edge
export const maxDuration = 60

const MAX_AUDIO_BYTES = 20 * 1024 * 1024 // 20 MB — under Whisper's 25MB hard limit

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

/**
 * POST /api/transcribe
 *
 * Multipart form field:
 *   audio: File (webm/opus, mp3, wav, m4a, mp4, mpeg, mpga)
 *   language?: string  ISO-639-1 (e.g. "en")
 *   prompt?: string    context hint
 *
 * Returns: { text: string, duration_ms: number }
 */
export async function POST(request) {
  const authUser = await getAuthUser(request)
  if (!authUser) {
    return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) {
    return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
  }

  let form
  try {
    form = await request.formData()
  } catch (err) {
    return handleCORS(NextResponse.json({ error: 'Invalid form data' }, { status: 400 }))
  }

  const audio = form.get('audio')
  if (!audio || typeof audio === 'string') {
    return handleCORS(NextResponse.json({ error: 'Missing audio file in "audio" field' }, { status: 400 }))
  }

  // Node's FormData File has .size + .arrayBuffer(); guard the size cap.
  const size = typeof audio.size === 'number' ? audio.size : 0
  if (size > MAX_AUDIO_BYTES) {
    return handleCORS(NextResponse.json(
      { error: `Audio too large: ${(size / 1024 / 1024).toFixed(1)}MB (max 20MB)` },
      { status: 413 },
    ))
  }
  if (size === 0) {
    return handleCORS(NextResponse.json({ error: 'Empty audio file' }, { status: 400 }))
  }

  const language = form.get('language') || undefined
  const prompt = form.get('prompt') || undefined
  const filename = audio.name || 'audio.webm'

  try {
    const service = getTranscribeService()
    const buf = Buffer.from(await audio.arrayBuffer())
    const startedAt = Date.now()
    const { text } = await service.transcribe(buf, filename, {
      language: typeof language === 'string' ? language : undefined,
      prompt: typeof prompt === 'string' ? prompt : undefined,
    })
    return handleCORS(NextResponse.json({
      text: (text || '').trim(),
      duration_ms: Date.now() - startedAt,
    }))
  } catch (err) {
    console.error('[api/transcribe] Transcription failed:', err?.user_message || err?.message || err)
    const userMessage = err?.user_message || 'Transcription failed. Please try again.'
    const status = err?.status_code === 401 ? 401 : err?.status_code === 429 ? 429 : 500
    return handleCORS(NextResponse.json({ error: userMessage }, { status }))
  }
}
