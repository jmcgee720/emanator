import { NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { getUserRole, hasPermission, VALID_ROLES, ROLES } from '@/lib/constants'

// ──────────────────────────────────────────────────────────────────────
// Helper to handle CORS.
//
// CORS spec: Access-Control-Allow-Origin must be EXACTLY ONE origin (or
// `*`). Setting it to a comma-separated list (e.g. the value Vercel had
// in CORS_ORIGINS: "https://www.auroraly.co,https://auroraly.co") is
// invalid and browsers will reject the response — every fetch from the
// dashboard would fail with a CORS error, leaving auth checks stuck.
//
// Pass the `request` as the second arg so we can echo back the SINGLE
// matching origin from the allowlist. Calls without `request` keep the
// raw env value for backwards compatibility (server-side jobs etc).
// ──────────────────────────────────────────────────────────────────────
export function handleCORS(response, request) {
  const raw = process.env.CORS_ORIGINS || '*'
  let originHeader = raw
  if (raw !== '*' && raw.includes(',') && request) {
    const allowed = raw.split(',').map(s => s.trim()).filter(Boolean)
    const incoming = request.headers?.get?.('origin')
    if (incoming && allowed.includes(incoming)) {
      originHeader = incoming
    } else {
      // Default to the first listed origin so we never emit a
      // comma-separated value that browsers will reject.
      originHeader = allowed[0]
    }
  } else if (raw.includes(',')) {
    // No request available — fall back to the first listed origin.
    originHeader = raw.split(',')[0].trim()
  }
  response.headers.set('Access-Control-Allow-Origin', originHeader)
  response.headers.set('Vary', 'Origin')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

// Get user from auth — tries cookies first, then bearer token fallback
// Includes one retry on transient network failures
export async function getAuthUser(request) {
  for (let attempt = 0; attempt < 2; attempt++) {
    // Strategy 1: Cookie-based SSR auth
    try {
      const supabase = await createServerSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) return user
    } catch (e) {
      if (attempt === 0 && e?.message?.includes?.('fetch')) {
        await new Promise(r => setTimeout(r, 1000))
        continue
      }
    }

    // Strategy 2: Bearer token fallback (embedded mode / when cookies don't work)
    if (request) {
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        try {
          const { createClient } = await import('@supabase/supabase-js')
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
          )
          const { data: { user } } = await supabase.auth.getUser(token)
          if (user) return user
        } catch (e) {
          if (attempt === 0 && e?.message?.includes?.('fetch')) {
            await new Promise(r => setTimeout(r, 1000))
            continue
          }
        }
      }
    }
    break
  }

  return null
}

// Check if user is allowlisted, resolve effective role from DB + Supabase Auth metadata.
// When OPEN_SIGNUP=1 (or '1'/'true'), unknown users are auto-created with `is_allowlisted=true`
// so self-signup through Supabase Auth lands directly in a usable app session.
// When OPEN_SIGNUP=0, pre-existing invite-only allowlist behaviour is preserved.
export async function checkAllowlist(email) {
  const ownerEmail = process.env.DEFAULT_OWNER_EMAIL
  const openSignup = ['1', 'true', 'yes'].includes(String(process.env.OPEN_SIGNUP || '').toLowerCase())

if (ownerEmail && email && email.toLowerCase() === ownerEmail.toLowerCase()) {
  // Ensure owner exists in DB and has a valid UUID
  let owner = await db.users.findByEmail(email)

  if (!owner) {
    owner = await db.users.create({
      email,
      role: 'owner',
      is_allowlisted: true
    })
  }

  return owner
}

  let user = await db.users.findByEmail(email)

  // Open-signup path: auto-create a regular member with allowlist=true.
  if (!user && openSignup && email) {
    try {
      user = await db.users.create({
        email,
        role: 'member',
        is_allowlisted: true,
      })
    } catch (e) {
      // Race / unique-violation: re-fetch
      user = await db.users.findByEmail(email)
    }
  }

  if (!user?.is_allowlisted) return null

  if (user.role === 'owner') return user

  try {
    const supabase = getSupabaseAdmin()
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const authUser = authUsers?.find((u) => u.email === email)
    const metaRole = authUser?.user_metadata?.app_role

    if (metaRole === 'admin' || metaRole === 'child_monitored') {
      return { ...user, role: metaRole }
    }
  } catch (error) {
  }

  return user
}

// Initialize default owner — memoized to avoid DB hit on every request
let _ownerInitialized = false
export async function initializeOwner() {
  if (_ownerInitialized) return
  const ownerEmail = process.env.DEFAULT_OWNER_EMAIL
  if (!ownerEmail || ownerEmail === 'YOUR_EMAIL') return
  
  try {
    const existing = await db.users.findByEmail(ownerEmail)
    if (!existing) {
      await db.users.create({
        email: ownerEmail,
        role: 'owner',
        is_allowlisted: true
      })
    }
    _ownerInitialized = true
  } catch (error) {
    console.log('Owner initialization:', error.message)
  }
}
