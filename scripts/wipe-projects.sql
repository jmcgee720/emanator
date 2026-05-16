-- ──────────────────────────────────────────────────────────────────────
-- /app/scripts/wipe-projects.sql
--
-- One-shot DB wipe to start fresh after the Feb 2026 file-storage rewrite.
--
-- Why: pre-rewrite projects have many `project_files` rows where content
-- lives in Supabase Storage (storage_path set, content NULL). The runner
-- now expects content inline. Rather than build a backfill migration for
-- a few legacy projects, we just wipe and re-import.
--
-- Scope: deletes ALL projects + all dependent rows (chats, messages,
-- file_change_events, project_files, etc). Auth users are PRESERVED.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   Confirm by re-running the last SELECT — should show 0s across the
--   board.
--
-- HOW TO RECOVER (if you change your mind):
--   You can't. There's no soft-delete. Take a Supabase backup first
--   (Dashboard → Database → Backups) if you care about any of the
--   existing project state.
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

-- Delete in dependency order. Most of these have ON DELETE CASCADE on
-- project_id, but being explicit makes the intent obvious and avoids
-- relying on schema details we might not have memorized.

DELETE FROM messages;
DELETE FROM chats;
DELETE FROM file_change_events;
DELETE FROM project_files;
DELETE FROM projects;

-- Optional: keep these. They're tied to the user account, not projects.
-- Uncomment if you ALSO want to wipe AI memory and credits.
-- DELETE FROM ai_memory;
-- DELETE FROM credit_ledger;
-- DELETE FROM credit_balances;

COMMIT;

-- Verify wipe succeeded:
SELECT
  (SELECT count(*) FROM projects)            AS projects_remaining,
  (SELECT count(*) FROM project_files)       AS project_files_remaining,
  (SELECT count(*) FROM chats)               AS chats_remaining,
  (SELECT count(*) FROM messages)            AS messages_remaining,
  (SELECT count(*) FROM file_change_events)  AS file_change_events_remaining;

-- Storage bucket cleanup (run separately in Supabase Dashboard):
--   Storage → project-files bucket → "..." menu → Delete all objects.
-- This removes the orphaned blobs that no longer have a project_files row.
