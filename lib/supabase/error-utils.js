// ──────────────────────────────────────────────────────────────────────
// /app/lib/supabase/error-utils.js
// ──────────────────────────────────────────────────────────────────────
// Sanitizes errors thrown by supabase-js / PostgREST so we never dump
// raw Cloudflare HTML into a JSON error response (which the frontend
// then tried to render — see the Spyrals 520 bug report).
//
// Two responsibilities:
//   1. cleanSupabaseError(err)  → returns a user-friendly message + a
//      {transient, retryable, status} flag set.
//   2. withRetry(fn, opts)      → exponential-backoff wrapper for
//      transient Supabase / Cloudflare 5xx errors.
// ──────────────────────────────────────────────────────────────────────

const HTML_SIGNATURE = /<\s*!?\s*doctype\s+html|<\s*html[\s>]|cloudflare|cf-ray|<\s*head[\s>]|<\s*body[\s>]/i
const TRANSIENT_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530])

/**
 * Return a clean, user-facing message + diagnostics for any Supabase
 * error. Never returns HTML in the message.
 */
export function cleanSupabaseError(err) {
  if (!err) return { message: 'Unknown error', transient: false, retryable: false, status: 0 }

  const raw = typeof err === 'string' ? err : (err.message || err.error_description || err.details || '')
  const status = err.status || err.statusCode || err.code === 'PGRST301' ? 0 : (err.status ?? 0)
  const isHtml = HTML_SIGNATURE.test(raw)

  // Try to pull a status code out of HTML error pages (Cloudflare puts
  // it in <title>Error 520</title> / <h1>Error 520...</h1>).
  let detectedStatus = status
  if (isHtml) {
    const m = raw.match(/error\s+(\d{3})/i)
    if (m) detectedStatus = parseInt(m[1], 10)
  }

  const transient = TRANSIENT_STATUS.has(detectedStatus)
  // Network-level errors (fetch failed, ECONNRESET, AbortError) are also transient.
  const networkLike = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|aborted/i.test(raw)

  let message
  if (isHtml) {
    if (detectedStatus === 520) message = 'Supabase is temporarily unreachable (Cloudflare 520). Please retry in a moment.'
    else if (detectedStatus === 521) message = 'Supabase is offline (Cloudflare 521). Please retry in a moment.'
    else if ([504, 522, 523, 524].includes(detectedStatus)) message = 'Supabase request timed out. Please retry — large imports may need a few attempts.'
    else if (detectedStatus >= 500) message = `Supabase is temporarily unavailable (Cloudflare ${detectedStatus}). Please retry in a moment.`
    else message = 'Supabase returned an unexpected response. Please retry in a moment.'
  } else if (networkLike) {
    message = 'Lost connection to Supabase. Please retry in a moment.'
  } else {
    message = raw || 'Supabase error'
    // Hard cap so a long PostgREST error doesn't blow up the JSON payload.
    if (message.length > 500) message = message.slice(0, 500) + '…'
  }

  return {
    message,
    transient: transient || networkLike,
    retryable: transient || networkLike,
    status: detectedStatus,
  }
}

/**
 * Run `fn` with exponential backoff retries on transient Supabase /
 * Cloudflare 5xx errors. Throws a clean Error with a sanitized message
 * if all retries fail.
 *
 * @param {() => Promise<T>} fn
 * @param {{retries?: number, baseDelayMs?: number, label?: string}} [opts]
 */
export async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 3
  const baseDelay = opts.baseDelayMs ?? 400
  const label = opts.label || 'supabase'
  let lastClean
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const cleaned = cleanSupabaseError(err)
      lastClean = cleaned
      if (!cleaned.retryable || attempt === retries) {
        // Re-throw a clean Error so callers can pass err.message into
        // JSON responses without leaking HTML.
        const e = new Error(`[${label}] ${cleaned.message}`)
        e.original = err
        e.transient = cleaned.transient
        e.status = cleaned.status
        throw e
      }
      // Backoff: 400ms → 800ms → 1600ms → 3200ms
      const delay = baseDelay * Math.pow(2, attempt)
      console.warn(`[${label}] transient error (status=${cleaned.status}), retry ${attempt + 1}/${retries} in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  // unreachable
  const e = new Error(`[${label}] ${lastClean?.message || 'failed after retries'}`)
  e.transient = true
  throw e
}
