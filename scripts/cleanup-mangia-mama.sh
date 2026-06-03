#!/bin/bash
# Emergency cleanup for Mangia Mama project
# Removes all node_modules rows from the database and triggers a fresh preview start

PROJECT_ID="e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed"
API_URL="${NEXT_PUBLIC_APP_URL:-https://emanator.vercel.app}"

echo "🧹 Cleaning up Mangia Mama project (${PROJECT_ID})..."
echo "   This will:"
echo "   1. Delete all node_modules/ rows from the database"
echo "   2. Stop the preview machine"
echo "   3. Next start will do a fresh npm install"
echo ""

# Call the cleanup endpoint
curl -X POST \
  "${API_URL}/api/previews/${PROJECT_ID}/cleanup-node-modules" \
  -H "Content-Type: application/json" \
  -H "Cookie: ${COOKIE}" \
  -v

echo ""
echo "✅ Cleanup complete!"
echo "   Refresh the preview window and click 'Start Preview' to rebuild with a clean node_modules/"
