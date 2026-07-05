-- Add user_id and metadata columns to chats table for escalation support
-- This enables agent-to-agent escalation and Core System chats (project_id = NULL)

-- Add user_id column (required for Core System chats which have no project)
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Add metadata column for escalation tracking and other chat metadata
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);

-- Index for metadata queries (e.g. finding escalation chats)
CREATE INDEX IF NOT EXISTS idx_chats_metadata ON chats USING gin(metadata);

-- Make project_id nullable (Core System chats have no project)
ALTER TABLE chats 
ALTER COLUMN project_id DROP NOT NULL;

-- Backfill user_id for existing chats from their project's user_id
UPDATE chats 
SET user_id = projects.user_id 
FROM projects 
WHERE chats.project_id = projects.id 
  AND chats.user_id IS NULL;

-- Update RLS policies to support Core System chats (project_id = NULL)
DROP POLICY IF EXISTS "Users can access chats for their projects" ON chats;

CREATE POLICY "Users can access their own chats" ON chats
  FOR ALL USING (
    -- Project chats: user owns the project
    (project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    ))
    OR
    -- Core System chats: user_id matches
    (project_id IS NULL AND user_id IN (
      SELECT id FROM users WHERE email = auth.email()
    ))
  );

-- Comments for documentation
COMMENT ON COLUMN chats.user_id IS 'Owner of the chat. For project chats, matches project.user_id. For Core System chats (project_id = NULL), this is the only ownership link.';
COMMENT ON COLUMN chats.metadata IS 'JSON metadata for escalation tracking, fork lineage, and other chat-level state. Example: { is_escalation: true, escalation_source: { chat_id, project_id, task } }';
