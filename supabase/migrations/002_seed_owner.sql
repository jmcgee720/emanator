-- ============================================
-- SEED DEFAULT OWNER USER
-- Run this AFTER the schema migration
-- Replace 'YOUR_EMAIL' with the actual owner email
-- ============================================

-- Insert the default owner (if not exists)
INSERT INTO users (email, role, is_allowlisted, invited_by)
VALUES ('YOUR_EMAIL', 'owner', true, NULL)
ON CONFLICT (email) 
DO UPDATE SET 
  role = 'owner',
  is_allowlisted = true;

-- Verify the owner was created
SELECT id, email, role, is_allowlisted, created_at 
FROM users 
WHERE email = 'YOUR_EMAIL';
