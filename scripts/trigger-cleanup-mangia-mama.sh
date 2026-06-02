#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Trigger node_modules cleanup for Mangia Mama project
# ──────────────────────────────────────────────────────────────────────
# This calls the cleanup API endpoint to remove all node_modules rows
# from the database for project e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed
# (Mangia Mama) and restart the preview machine.
#
# Usage:
#   AURORALY_SESSION_TOKEN=<your-session-token> ./scripts/trigger-cleanup-mangia-mama.sh
# ──────────────────────────────────────────────────────────────────────

PROJECT_ID="e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed"
API_URL="${AURORALY_API_URL:-https://auroraly.co}/api/previews/${PROJECT_ID}/cleanup-node-modules"

if [ -z "$AURORALY_SESSION_TOKEN" ]; then
  echo "ERROR: AURORALY_SESSION_TOKEN environment variable must be set"
  echo "Usage: AURORALY_SESSION_TOKEN=<token> ./scripts/trigger-cleanup-mangia-mama.sh"
  exit 1
fi

echo "[cleanup] Triggering node_modules cleanup for project ${PROJECT_ID}…"
echo "[cleanup] API endpoint: ${API_URL}"

curl -X POST "${API_URL}" \
  -H "Authorization: Bearer ${AURORALY_SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -v

echo ""
echo "[cleanup] Done. Check the response above for status."
echo "[cleanup] If successful, the next preview start will do a fresh npm install."
