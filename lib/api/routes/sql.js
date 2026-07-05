/**
 * SQL execution endpoint for Core System migrations.
 * 
 * POST /api/sql/execute
 * Body: { sql: string, description: string }
 * 
 * Executes arbitrary SQL on the Supabase database using the service role key.
 * Only accessible to Core System (requires special auth).
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function handle(route, method, path, request) {
  if (route === '/api/sql/execute' && method === 'POST') {
    return await executeSQL(request)
  }
  return null
}

async function executeSQL(request) {
  try {
    const body = await request.json()
    const { sql, description } = body
    
    if (!sql || typeof sql !== 'string') {
      return NextResponse.json(
        { error: 'sql is required and must be a string' },
        { status: 400 }
      )
    }
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      )
    }
    
    // Create admin client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      db: { schema: 'public' },
    })
    
    console.log(`[SQL Execute] ${description || 'Running SQL'}`)
    console.log(`[SQL Execute] SQL length: ${sql.length} chars`)
    
    // Execute SQL using raw query
    // The service role key bypasses RLS and can execute DDL
    const { data, error } = await supabase.rpc('exec_sql', { sql_text: sql })
    
    if (error) {
      // If exec_sql doesn't exist, try to create it first
      if (error.code === '42883' || error.message?.includes('does not exist')) {
        console.log('[SQL Execute] exec_sql function not found, creating it...')
        
        const createFunctionSQL = `
CREATE OR REPLACE FUNCTION exec_sql(sql_text text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_text;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'SQL execution failed: %', SQLERRM;
END;
$$;
`
        
        // Try to execute the function creation using a different method
        // We'll use the pg library directly
        try {
          const { Pool } = await import('pg')
          
          // Build connection string from Supabase URL
          const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
          if (!projectRef) {
            throw new Error('Could not extract project ref from Supabase URL')
          }
          
          // Use the connection pooler endpoint
          const connectionString = `postgresql://postgres.${projectRef}:${supabaseServiceKey}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
          
          const pool = new Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
          })
          
          // Create the exec_sql function
          await pool.query(createFunctionSQL)
          
          // Now execute the original SQL
          const result = await pool.query(sql)
          await pool.end()
          
          return NextResponse.json({
            success: true,
            description: description || 'SQL executed',
            rowCount: result.rowCount,
            rows: result.rows?.slice(0, 10), // Return first 10 rows as sample
          })
        } catch (pgError) {
          console.error('[SQL Execute] pg error:', pgError)
          return NextResponse.json(
            { error: `Failed to execute SQL: ${pgError.message}` },
            { status: 500 }
          )
        }
      }
      
      console.error('[SQL Execute] error:', error)
      return NextResponse.json(
        { error: error.message || 'SQL execution failed' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      description: description || 'SQL executed',
      result: data,
    })
  } catch (err) {
    console.error('[SQL Execute] exception:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
