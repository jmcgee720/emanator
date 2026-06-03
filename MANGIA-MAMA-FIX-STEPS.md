# Mangia Mama Preview Fix — Quick Steps

## The Problem
Preview shows: `Cannot find module '/project/frontend/node_modules/vite/dist/node/chunks/dep-D-7KCb9p.js'`

**Cause**: Database has 13,552 corrupted `node_modules/` rows that the sync process was deleting as "stale"

## The Fix (Choose One)

### ✅ Option 1: Use the UI (Easiest)

1. Open Mangia Mama preview
2. Click **Hard Reset** button (amber/yellow button in the control bar)
3. Wait ~10 seconds
4. Click **Start Preview**
5. Wait 5-10 minutes for fresh `npm install`

### ✅ Option 2: Use the cleanup script

```bash
# Get your session cookie from browser DevTools → Application → Cookies
export COOKIE="your-session-cookie-here"

# Run the cleanup
bash scripts/cleanup-mangia-mama.sh
```

### ✅ Option 3: Call the API directly

```bash
curl -X POST \
  "https://emanator.vercel.app/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/cleanup-node-modules" \
  -H "Cookie: your-session-cookie"
```

## What Was Fixed

1. ✅ **Runner sync excludes `node_modules/`** — Already implemented (preview-runner/index.js)
2. ✅ **Retry logic for failed installs** — Already implemented (2 attempts with clean slate)
3. ✅ **UI controls added** — Stop/Restart/Hard Reset buttons now visible
4. ✅ **Cleanup endpoint exists** — `/api/previews/:id/cleanup-node-modules`

## After the Fix

The preview should:
- ✅ Start successfully
- ✅ Show the Mangia Mama dashboard
- ✅ No "Cannot find module" errors
- ✅ Logs show `node_modules excluded from sync`

## If It Still Fails

Check the runner logs for:
- `[sync] Filtered out XXXX node_modules files` — Should see this
- `[runner] npm install failed` — If you see this, check the error message
- `[runner] node_modules cache hit` — Good, means install was skipped

## Files Changed

- `components/dashboard/tabs/ServerPreview.jsx` — Added UI controls
- `docs/RUNNER-NODE-MODULES-FIX.md` — Full technical documentation
- `scripts/cleanup-mangia-mama.sh` — Cleanup script

## Status

✅ **READY TO FIX** — Just click Hard Reset in the preview window!
