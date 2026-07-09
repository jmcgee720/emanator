/**
 * Emergency migration endpoint for chats metadata columns.
 * POST /api/migrations/apply-chats-metadata
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MIGRATION_SQL = `
-- Add user_id and metadata columns to chats table for escalation support
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_metadata ON chats USING gin(metadata);

ALTER TABLE chats 
ALTER COLUMN project_id DROP NOT NULL;

UPDATE chats 
SET user_id = projects.user_id 
FROM projects 
WHERE chats.project_id = projects.id 
  AND chats.user_id IS NULL;

DROP POLICY IF EXISTS "Users can access chats for their projects" ON chats;

CREATE POLICY "Users can access their own chats" ON chats
  FOR ALL USING (
    (project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    ))
    OR
    (project_id IS NULL AND user_id IN (
      SELECT id FROM users WHERE email = auth.email()
    ))
  );

COMMENT ON COLUMN chats.user_id IS 'Owner of the chat. For project chats, matches project.user_id. For Core System chats (project_id = NULL), this is the only ownership link.';
COMMENT ON COLUMN chats.metadata IS 'JSON metadata for escalation tracking, fork lineage, and other chat-level state.';
`;

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
      auth: { persistSession: false }
    });
    
    console.log('[Migration] Applying chats metadata migration...');
    
    // Split into individual statements and execute one by one
    const statements = MIGRATION_SQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    const results = [];
    for (const statement of statements) {
      console.log('[Migration] Executing:', statement.substring(0, 80) + '...');
      const { data, error } = await supabase.rpc('exec_sql', { 
        sql_string: statement + ';' 
      });
      
      if (error) {
        console.error('[Migration] Statement failed:', error);
        return NextResponse.json(
          { 
            error: error.message,
            statement: statement.substring(0, 200)
          },
          { status: 500 }
        );
      }
      results.push({ statement: statement.substring(0, 80), success: true });
    }
    
    console.log('[Migration] Verifying columns...');
    const { data: columns, error: verifyError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'chats')
      .in('column_name', ['user_id', 'metadata']);
    
    return NextResponse.json({
      success: true,
      message: 'Migration applied successfully',
      statements: results.length,
      columns: columns || []
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}
