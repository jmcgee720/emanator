-- ── 2026-06-22 security fix: enable RLS on agent_collaborations ─────
-- Supabase Database Advisor flagged this table as publicly accessible
-- (rls_disabled_in_public). The table was created by migration
-- 20260528000000_agent_collaborations.sql which forgot to add ALTER TABLE
-- ... ENABLE ROW LEVEL SECURITY and the accompanying policies.
--
-- Why this is critical:
--   • Without RLS, ANY client holding the public anon key can SELECT /
--     INSERT / UPDATE / DELETE every row in this table.
--   • The Collaborate feature itself is currently disabled in app code,
--     but the table still exists and is exposed.
--
-- Fix:
--   1. Enable RLS so every read/write is policy-gated.
--   2. Owner-only policies: a user can only see/touch collaborations
--      where they are the user_id. The service-role key (used by our
--      server-side code in lib/api/...) bypasses RLS entirely, so the
--      app keeps working whether the Collaborate feature is on or off.
--
-- Safe to re-run: uses IF NOT EXISTS / drop-then-create pattern so a
-- partial earlier run won't fail.

ALTER TABLE agent_collaborations ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies (idempotent) before recreating.
DROP POLICY IF EXISTS "collab_owner_select" ON agent_collaborations;
DROP POLICY IF EXISTS "collab_owner_insert" ON agent_collaborations;
DROP POLICY IF EXISTS "collab_owner_update" ON agent_collaborations;
DROP POLICY IF EXISTS "collab_owner_delete" ON agent_collaborations;

-- Only the user who owns the collaboration session can SEE it.
-- auth.uid() returns the authenticated user's UUID from the JWT;
-- it returns NULL for the anon role → policy denies access.
CREATE POLICY "collab_owner_select" ON agent_collaborations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only the owner can CREATE collaborations for themselves. The
-- service-role key bypasses this entirely — server code can still
-- create rows on behalf of a user (e.g. via our REST API).
CREATE POLICY "collab_owner_insert" ON agent_collaborations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Owner can pause / resume / resolve / cancel their own collabs.
CREATE POLICY "collab_owner_update" ON agent_collaborations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Owner can delete their own collabs (e.g. for cleanup).
CREATE POLICY "collab_owner_delete" ON agent_collaborations
  FOR DELETE
  USING (auth.uid() = user_id);
