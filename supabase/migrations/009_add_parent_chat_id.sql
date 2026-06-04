-- Add parent_chat_id column to chats table for fork tracking
-- This enables fork-of-fork lineage and auto-summary generation

ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS parent_chat_id UUID REFERENCES chats(id) ON DELETE SET NULL;

-- Index for parent chat lookups
CREATE INDEX IF NOT EXISTS idx_chats_parent_chat_id ON chats(parent_chat_id);

-- Comment for documentation
COMMENT ON COLUMN chats.parent_chat_id IS 'References the parent chat when this chat is a fork. Enables fork lineage tracking and auto-summary generation.';
