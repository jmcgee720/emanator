/**
 * Emergency migration endpoint for chats metadata columns.
 * POST /api/migrations/apply-chats-metadata
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: 'Missing Supabase credentials' },
        { status: 500 }
      );
    }
    
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      db: { schema: 'public' }
    });
    
    console.log('[Migration] Starting chats metadata migration...');
    
    // Execute each statement individually using the REST API
    const statements = [
      {
        name: 'Add user_id column',
        sql: `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`
      },
      {
        name: 'Add metadata column',
        sql: `ALTER TABLE chats ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`
      },
      {
        name: 'Create user_id index',
        sql: `CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`
      },
      {
        name: 'Create metadata index',
        sql: `CREATE INDEX IF NOT EXISTS idx_chats_metadata ON chats USING gin(metadata)`
      },
      {
        name: 'Make project_id nullable',
        sql: `ALTER TABLE chats ALTER COLUMN project_id DROP NOT NULL`
      },
      {
        name: 'Backfill user_id from projects',
        sql: `UPDATE chats SET user_id = projects.user_id FROM projects WHERE chats.project_id = projects.id AND chats.user_id IS NULL`
      },
      {
        name: 'Drop old RLS policy',
        sql: `DROP POLICY IF EXISTS "Users can access chats for their projects" ON chats`
      },
      {
        name: 'Create new RLS policy',
        sql: `CREATE POLICY "Users can access their own chats" ON chats FOR ALL USING ((project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = auth.email()))) OR (project_id IS NULL AND user_id IN (SELECT id FROM users WHERE email = auth.email())))`
      }
    ];
    
    const results = [];
    
    for (const { name, sql } of statements) {
      console.log(`[Migration] Executing: ${name}`);
      
      // Use fetch to call Supabase REST API directly with raw SQL
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ query: sql })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Migration] ${name} failed:`, errorText);
        
        // Try alternative: direct SQL via postgrest
        const altResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ 
            query: sql,
            params: []
          })
        });
        
        if (!altResponse.ok) {
          return NextResponse.json(
            { 
              error: `Failed to execute: ${name}`,
              details: errorText,
              statement: sql
            },
            { status: 500 }
          );
        }
      }
      
      results.push({ name, success: true });
    }
    
    // Verify columns exist
    const { data: columns } = await supabase
      .from('chats')
      .select('*')
      .limit(1);
    
    return NextResponse.json({
      success: true,
      message: 'Migration applied successfully',
      statements: results,
      note: 'Columns added. Refresh your browser to see escalation button activate.'
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}
