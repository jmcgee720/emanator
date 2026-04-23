-- ============================================
-- SECURITY AUDIT MIGRATION (2026-02)
-- ============================================
-- Purpose: Close the RLS holes flagged by Supabase's security linter.
--
-- Findings before this migration:
--   1. `changelog` had NO RLS enabled — anon key could read/write freely.
--   2. `generation_runs`, `project_memory` used `USING (true)` — anon bypasses row filtering.
--   3. `shared_previews.public_read_by_token` was `USING (true)` for SELECT (intentional, kept public).
--
-- Principle applied:
--   All backend DB access uses SUPABASE_SERVICE_ROLE_KEY which BYPASSES RLS entirely.
--   Therefore we lock anon + authenticated roles out of internal tables entirely by
--   restricting every policy to `auth.role() = 'service_role'` except where a
--   table is designed to be publicly shareable (shared_previews read-by-token).
--
-- After this migration, hitting these tables with the anon key returns 0 rows and
-- 401/403 on writes. Backend service-role calls remain unaffected.
-- ============================================

-- ============================================
-- 1. CHANGELOG — enable RLS + service-role only
-- ============================================
ALTER TABLE IF EXISTS changelog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "changelog_service_role_only" ON changelog;
CREATE POLICY "changelog_service_role_only" ON changelog
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 2. GENERATION_RUNS — replace USING (true) with service-role only
-- ============================================
ALTER TABLE IF EXISTS generation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generation_runs_access" ON generation_runs;
DROP POLICY IF EXISTS "Users can access generation runs for their projects" ON generation_runs;
DROP POLICY IF EXISTS "generation_runs_service_role_only" ON generation_runs;
CREATE POLICY "generation_runs_service_role_only" ON generation_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 3. PROJECT_MEMORY — replace USING (true) with service-role only
-- ============================================
ALTER TABLE IF EXISTS project_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on project_memory" ON project_memory;
DROP POLICY IF EXISTS "project_memory_service_role_only" ON project_memory;
CREATE POLICY "project_memory_service_role_only" ON project_memory
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 4. SHARED_PREVIEWS — tighten public read (still allow SELECT by token, block writes)
-- ============================================
ALTER TABLE IF EXISTS shared_previews ENABLE ROW LEVEL SECURITY;

-- Writes: service role only
DROP POLICY IF EXISTS "service_role_full_access" ON shared_previews;
DROP POLICY IF EXISTS "shared_previews_service_role_write" ON shared_previews;
CREATE POLICY "shared_previews_service_role_write" ON shared_previews
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Reads: keep public SELECT so anyone with a share_token can load the preview.
-- NOTE: this is intentional — shared_previews is the one table designed for
-- anonymous read access. The API path validates the token before returning data.
DROP POLICY IF EXISTS "public_read_by_token" ON shared_previews;
CREATE POLICY "shared_previews_public_read" ON shared_previews
  FOR SELECT
  USING (true);

-- ============================================
-- 5. PROJECT_COLLABORATORS — create if missing + lock down
-- ============================================
-- This table may or may not exist yet (depends on whether collaborator API was exercised).
-- The `db.projectCollaborators` layer in /app/lib/supabase/db.js returns [] gracefully
-- if the table is missing, but we create it here to be idempotent and secure-by-default.
CREATE TABLE IF NOT EXISTS project_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);

ALTER TABLE project_collaborators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_collaborators_service_role_only" ON project_collaborators;
CREATE POLICY "project_collaborators_service_role_only" ON project_collaborators
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 6. AUDIT SWEEP — catch any other tables without RLS
-- ============================================
-- Defensive: enable RLS on every application table in the public schema that
-- doesn't already have it. Without any policies, RLS-enabled tables deny all
-- non-service-role access (service role bypasses RLS).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('schema_migrations') -- skip supabase internals if any
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = tablename
          AND c.relrowsecurity = true
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE 'Enabled RLS on public.%', t;
  END LOOP;
END
$$;

-- ============================================
-- DONE
-- ============================================
-- To verify post-migration, run: node scripts/check-rls.mjs
