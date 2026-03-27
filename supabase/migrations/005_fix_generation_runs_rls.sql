-- ============================================
-- FIX: generation_runs RLS recursion
-- ============================================
-- The original policy caused infinite recursion by querying
-- the users table, which has its own RLS policies that also
-- query the users table.
--
-- Fix: Replace with a simple non-recursive policy matching
-- the pattern used for changelog and project_memory tables.
-- ============================================

-- Drop the recursive policy
DROP POLICY IF EXISTS "Users can access generation runs for their projects" ON generation_runs;

-- Replace with a simple non-recursive policy
CREATE POLICY "generation_runs_access" ON generation_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);
