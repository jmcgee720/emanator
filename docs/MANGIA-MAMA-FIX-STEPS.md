# Mangia Mama Preview Fix — Immediate Action Required

## Current Error

```
Internal Server Error
Cannot find module '/project/frontend/node_modules/vite/dist/node/chunks/dep-D-7KCb9p.js'
imported from /project/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js
```

## Root Cause

The database contains **13,552+ corrupted `node_modules` rows** from before the sync fix was deployed. These rows are being synced to the runner, overwriting the correct files installed by `npm install`, causing Vite's internal dependencies to be corrupted.

## The Fix (Already Deployed)

The runner code has been fixed to:
1. **Exclude `node_modules/` from sync entirely** — they are ephemeral build artifacts, not source files
2. **Retry npm install on failure** — automatically recovers from corrupted `node_modules`
3. **Provide a cleanup endpoint** — removes old corrupted rows from the database

## Immediate Action Steps

### Step 1: Clean the Database

Run the cleanup script to remove all corrupted `node_modules` rows:

```bash
# Option A: Via direct script (fastest)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
node scripts/cleanup-mangia-mama-now.js
```

**OR**

```bash
# Option B: Via API endpoint (requires auth token)
curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/cleanup-node-modules \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json"
```

Expected output:
```
[cleanup] Found 13552 node_modules rows to delete
[cleanup] ✅ Successfully deleted 13552 node_modules rows
[cleanup] Next start will do a fresh npm install
```

### Step 2: Restart the Preview

1. Go to the Mangia Mama project in Auroraly
2. Click "Stop Preview" (if running)
3. Click "Start Preview"

The runner will:
- Sync ONLY source files (no `node_modules`)
- Run `npm install` fresh in `/project/frontend/`
- Install all dependencies correctly (including Vite's internal chunks)
- Start the dev server successfully

### Step 3: Verify the Fix

Check the runner logs for these success indicators:

✅ `[sync] node_modules excluded from sync (ephemeral build artifacts, not source files)`
✅ `[sync] wrote X changed, skipped Y identical, removed 0 stale`
✅ `[runner] running npm install in /project/frontend (this may take 1-2 min on cold start)…`
✅ `[dev] VITE v5.x.x ready in XXXms`

The error should be **completely gone**.

## Why This Happened

Before the fix was deployed (Feb 2025), the sync process treated `node_modules/` as source files:

1. User's first preview: `npm install` runs → creates 13,552 files in `node_modules/`
2. Sync writes all 13,552 files to the database (BUG — should have been excluded)
3. User edits a source file → sync runs again
4. Sync sees 13,552 files on disk that aren't in the "source" set → deletes them as "stale"
5. Vite's internal dependencies are now corrupted
6. Next `npm install` tries to repair → fails because some files are missing
7. Preview crashes with "Cannot find module" errors

## Prevention (Already in Place)

The runner now:
- **Never syncs `node_modules`** at any level (root, `frontend/`, `apps/web/`, etc.)
- **Retries npm install** if it fails (deletes corrupted `node_modules` and tries again)
- **Logs clearly** when `node_modules` are excluded

This bug **cannot happen again** after the database is cleaned.

## Project Details

- **Project ID:** `e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed`
- **Project Name:** Mangia Mama
- **Working Directory:** `/project/frontend/`
- **Framework:** Vite + React
- **Affected Files:** All files under `frontend/node_modules/vite/dist/node/chunks/`

## Related Documentation

- `docs/runner-node-modules-fix.md` — Full technical explanation
- `preview-runner/index.js` — Runner sync logic (lines 506-521, 337-386)
- `app/api/previews/[projectId]/cleanup-node-modules/route.js` — Cleanup endpoint
- `scripts/cleanup-mangia-mama-now.js` — Direct cleanup script
