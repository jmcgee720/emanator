import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  try {
    const { sql, description } = await request.json()

    if (!sql) {
      return NextResponse.json({ error: 'SQL is required' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    })

    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql })

    if (error) {
      // If exec_sql function doesn't exist, try direct query
      const { data: directData, error: directError } = await supabase
        .from('_sql')
        .select('*')
        .limit(0)
        .then(() => {
          // Fallback: use raw SQL via postgrest
          return supabase.rpc('query', { query_text: sql })
        })

      if (directError) {
        console.error('[run-migration] SQL execution failed:', directError)
        return NextResponse.json(
          {
            success: false,
            error: directError.message,
            description
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        description,
        result: directData
      })
    }

    return NextResponse.json({
      success: true,
      description,
      result: data
    })
  } catch (err) {
    console.error('[run-migration] Unexpected error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err.message
      },
      { status: 500 }
    )
  }
}
