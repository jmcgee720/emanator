/**
 * Emergency migration endpoint for chats metadata columns.
 * POST /api/migrations/apply-chats-metadata
 * 
 * Applies the migration directly via pg library to bypass Supabase schema cache issues.
 */

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

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
    
    // Extract project ref from URL
    const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    if (!projectRef) {
      return NextResponse.json(
        { error: 'Could not extract project ref from Supabase URL' },
        { status: 500 }
      );
    }
    
    // Use the connection pooler endpoint
    const connectionString = `postgresql://postgres.${projectRef}:${serviceKey}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
    
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    
    console.log('[Migration] Connecting to database...');
    const client = await pool.connect();
    
    console.log('[Migration] Applying chats metadata migration...');
    await client.query(MIGRATION_SQL);
    
    console.log('[Migration] Verifying columns...');
    const { rows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'chats' 
        AND column_name IN ('user_id', 'metadata')
      ORDER BY column_name;
    `);
    
    client.release();
    await pool.end();
    
    return NextResponse.json({
      success: true,
      message: 'Migration applied successfully',
      columns: rows,
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}
