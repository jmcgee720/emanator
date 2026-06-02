# Auroraly Scripts

This directory contains maintenance and recovery scripts for the Auroraly platform.

## node_modules Cleanup Scripts

These scripts fix the "removed 13552 stale" bug that corrupted `node_modules` in preview runners.

### Quick Fix (Recommended)

```bash
# Make scripts executable (first time only)
chmod +x scripts/*.sh

# Run the one-click fix for Mangia Mama
./scripts/fix-mangia-mama-preview.sh
```

This script will:
1. Load Supabase credentials from `.env.local`
2. Check if corrupted `node_modules` rows exist
3. Delete them if found
4. Provide instructions to restart the preview

### Individual Scripts

#### Check if cleanup is needed
```bash
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/check-node-modules-in-db.js <project-id>
```

#### Clean up a specific project
```bash
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/cleanup-node-modules-from-db.js <project-id>
```

#### Clean up Mangia Mama specifically
```bash
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/cleanup-mangia-mama-now.js
```

#### Trigger cleanup via API
```bash
AURORALY_SESSION_TOKEN=... \
./scripts/trigger-cleanup-mangia-mama.sh
```

## Environment Variables

All scripts require Supabase credentials:

```bash
# Add to .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The `fix-mangia-mama-preview.sh` script reads these automatically from `.env.local`.

## Documentation

- `docs/runner-node-modules-fix.md` — Full technical explanation
- `docs/MANGIA-MAMA-FIX-STEPS.md` — Step-by-step fix guide
- `RUNNER-NODE-MODULES-FIX-SUMMARY.md` — Complete summary

## Troubleshooting

### "Cannot find module" errors in preview

**Symptom:** Preview shows "Cannot find module '/project/frontend/node_modules/vite/dist/node/chunks/dep-D-7KCb9p.js'"

**Cause:** Database contains corrupted `node_modules` rows from before the sync fix was deployed.

**Solution:** Run `./scripts/fix-mangia-mama-preview.sh` and restart the preview.

### "removed XXXXX stale" in runner logs

**Symptom:** Runner logs show "removed 13552 stale" and delete dependency files.

**Cause:** This was a bug in the sync process (now fixed).

**Solution:** The fix is already deployed. If you see this message, it means the runner is using old code. Check that the latest `preview-runner/index.js` is deployed.

### npm install fails repeatedly

**Symptom:** `npm install` exits with code 1, retry also fails.

**Cause:** Corrupted `node_modules` in the database are being synced after the install completes.

**Solution:** Run the cleanup script to remove the corrupted rows, then restart the preview.

## Prevention

The runner now:
- **Excludes `node_modules/` from sync** at all levels (root, `frontend/`, `apps/web/`, etc.)
- **Retries `npm install`** if it fails (deletes corrupted `node_modules` and tries again)
- **Logs clearly** when `node_modules` are excluded

This bug cannot happen again after the database is cleaned.
