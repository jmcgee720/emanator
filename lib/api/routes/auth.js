import { NextResponse } from 'next/server'
import { handleCORS, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { getUserRole } from '@/lib/constants'
import { checkRateLimit, formatRetryAfter, getClientIp } from '@/lib/rate-limit'

const SIGNUP_LIMIT = 5
const SIGNUP_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function handle(route, method, path, request) {
  // ── /auth/signup-check — rate-limit by IP before hitting Supabase signUp ─
  if (route === '/auth/signup-check' && method === 'POST') {
    let body = {}
    try { body = await request.json() } catch {}

    const ip = getClientIp(request)
    const emailDomain = typeof body.email === 'string' ? body.email.split('@')[1]?.toLowerCase() : ''

    const ipRes = await checkRateLimit(`signup:ip:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS)
    if (!ipRes.allowed) {
      return handleCORS(
        NextResponse.json(
          {
            error: `Too many signup attempts. Try again in ${formatRetryAfter(ipRes.retryAfterMs)}.`,
            retryAfterMs: ipRes.retryAfterMs,
          },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(ipRes.retryAfterMs / 1000)) } },
        ),
      )
    }

    if (emailDomain) {
      const domainRes = await checkRateLimit(
        `signup:domain:${emailDomain}`,
        SIGNUP_LIMIT * 4,
        SIGNUP_WINDOW_MS,
        { record: false },
      )
      if (!domainRes.allowed) {
        return handleCORS(
          NextResponse.json(
            {
              error: `Too many signup attempts from this email provider. Try again in ${formatRetryAfter(domainRes.retryAfterMs)}.`,
              retryAfterMs: domainRes.retryAfterMs,
            },
            { status: 429, headers: { 'Retry-After': String(Math.ceil(domainRes.retryAfterMs / 1000)) } },
          ),
        )
      }
    }

    return handleCORS(NextResponse.json({ allowed: true, remaining: SIGNUP_LIMIT - ipRes.count }))
  }

  if (route === '/auth/check' && method === 'POST') {
    const body = await request.json()
    const { email, provider } = body
    
    if (!email) {
      return handleCORS(NextResponse.json({ error: 'Email required' }, { status: 400 }))
    }
    
    let user = await checkAllowlist(email)

    // Auto-create user for OAuth providers (Google, etc.)
    if (!user && provider === 'google') {
      user = await db.users.create({
        email,
        role: 'user',
        is_allowlisted: true,
      })
    }

    if (!user) {
      return handleCORS(NextResponse.json({ 
        allowed: false, 
        message: 'Access denied. Contact owner for approval.' 
      }, { status: 403 }))
    }
    
    return handleCORS(NextResponse.json({ 
      allowed: true, 
      user: { id: user.id, email: user.email, role: getUserRole(user) }
    }))
  }

  return null
}
