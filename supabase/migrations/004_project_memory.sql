-- Project Memory table
-- Stores key-value memory entries per project for the builder context.

CREATE TABLE IF NOT EXISTS project_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_memory_project_id ON project_memory(project_id);

-- Enable RLS
ALTER TABLE project_memory ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on project_memory"
  ON project_memory
  FOR ALL
  USING (true)
  WITH CHECK (true);
