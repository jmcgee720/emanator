/**
 * Auth-aware fetch utility
 * Automatically attaches bearer token from the current Supabase session
 * Works in both standalone (cookie) and embedded (bearer) modes
 */
import { createClient } from '@/lib/supabase/client'

/**
 * Get the current access token from the Supabase client session
 */
async function getAccessToken() {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return session.access_token
    }
  } catch (err) {
    console.warn('[authFetch] getSession error:', err.message)
  }

  // Fallback to sessionStorage
  if (typeof window !== 'undefined') {
    const stored = sessionStorage.getItem('mymergent_token')
    if (stored) return stored
  }

  console.warn('[authFetch] No access token found')
  return null
}

/**
 * Authenticated fetch — adds Authorization header automatically
 */
export async function authFetch(url, options = {}) {
  const token = await getAccessToken()

  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(url, { ...options, headers })
}
