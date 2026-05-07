-- ──────────────────────────────────────────────────────────────────────
-- 2026-05-07 — Storage migration + indexes
--
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/cawmmqakaxbznbelcrwd/sql/new
--
-- IDEMPOTENT — safe to re-run any time. Estimated runtime: <2 seconds.
-- ──────────────────────────────────────────────────────────────────────

-- ─── project_files (the hottest table) ───
CREATE INDEX IF NOT EXISTS idx_project_files_project_id
  ON public.project_files(project_id);

CREATE INDEX IF NOT EXISTS idx_project_files_project_path
  ON public.project_files(project_id, path);

CREATE INDEX IF NOT EXISTS idx_project_files_project_updated
  ON public.project_files(project_id, updated_at DESC);

ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

COMMENT ON COLUMN public.project_files.storage_path IS
  'Object-storage key inside the project-files bucket. When set, content is NULL and the file body lives in Supabase Storage. Files <= 8KB stay inline in content for low-roundtrip reads.';

-- ─── projects ───
CREATE INDEX IF NOT EXISTS idx_projects_user_id
  ON public.projects(user_id);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
  ON public.projects(user_id, updated_at DESC);

-- ─── chats (queried by project_id) ───
CREATE INDEX IF NOT EXISTS idx_chats_project_id
  ON public.chats(project_id);

CREATE INDEX IF NOT EXISTS idx_chats_project_created
  ON public.chats(project_id, created_at);

-- ─── messages (queried by chat_id) ───
CREATE INDEX IF NOT EXISTS idx_messages_chat_id
  ON public.messages(chat_id);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created
  ON public.messages(chat_id, created_at);

-- ─── file_change_events ───
CREATE INDEX IF NOT EXISTS idx_file_change_events_project_id
  ON public.file_change_events(project_id);

CREATE INDEX IF NOT EXISTS idx_file_change_events_project_created
  ON public.file_change_events(project_id, created_at DESC);

-- ─── Tell the planner about the new indexes ───
ANALYZE public.project_files;
ANALYZE public.projects;
ANALYZE public.chats;
ANALYZE public.messages;
ANALYZE public.file_change_events;
