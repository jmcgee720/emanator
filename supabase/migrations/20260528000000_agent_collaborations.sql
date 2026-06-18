-- Agent Collaboration Sessions
-- Allows Project Agent and Core System to collaborate on solving issues
-- User can observe, pause, resume, or end the session at any time

CREATE TABLE IF NOT EXISTS agent_collaborations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  core_chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'resolved', 'cancelled')),
  message_count INT NOT NULL DEFAULT 0,
  credits_used DECIMAL(10,2) NOT NULL DEFAULT 0,
  initial_context TEXT,
  resolution_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Index for finding active collaborations by chat
CREATE INDEX IF NOT EXISTS idx_collaborations_project_chat ON agent_collaborations(project_chat_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_collaborations_core_chat ON agent_collaborations(core_chat_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_collaborations_user ON agent_collaborations(user_id);

-- Add collaboration metadata to messages table (no schema change needed - uses existing metadata JSONB)
-- Messages with metadata.collaboration_id are part of a collaboration session
-- Messages with metadata.from_agent = 'project' | 'core_system' show which agent sent them
