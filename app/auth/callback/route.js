import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  const error = searchParams.get('error')
  const error_description = searchParams.get('error_description')

  // Handle error from Supabase
  if (error) {
    console.error('Supabase auth error:', error, error_description)
    return NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent(error_description || error)}`)
  }

  // If no code, redirect to error
  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent('No authentication code provided')}`)
  }

  try {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
            }
          },
        },
      }
    )

    // Exchange the code for a session
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      console.error('Session exchange error:', exchangeError)
      return NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent(exchangeError.message)}`)
    }

    // Successful authentication - redirect to home (dashboard)
    // The main page.js will handle the auth check and show dashboard
    return NextResponse.redirect(origin)

  } catch (error) {
    console.error('Auth callback error:', error)
    return NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent('Authentication failed. Please try again.')}`)
  }
}
