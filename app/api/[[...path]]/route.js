import { NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'

// CORS helper
function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return response
}

// Get authenticated user
async function getAuthUser(request) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return user
  } catch {}

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
    } catch {}
  }

  return null
}

// OPTIONS
export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

// MAIN HANDLER
async function handleRoute(request, { params }) {
  const { path = [] } = params || {}
  const route = `/${path.join('/')}`

  try {

    // REAL AUTH CHECK
    if (route === '/auth/check' && request.method === 'POST') {
      const authUser = await getAuthUser(request)

      if (!authUser) {
        return handleCORS(
          NextResponse.json({ allowed: false, message: 'Not authenticated' })
        )
      }

      const user = await db.users.findByEmail(authUser.email)

      if (!user || !user.is_allowlisted) {
        return handleCORS(
          NextResponse.json({
            allowed: false,
            message: 'Access denied. Contact owner for approval.'
          })
        )
      }

      return handleCORS(
        NextResponse.json({
          allowed: true,
          user
        })
      )
    }

    return handleCORS(
      NextResponse.json({ error: 'Route not found' }, { status: 404 })
    )

  } catch (error) {
    return handleCORS(
      NextResponse.json(
        { error: 'Internal server error', details: error.message },
        { status: 500 }
      )
    )
  }
}

// EXPORTS
export const GET = handleRoute
export const POST = handleRoute