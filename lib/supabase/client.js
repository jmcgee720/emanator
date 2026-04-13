import { createBrowserClient } from '@supabase/ssr'

let _client = null

/**
 * Create Supabase browser client (singleton).
 * Patches navigator.locks to suppress AbortError from the auth SDK's
 * internal lock mechanism, which throws unhandled errors on navigation
 * or when Supabase is slow/unreachable.
 */
export function createClient() {
  if (_client) return _client

  // Patch navigator.locks.request to catch AbortError silently
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const originalRequest = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = async (...args) => {
      try {
        return await originalRequest(...args)
      } catch (err) {
        if (err?.name === 'AbortError') {
          console.warn('[Auth] Lock AbortError suppressed')
          return undefined
        }
        throw err
      }
    }
  }

  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  return _client
}
