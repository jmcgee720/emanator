-- Shared Previews table for public preview links
CREATE TABLE IF NOT EXISTS shared_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token TEXT UNIQUE NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Shared Preview',
  files_snapshot JSONB DEFAULT '[]'::jsonb,
  views INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_previews_token ON shared_previews(share_token);
CREATE INDEX IF NOT EXISTS idx_shared_previews_project ON shared_previews(project_id);

-- Enable RLS
ALTER TABLE shared_previews ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "service_role_full_access" ON shared_previews
  FOR ALL USING (auth.role() = 'service_role');

-- Policy: Anyone can read shared previews by token (public access)
CREATE POLICY "public_read_by_token" ON shared_previews
  FOR SELECT USING (true);
