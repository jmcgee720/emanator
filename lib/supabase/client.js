import { createBrowserClient } from '@supabase/ssr'

/**
 * Create Supabase browser client.
 * Uses @supabase/ssr's default cookie-based session storage so the
 * server-side route handler can read the same session via cookies().
 *
 * DO NOT override auth.storage — that breaks the cookie flow.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
