import { NextResponse } from 'next/server'
import { handleCORS, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { getUserRole } from '@/lib/constants'

export async function handle(route, method, path, request) {
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
