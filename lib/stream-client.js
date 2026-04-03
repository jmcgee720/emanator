/**
 * SSE Streaming Client for MyMergent AI
 * Reads server-sent events from the streaming endpoint
 */
import { createClient } from '@/lib/supabase/client'

async function getAccessToken() {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) return session.access_token
  } catch {}
  if (typeof window !== 'undefined') {
    const stored = sessionStorage.getItem('mymergent_token')
    if (stored) return stored
  }
  return null
}

/**
 * Send a streaming message request and process SSE events
 * @param {string} chatId
 * @param {string} content - User message
 * @param {object} metadata - { provider, model, scope, executePlan }
 * @param {object} callbacks - { onStatus, onToken, onFile, onDone, onError, onUserMessage, onMessageSaved, onPlan }
 * @returns {AbortController} - Call .abort() to cancel the stream
 */
export function streamMessage(chatId, content, metadata, callbacks) {
  const controller = new AbortController()

  ;(async () => {
    const token = await getAccessToken()
    const res = await fetch(`/api/chats/${chatId}/messages/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, metadata }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Stream request failed' }))
      callbacks.onError?.({ message: err.error || 'Stream request failed' })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // CRITICAL: These must persist across chunk reads.
    // Large SSE events (image_generated ~2MB) span multiple TCP chunks.
    // If reset per-chunk, the event type from chunk 1 is lost by the time
    // the data line completes in chunk N.
    let currentEvent = ''
    let currentData = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE events from buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7)
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6)
        } else if (line === '' && currentEvent && currentData) {
          try {
            const data = JSON.parse(currentData)
            switch (currentEvent) {
              case 'status': callbacks.onStatus?.(data); break
              case 'token': callbacks.onToken?.(data); break
              case 'file': callbacks.onFile?.(data); break
              case 'done': callbacks.onDone?.(data); break
              case 'error': callbacks.onError?.(data); break
              case 'user_message': callbacks.onUserMessage?.(data); break
              case 'message_saved': callbacks.onMessageSaved?.(data); break
              case 'plan': callbacks.onPlan?.(data); break
              case 'diff_file': callbacks.onDiffFile?.(data); break
              case 'image_generated': callbacks.onImageGenerated?.(data); break
              case 'image_intent': callbacks.onImageIntent?.(data); break
              case 'preview_partial': callbacks.onPreviewPartial?.(data); break
            }
          } catch (parseErr) {
            console.warn('[StreamClient] Parse error:', parseErr, currentData?.slice(0, 200))
          }
          currentEvent = ''
          currentData = ''
        }
      }
    }
  })().catch(err => {
    if (err.name !== 'AbortError') {
      // ── Guardrail 4: Streaming fallback — user-friendly message ──
      console.error('[StreamClient] Stream connection error:', err.message)
      callbacks.onError?.({ message: 'Something went wrong. Please try again.', error_type: 'stream_connection_error' })
    }
  })

  return controller
}
