'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Mic, Loader2, Square } from 'lucide-react'
import { authFetch } from '@/lib/auth-fetch'

/**
 * Voice-input button for the chat composer. Three states:
 *
 *   idle         → mic icon; click starts recording
 *   recording    → red stop button + elapsed timer; click uploads
 *   transcribing → spinner; click disabled
 *
 * On successful transcription, calls `onTranscript(text)` which the
 * composer appends to the input field.
 *
 * Gracefully no-ops when MediaRecorder / getUserMedia is unavailable
 * (Safari desktop < 14.1, SSR). Permission-denied shows a toast via
 * `onError(message)`.
 */
export default function VoiceInputButton({ onTranscript, onError, disabled = false }) {
  const [state, setState] = useState('idle') // 'idle' | 'recording' | 'transcribing'
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const startedAtRef = useRef(0)
  const tickRef = useRef(null)

  const supported = typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator?.mediaDevices?.getUserMedia

  // Stop timer + release mic on unmount. Always.
  useEffect(() => () => cleanup(), [])

  const cleanup = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) try { t.stop() } catch {}
      streamRef.current = null
    }
    recorderRef.current = null
    chunksRef.current = []
  }, [])

  const startRecording = useCallback(async () => {
    if (!supported) {
      onError?.('Voice input requires a modern browser with microphone support.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mime = pickMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        cleanup()
        if (blob.size < 512) {
          onError?.('Recording too short. Try again.')
          setState('idle')
          return
        }
        await uploadAndTranscribe(blob)
      }
      recorder.start()
      recorderRef.current = recorder

      startedAtRef.current = Date.now()
      setElapsed(0)
      tickRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 250)
      setState('recording')
    } catch (err) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Microphone permission denied. Enable it in your browser settings.'
        : (err?.message || 'Could not start recording.')
      onError?.(msg)
      cleanup()
      setState('idle')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop()
    }
    setState('transcribing')
  }, [])

  const uploadAndTranscribe = useCallback(async (blob) => {
    try {
      setState('transcribing')
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')
      const res = await authFetch('/api/transcribe', { method: 'POST', body: form })
      if (!res.ok) {
        const j = await safeJson(res)
        throw new Error(j?.error || `Transcription failed (${res.status})`)
      }
      const { text } = await res.json()
      if (text) onTranscript?.(text)
      else onError?.('No speech detected.')
    } catch (err) {
      onError?.(err?.message || 'Transcription failed.')
    } finally {
      setState('idle')
    }
  }, [onTranscript, onError])

  if (!supported) return null

  const label = state === 'recording' ? `Recording · ${formatElapsed(elapsed)}` : state === 'transcribing' ? 'Transcribing…' : 'Voice input'
  const onClick = state === 'idle' ? startRecording : state === 'recording' ? stopRecording : null
  const isActive = state === 'recording'
  const isBusy = state === 'transcribing'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isBusy}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-medium transition-all duration-200 border disabled:opacity-50 disabled:cursor-not-allowed ${
        isActive
          ? 'bg-rose-500/15 border-rose-500/30 text-rose-300 animate-pulse'
          : isBusy
          ? 'bg-white/5 border-white/10 text-white/60'
          : 'bg-transparent border-white/10 text-white/60 hover:bg-white/5 hover:text-white/90'
      }`}
      data-testid="voice-input-btn"
      data-state={state}
    >
      {isActive
        ? <Square className="w-3 h-3 fill-current" />
        : isBusy
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Mic className="w-3 h-3" />}
      {isActive && <span className="font-mono tabular-nums" data-testid="voice-input-timer">{formatElapsed(elapsed)}</span>}
    </button>
  )
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  const opts = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const m of opts) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch {}
  }
  return ''
}

function formatElapsed(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

async function safeJson(res) {
  try { return await res.json() } catch { return null }
}
