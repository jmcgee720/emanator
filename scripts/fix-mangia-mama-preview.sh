#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# ONE-CLICK FIX: Mangia Mama Preview
# ──────────────────────────────────────────────────────────────────────
# This script:
#   1. Checks if node_modules rows exist in the database
#   2. Deletes them if found
#   3. Provides instructions to restart the preview
#
# Usage:
#   ./scripts/fix-mangia-mama-preview.sh
#
# The script will read Supabase credentials from .env.local automatically.
# ──────────────────────────────────────────────────────────────────────

set -e

PROJECT_ID="e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "════════════════════════════════════════════════════════════════════"
echo "  Mangia Mama Preview Fix"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Project Name: Mangia Mama"
echo ""

# Load environment variables from .env.local
if [ -f "$ROOT_DIR/.env.local" ]; then
  echo "[1/3] Loading Supabase credentials from .env.local…"
  export $(grep -v '^#' "$ROOT_DIR/.env.local" | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)
else
  echo "ERROR: .env.local not found in $ROOT_DIR"
  echo "Please create .env.local with:"
  echo "  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co"
  echo "  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key"
  exit 1
fi

if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local"
  exit 1
fi

echo "✅ Credentials loaded"
echo ""

# Step 1: Check if cleanup is needed
echo "[2/3] Checking for corrupted node_modules rows in database…"
node "$SCRIPT_DIR/check-node-modules-in-db.js" "$PROJECT_ID"
echo ""

# Step 2: Run cleanup
echo "[3/3] Running cleanup…"
node "$SCRIPT_DIR/cleanup-mangia-mama-now.js"
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo "  ✅ CLEANUP COMPLETE"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Go to https://auroraly.co/projects/$PROJECT_ID"
echo "  2. Click 'Stop Preview' (if running)"
echo "  3. Click 'Start Preview'"
echo ""
echo "The preview should now start successfully without the Vite error."
echo ""
echo "Expected runner logs:"
echo "  ✅ [sync] node_modules excluded from sync"
echo "  ✅ [sync] removed 0 stale"
echo "  ✅ [runner] running npm install in /project/frontend"
echo "  ✅ [dev] VITE v5.x.x ready"
echo ""
