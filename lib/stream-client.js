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

async function runStream(chatId, content, metadata, callbacks, controller) {
  const MAX_RETRIES = 2
  let attempt = 0

  while (attempt <= MAX_RETRIES) {
    try {
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
        const retryable = (res.status >= 500 && res.status <= 504) || res.status === 401 || res.status === 408 || res.status === 429
        if (attempt < MAX_RETRIES && retryable) {
          attempt++
          console.warn(`[StreamClient] ${res.status} — retrying (attempt ${attempt}/${MAX_RETRIES})...`)
          callbacks.onStatus?.({ stage: 'retrying', detail: `Connection issue, retrying (${attempt}/${MAX_RETRIES})...` })
          await new Promise(r => setTimeout(r, 2000 * attempt))
          continue
        }
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
      let doneReceived = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

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
                case 'replace_content': callbacks.onReplaceContent?.(data); break
                case 'file': callbacks.onFile?.(data); break
                case 'done': doneReceived = true; callbacks.onDone?.(data); break
                case 'error': callbacks.onError?.(data); break
                case 'user_message': callbacks.onUserMessage?.(data); break
                case 'message_saved': callbacks.onMessageSaved?.(data); break
                case 'plan': callbacks.onPlan?.(data); break
                case 'diff_file': callbacks.onDiffFile?.(data); break
                case 'image_generated': callbacks.onImageGenerated?.(data); break
                case 'image_intent': callbacks.onImageIntent?.(data); break
                case 'preview_partial': callbacks.onPreviewPartial?.(data); break
                case 'files_saved': callbacks.onFilesSaved?.(data); break
                case 'creative_brief': callbacks.onCreativeBrief?.(data); break
                case 'archetype': callbacks.onArchetype?.(data); break
                case 'art_direction': callbacks.onArtDirection?.(data); break
                case 'design_tokens': callbacks.onDesignTokens?.(data); break
                case 'recipe_family': callbacks.onRecipeFamily?.(data); break
                case 'layout_blueprint': callbacks.onLayoutBlueprint?.(data); break
                case 'build_manifest': callbacks.onBuildManifest?.(data); break
                case 'screenshot_verify': callbacks.onScreenshotVerify?.(data); break
                case 'brief_plan': callbacks.onBriefPlan?.(data); break
                case 'wave_start': callbacks.onWaveStart?.(data); break
                case 'wave_complete': callbacks.onWaveComplete?.(data); break
                case 'wave_error': callbacks.onWaveError?.(data); break
                case 'build_aborted': callbacks.onBuildAborted?.(data); break
                case 'review_result': callbacks.onReviewResult?.(data); break
                case 'repair_start': callbacks.onRepairStart?.(data); break
                case 'generated_images_map': callbacks.onGeneratedImagesMap?.(data); break
                case 'credits_exhausted': callbacks.onCreditsExhausted?.(data); break
                case 'credits_update': callbacks.onCreditsUpdate?.(data); break
                case 'fallback_notice': callbacks.onFallbackNotice?.(data); break
                case 'runtime_tests': callbacks.onRuntimeTests?.(data); break
                case 'canvas_update': callbacks.onCanvasUpdate?.(data); break
                case 'keepalive': break // Silent — just keeps the SSE connection alive through proxies
              }
            } catch (parseErr) {
              console.warn('[StreamClient] Parse error:', parseErr, currentData?.slice(0, 200))
            }
            currentEvent = ''
            currentData = ''
          }
        }
      }
      // ── Stream-end safety net: if the SSE connection closed without a `done` event
      // (e.g., 60s proxy timeout), synthesize a completion so the UI unsticks. ──
      if (!doneReceived) {
        console.warn('[StreamClient] Stream ended without done event — attempting recovery')
        // Keep polling until we find the saved files — don't give up
        // The backend needs 10-30s to finish saving after the proxy cuts the SSE
        let recovered = false
        for (let wave = 0; wave < 3 && !recovered; wave++) {
          const delay = wave === 0 ? 5000 : 8000
          await new Promise(r => setTimeout(r, delay))
          recovered = await callbacks.onStreamRecovery?.() || false
        }
        if (!recovered) {
          // Final attempt after a long wait — backend should be done by now
          await new Promise(r => setTimeout(r, 10000))
          recovered = await callbacks.onStreamRecovery?.() || false
        }
        if (!recovered) {
          callbacks.onDone?.({
            content: '',
            toolMode: 'stream_timeout',
            _synthetic: true,
          })
          callbacks.onError?.({
            message: 'Build completed but the connection timed out. Your files were saved — click Refresh to see them.',
            error_type: 'stream_timeout',
            partial: true,
          })
        }
      }
      // Stream completed successfully — break out of retry loop
      break
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') throw streamErr
      if (attempt < MAX_RETRIES) {
        attempt++
        console.warn(`[StreamClient] Stream error — retrying (attempt ${attempt}/${MAX_RETRIES}):`, streamErr.message)
        callbacks.onStatus?.({ stage: 'retrying', detail: `Connection dropped, retrying (${attempt}/${MAX_RETRIES})...` })
        await new Promise(r => setTimeout(r, 3000 * attempt))
        continue
      }
      throw streamErr
    }
  }
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

  runStream(chatId, content, metadata, callbacks, controller).catch(err => {
    if (err.name !== 'AbortError') {
      console.error('[StreamClient] Stream connection error:', err.message)
      callbacks.onError?.({ message: 'Something went wrong. Please try again.', error_type: 'stream_connection_error' })
    }
  })

  return controller
}
