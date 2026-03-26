-- MyMergent Database Schema for Supabase
-- Run this SQL in the Supabase SQL Editor

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_allowlisted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_allowlisted ON users(is_allowlisted);

-- ============================================
-- PROJECTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'app' CHECK (type IN ('app', 'website', 'image', 'document')),
  settings JSONB DEFAULT '{}',
  imported_from UUID,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for project queries
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

-- ============================================
-- CHATS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for chat queries
CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);

-- ============================================
-- MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for message queries
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- ============================================
-- PROJECT FILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT DEFAULT '',
  file_type TEXT DEFAULT 'text',
  version INTEGER NOT NULL DEFAULT 1,
  change_source TEXT DEFAULT 'user',
  restored_from UUID,
  imported BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, path)
);

-- Indexes for file queries
CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_path ON project_files(path);

-- ============================================
-- PROJECT CANVAS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS project_canvas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  canvas_content JSONB NOT NULL DEFAULT '{
    "project_overview": "",
    "project_goals": [],
    "key_decisions": [],
    "architecture_notes": [],
    "master_prompts": [],
    "working_prompts": [],
    "failed_prompts": [],
    "successful_patterns": [],
    "feature_requirements": [],
    "technical_specs": [],
    "constraints": [],
    "open_tasks": [],
    "completed_tasks": []
  }',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for canvas queries
CREATE INDEX IF NOT EXISTS idx_project_canvas_project_id ON project_canvas(project_id);

-- ============================================
-- CANVAS EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS canvas_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  change_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for canvas events
CREATE INDEX IF NOT EXISTS idx_canvas_events_project_id ON canvas_events(project_id);

-- ============================================
-- SNAPSHOTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  files_snapshot JSONB DEFAULT '[]',
  canvas_snapshot JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for snapshot queries
CREATE INDEX IF NOT EXISTS idx_snapshots_project_id ON snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at DESC);

-- ============================================
-- EXPORTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL CHECK (export_type IN ('web', 'pwa', 'ios', 'android', 'zip', 'manifest')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  artifact_path TEXT,
  artifact_data JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for export queries
CREATE INDEX IF NOT EXISTS idx_exports_project_id ON exports(project_id);
CREATE INDEX IF NOT EXISTS idx_exports_created_at ON exports(created_at DESC);

-- ============================================
-- DEPLOYMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'vercel',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'building', 'completed', 'failed')),
  url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for deployment queries
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at DESC);

-- ============================================
-- SEARCH INDEX TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS search_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('project', 'chat', 'message', 'file', 'canvas', 'prompt')),
  content_text TEXT NOT NULL,
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for search
CREATE INDEX IF NOT EXISTS idx_search_index_project_id ON search_index(project_id);
CREATE INDEX IF NOT EXISTS idx_search_index_content_type ON search_index(content_type);
-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_search_index_content_text ON search_index USING gin(to_tsvector('english', content_text));

-- ============================================
-- GENERATION RUNS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS generation_runs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tool_mode TEXT NOT NULL,
  files_generated INTEGER DEFAULT 0,
  duration INTEGER, -- milliseconds
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  provider TEXT DEFAULT 'openai',
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for generation runs
CREATE INDEX IF NOT EXISTS idx_generation_runs_project_id ON generation_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_generation_runs_created_at ON generation_runs(created_at DESC);

-- ============================================
-- FILE CHANGE EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS file_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id UUID REFERENCES project_files(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for file change events
CREATE INDEX IF NOT EXISTS idx_file_change_events_project_id ON file_change_events(project_id);
CREATE INDEX IF NOT EXISTS idx_file_change_events_created_at ON file_change_events(created_at DESC);

-- ============================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chats_updated_at ON chats;
CREATE TRIGGER update_chats_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_project_files_updated_at ON project_files;
CREATE TRIGGER update_project_files_updated_at
  BEFORE UPDATE ON project_files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_change_events ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own record" ON users
  FOR SELECT USING (auth.email() = email);

CREATE POLICY "Users can view all users if owner" ON users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE email = auth.email() AND role = 'owner')
  );

CREATE POLICY "Owners can insert users" ON users
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE email = auth.email() AND role = 'owner')
  );

CREATE POLICY "Owners can update users" ON users
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE email = auth.email() AND role = 'owner')
  );

CREATE POLICY "Owners can delete users" ON users
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM users WHERE email = auth.email() AND role = 'owner')
  );

-- Projects policies
CREATE POLICY "Users can view their own projects" ON projects
  FOR SELECT USING (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

CREATE POLICY "Users can insert their own projects" ON projects
  FOR INSERT WITH CHECK (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

CREATE POLICY "Users can update their own projects" ON projects
  FOR UPDATE USING (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

CREATE POLICY "Users can delete their own projects" ON projects
  FOR DELETE USING (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

-- Chats policies (inherit from project ownership)
CREATE POLICY "Users can access chats for their projects" ON chats
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Messages policies
CREATE POLICY "Users can access messages for their projects" ON messages
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Project files policies
CREATE POLICY "Users can access files for their projects" ON project_files
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Project canvas policies
CREATE POLICY "Users can access canvas for their projects" ON project_canvas
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Canvas events policies
CREATE POLICY "Users can access canvas events for their projects" ON canvas_events
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Snapshots policies
CREATE POLICY "Users can access snapshots for their projects" ON snapshots
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Exports policies
CREATE POLICY "Users can access exports for their projects" ON exports
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Deployments policies
CREATE POLICY "Users can access deployments for their projects" ON deployments
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Search index policies
CREATE POLICY "Users can access search index for their projects" ON search_index
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- Generation runs policies
CREATE POLICY "Users can access generation runs for their projects" ON generation_runs
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- File change events policies
CREATE POLICY "Users can access file events for their projects" ON file_change_events
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id IN (
        SELECT id FROM users WHERE email = auth.email()
      )
    )
  );

-- ============================================
-- SERVICE ROLE BYPASS FOR API
-- Note: The service role key bypasses RLS
-- This allows our backend API to manage all data
-- ============================================

-- Grant all permissions to service role (automatically has bypass)
-- The anon key respects RLS policies above
