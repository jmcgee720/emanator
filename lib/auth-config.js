/**
 * Auth Configuration
 * Centralized auth redirect URLs - works for localhost and production
 */

/**
 * Get the base URL for auth redirects
 * Uses window.location.origin in browser, falls back to env var for SSR
 */
export function getBaseUrl() {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  // Fallback for SSR - use NEXT_PUBLIC_BASE_URL or construct from request
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
}

/**
 * Auth redirect paths
 */
export const AUTH_PATHS = {
  // Email confirmation (signup, password reset, email change)
  // Supabase sends: /auth/confirm?token_hash=xxx&type=signup
  CONFIRM: '/auth/confirm',
  
  // OAuth code exchange (Google, GitHub, etc.)
  // Provider sends: /auth/callback?code=xxx
  CALLBACK: '/auth/callback',
  
  // Error page
  ERROR: '/auth/error',
  
  // Success destination
  DASHBOARD: '/'
}

/**
 * Get full redirect URL for email confirmation
 * Used in signUp, resetPassword, updateEmail
 */
export function getEmailRedirectUrl() {
  return `${getBaseUrl()}${AUTH_PATHS.CONFIRM}`
}

/**
 * Get full redirect URL for OAuth callback
 * Used in signInWithOAuth
 */
export function getOAuthCallbackUrl() {
  return `${getBaseUrl()}${AUTH_PATHS.CALLBACK}`
}

/**
 * Get full error page URL
 */
export function getErrorUrl(errorMessage) {
  const base = `${getBaseUrl()}${AUTH_PATHS.ERROR}`
  if (errorMessage) {
    return `${base}?error=${encodeURIComponent(errorMessage)}`
  }
  return base
}
