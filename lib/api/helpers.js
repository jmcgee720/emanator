import { NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { getUserRole, hasPermission, VALID_ROLES, ROLES } from '@/lib/constants'

// Helper function to handle CORS
export function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
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

// Check if user is allowlisted, resolve effective role from DB + Supabase Auth metadata
export async function checkAllowlist(email) {
  const ownerEmail = process.env.DEFAULT_OWNER_EMAIL

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

  const user = await db.users.findByEmail(email)
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
