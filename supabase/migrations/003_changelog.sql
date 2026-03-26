-- Changelog table for grounded planning audit trail
CREATE TABLE IF NOT EXISTS changelog (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_task TEXT DEFAULT '',
  task_mode TEXT DEFAULT 'plan',
  context_paths JSONB DEFAULT '[]'::jsonb,
  validator_result JSONB,
  plan_hash TEXT,
  rejection_reasons JSONB DEFAULT '[]'::jsonb,
  plan_summary TEXT,
  file_actions JSONB,
  constraints_checked JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_changelog_project ON changelog(project_id);
CREATE INDEX IF NOT EXISTS idx_changelog_created ON changelog(created_at DESC);
