-- ============================================
-- PROMO CODES SYSTEM
-- ============================================

-- Add plan column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'unlimited'));

-- Promo codes table
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('unlimited')),
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Index for fast code lookups
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active) WHERE is_active = true;

-- Track promo code redemptions
CREATE TABLE IF NOT EXISTS user_promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, promo_code_id)
);

-- Indexes for redemption queries
CREATE INDEX IF NOT EXISTS idx_user_promo_redemptions_user_id ON user_promo_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_promo_redemptions_promo_code_id ON user_promo_redemptions(promo_code_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_promo_redemptions ENABLE ROW LEVEL SECURITY;

-- Promo codes policies
-- Anyone can view active promo codes (needed for redemption)
CREATE POLICY "Anyone can view active promo codes" ON promo_codes
  FOR SELECT USING (is_active = true);

-- Only owners can manage promo codes
CREATE POLICY "Owners can manage promo codes" ON promo_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE email = auth.email() AND role = 'owner')
  );

-- Redemption policies
-- Users can view their own redemptions
CREATE POLICY "Users can view their own redemptions" ON user_promo_redemptions
  FOR SELECT USING (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

-- Users can insert their own redemptions
CREATE POLICY "Users can redeem codes" ON user_promo_redemptions
  FOR INSERT WITH CHECK (
    user_id IN (SELECT id FROM users WHERE email = auth.email())
  );

-- Owners can view all redemptions
CREATE POLICY "Owners can view all redemptions" ON user_promo_redemptions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE email = auth.email() AND role = 'owner')
  );
