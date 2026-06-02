# Runner node_modules Fix — Complete Summary

## Status: ✅ FIX DEPLOYED, CLEANUP REQUIRED

All code fixes are deployed to production. The Mangia Mama project requires a one-time database cleanup to remove corrupted `node_modules` rows.

---

## What Was Fixed

### 1. Runner Sync Exclusion (DEPLOYED)
**File:** `preview-runner/index.js` (lines 506-521)

```javascript
const PRESERVE_ANYWHERE = new Set(['node_modules'])
async function collectDiskPaths(dir, rel = '') {
  // ...
  if (PRESERVE_ANYWHERE.has(ent.name)) continue  // Skip node_modules at ANY level
  // ...
}
```

**Result:** `node_modules/` is now excluded from sync at ALL levels (root, `frontend/`, `apps/web/`, etc.)

### 2. npm install Retry Logic (DEPLOYED)
**File:** `preview-runner/index.js` (lines 337-386)

```javascript
// Retry logic: if npm install fails (exit code 1), it's often because
// node_modules is corrupted from a previous failed install or sync bug.
// Delete the entire directory and retry once from scratch.
let attempt = 0
const maxAttempts = 2
while (attempt < maxAttempts) {
  attempt++
  try {
    await new Promise((res, rej) => {
      installProc = spawn('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'], { cwd })
      // ...
    })
    break  // Success
  } catch (err) {
    if (attempt < maxAttempts) {
      appendLog('runner', `[runner] npm install failed (attempt ${attempt}/${maxAttempts}): ${err.message}`)
      appendLog('runner', `[runner] deleting corrupted node_modules and retrying from scratch…`)
      await rm(join(cwd, 'node_modules'), { recursive: true, force: true })
      await new Promise(r => setTimeout(r, 500))
    } else {
      throw err  // Final attempt failed
    }
  }
}
```

**Result:** If `npm install` fails, the runner automatically deletes `node_modules` and retries once.

### 3. Database Cleanup Endpoint (DEPLOYED)
**File:** `app/api/previews/[projectId]/cleanup-node-modules/route.js`

```javascript
POST /api/previews/:projectId/cleanup-node-modules
```

**Result:** Removes all `node_modules` rows from the database for a given project.

---

## What Needs to Happen Now

### For Mangia Mama (Project ID: `e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed`)

**Current Error:**
```
Cannot find module '/project/frontend/node_modules/vite/dist/node/chunks/dep-D-7KCb9p.js'
```

**Root Cause:** Database contains 13,552+ corrupted `node_modules` rows from before the fix was deployed.

**Solution:** Run the cleanup script ONCE:

```bash
# Check if cleanup is needed
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/check-node-modules-in-db.js e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed

# If cleanup is needed, run:
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/cleanup-mangia-mama-now.js
```

**OR** call the API endpoint:

```bash
curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/cleanup-node-modules \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json"
```

**Then:** Restart the preview. The error will be gone.

---

## Verification

After cleanup and restart, runner logs should show:

✅ `[sync] node_modules excluded from sync (ephemeral build artifacts, not source files)`
✅ `[sync] wrote X changed, skipped Y identical, removed 0 stale`  ← **0 stale, not 13552**
✅ `[runner] running npm install in /project/frontend (this may take 1-2 min on cold start)…`
✅ `[dev] VITE v5.x.x ready in XXXms`

---

## Files Created/Modified

### Code Fixes (Already Deployed)
- `preview-runner/index.js` — Sync exclusion + retry logic

### Cleanup Tools (Already Deployed)
- `app/api/previews/[projectId]/cleanup-node-modules/route.js` — API endpoint
- `scripts/cleanup-node-modules-from-db.js` — Generic cleanup script
- `scripts/cleanup-mangia-mama-now.js` — Mangia Mama specific cleanup
- `scripts/check-node-modules-in-db.js` — Check if cleanup is needed
- `scripts/trigger-cleanup-mangia-mama.sh` — Bash wrapper for API call

### Documentation (Already Deployed)
- `docs/runner-node-modules-fix.md` — Full technical explanation
- `docs/MANGIA-MAMA-FIX-STEPS.md` — Step-by-step fix guide
- `RUNNER-NODE-MODULES-FIX-SUMMARY.md` — This file

---

## Timeline

1. **Before Feb 2025:** Sync process treated `node_modules/` as source files → wrote 13,552 rows to database
2. **Feb 2025:** Sync bug caused "removed 13552 stale" → deleted critical dependency files
3. **Today:** Code fix deployed → `node_modules/` now excluded from sync
4. **Next:** Database cleanup required → removes old corrupted rows
5. **After cleanup:** Preview works correctly → fresh `npm install` on every start

---

## Prevention

This bug **cannot happen again** because:

1. `node_modules/` is now excluded from sync at the code level
2. The runner retries `npm install` if it fails
3. The cleanup endpoint is available for emergency recovery

---

## Questions?

See:
- `docs/runner-node-modules-fix.md` for technical details
- `docs/MANGIA-MAMA-FIX-STEPS.md` for immediate action steps
