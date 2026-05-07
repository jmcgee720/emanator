-- ──────────────────────────────────────────────────────────────────────
-- 2026-05-07 — Storage migration + indexes
--
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/cawmmqakaxbznbelcrwd/sql/new
--
-- What it does:
--   1. Adds B-tree indexes on the hottest project_files lookup paths.
--      Without these, every "load files for project X" did a sequential
--      scan that got exponentially slower as data grew (and quietly
--      burned all your Disk IO budget).
--
--   2. Adds a `storage_path` column for the new hybrid storage model:
--      small files stay inline in `content` (cheap), big files move to
--      Supabase Storage and `storage_path` points at the bucket key.
--
--   3. Adds matching indexes on related hot tables (chat_messages,
--      projects). These are no-ops if the indexes already exist.
--
-- This migration is IDEMPOTENT — safe to re-run.
-- Estimated runtime: <2 seconds. No table locks beyond the index build.
-- ──────────────────────────────────────────────────────────────────────

-- ─── 1. project_files: hot lookup paths ─────────────────────────────
-- Every chat that loads project context, every preview /sync, every
-- file index call hits one of these patterns. Without the index,
-- Postgres seq-scans the entire table.

CREATE INDEX IF NOT EXISTS idx_project_files_project_id
  ON public.project_files(project_id);

-- Composite index for findByPath() — used by the editor "open file" flow.
CREATE INDEX IF NOT EXISTS idx_project_files_project_path
  ON public.project_files(project_id, path);

-- updated_at index — used by the file-change polling endpoint.
CREATE INDEX IF NOT EXISTS idx_project_files_project_updated
  ON public.project_files(project_id, updated_at DESC);

-- ─── 2. New storage_path column ─────────────────────────────────────
ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

COMMENT ON COLUMN public.project_files.storage_path IS
  'Object-storage key inside the project-files bucket. When set, content is NULL and the file body lives in Supabase Storage. Files <= 8KB stay inline in content for low-roundtrip reads.';

-- ─── 3. Other hot tables ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user_id
  ON public.projects(user_id);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
  ON public.projects(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id
  ON public.chat_messages(project_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created
  ON public.chat_messages(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_file_change_events_project_id
  ON public.file_change_events(project_id);

CREATE INDEX IF NOT EXISTS idx_file_change_events_project_created
  ON public.file_change_events(project_id, created_at DESC);

-- ─── 4. ANALYZE so the planner picks up the new indexes immediately ─
ANALYZE public.project_files;
ANALYZE public.projects;
ANALYZE public.chat_messages;
ANALYZE public.file_change_events;

-- ─── Verification (will return rows after the migration runs) ───────
-- Uncomment to inspect:
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename IN ('project_files', 'projects', 'chat_messages', 'file_change_events')
--   ORDER BY tablename, indexname;
