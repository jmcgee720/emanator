-- Agent Learning System: Incidents and Feedback
-- Phase 1: Cross-session learning and feedback capture

-- ============================================
-- AGENT INCIDENTS TABLE
-- ============================================
-- Records when the agent fails, loops, or hits capability limits
-- Used to prevent repeating the same mistakes across sessions

CREATE TABLE IF NOT EXISTS agent_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- What happened
  incident_type TEXT NOT NULL CHECK (incident_type IN (
    'capability_limit',    -- "you can't do X"
    'loop_detected',       -- agent tried same thing 3+ times
    'redundant_question',  -- "you already asked me this"
    'false_confidence',    -- "you said it worked but it didn't"
    'tool_failure',        -- tool returned error
    'wrong_approach'       -- user corrected the approach
  )),
  
  -- Context
  user_request TEXT NOT NULL,           -- what the user asked for
  agent_response TEXT,                  -- what the agent tried
  what_failed TEXT NOT NULL,            -- why it didn't work
  resolution TEXT,                      -- how it was eventually fixed
  turn_number INTEGER,                  -- which turn in the chat
  
  -- For similarity search
  embedding vector(1536),               -- OpenAI text-embedding-3-small
  
  -- Metadata
  metadata JSONB DEFAULT '{}',          -- tool calls, error messages, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_incidents_chat_id ON agent_incidents(chat_id);
CREATE INDEX IF NOT EXISTS idx_agent_incidents_project_id ON agent_incidents(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_incidents_user_id ON agent_incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_incidents_type ON agent_incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_agent_incidents_created_at ON agent_incidents(created_at DESC);

-- Vector similarity search index (requires pgvector extension)
-- CREATE INDEX IF NOT EXISTS idx_agent_incidents_embedding ON agent_incidents 
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- Note: Uncomment above after enabling pgvector extension in Supabase

-- ============================================
-- AGENT FEEDBACK TABLE
-- ============================================
-- Captures user feedback on specific agent actions
-- Used to learn which approaches work and which don't

CREATE TABLE IF NOT EXISTS agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- What action was taken
  action_type TEXT NOT NULL CHECK (action_type IN (
    'file_edit',
    'file_create',
    'file_delete',
    'command_run',
    'diagnosis',
    'explanation',
    'suggestion'
  )),
  action_details JSONB NOT NULL,        -- { file_path, old_str, new_str, etc. }
  
  -- User feedback
  feedback TEXT NOT NULL CHECK (feedback IN ('worked', 'failed', 'partial')),
  user_note TEXT,                       -- free-text explanation
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_feedback_chat_id ON agent_feedback(chat_id);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_message_id ON agent_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_project_id ON agent_feedback(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_user_id ON agent_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_action_type ON agent_feedback(action_type);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_feedback ON agent_feedback(feedback);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_created_at ON agent_feedback(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE agent_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;

-- Users can access incidents for their own sessions
CREATE POLICY "Users can access their own incidents" ON agent_incidents
  FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

-- Users can access feedback for their own sessions
CREATE POLICY "Users can access their own feedback" ON agent_feedback
  FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to search similar incidents by embedding
-- Returns incidents similar to the given embedding, ordered by similarity
CREATE OR REPLACE FUNCTION search_similar_incidents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.8,
  match_count int DEFAULT 5,
  for_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  incident_type text,
  user_request text,
  what_failed text,
  resolution text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    agent_incidents.id,
    agent_incidents.incident_type,
    agent_incidents.user_request,
    agent_incidents.what_failed,
    agent_incidents.resolution,
    1 - (agent_incidents.embedding <=> query_embedding) as similarity
  FROM agent_incidents
  WHERE 
    (for_user_id IS NULL OR agent_incidents.user_id = for_user_id)
    AND agent_incidents.embedding IS NOT NULL
    AND 1 - (agent_incidents.embedding <=> query_embedding) > match_threshold
  ORDER BY agent_incidents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to get feedback stats for an action type
CREATE OR REPLACE FUNCTION get_action_feedback_stats(
  p_action_type text,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  action_type text,
  total_count bigint,
  worked_count bigint,
  failed_count bigint,
  partial_count bigint,
  success_rate float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_action_type as action_type,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE feedback = 'worked') as worked_count,
    COUNT(*) FILTER (WHERE feedback = 'failed') as failed_count,
    COUNT(*) FILTER (WHERE feedback = 'partial') as partial_count,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        COUNT(*) FILTER (WHERE feedback = 'worked')::float / COUNT(*)::float
      ELSE 0
    END as success_rate
  FROM agent_feedback
  WHERE 
    agent_feedback.action_type = p_action_type
    AND (p_user_id IS NULL OR agent_feedback.user_id = p_user_id);
END;
$$;
