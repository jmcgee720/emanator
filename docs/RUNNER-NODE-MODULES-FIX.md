# Runner `node_modules/` Corruption Fix

## Problem

The Mangia Mama preview was showing this error:

```
Cannot find module '/project/frontend/node_modules/vite/dist/node/chunks/dep-D-7KCb9p.js'
imported from /project/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js
```

**Root cause**: The runner's sync process was treating `node_modules/` as source files and writing them to the database. On subsequent syncs, it would remove them as "stale" (logs showed "removed 13552 stale"), deleting critical dependency files like Vite's internal chunks.

## What Was Fixed

### 1. **Runner sync already excludes `node_modules/`** ✅

The runner's `/sync-from-supabase` endpoint (preview-runner/index.js lines 538-553) already has the fix:

```javascript
const PRESERVE_ANYWHERE = new Set(['node_modules'])
async function collectDiskPaths(dir, rel = '') {
  // Skip node_modules at ANY level (root, frontend/, apps/web/, etc)
  if (PRESERVE_ANYWHERE.has(ent.name)) continue
```

This prevents:
- Writing `node_modules/` files to the database
- Removing `node_modules/` files as "stale" during sync
- Corrupting binary dependencies like `esbuild`, `vite`, `sharp`

### 2. **Retry logic for failed npm installs** ✅

The runner already has retry logic (preview-runner/index.js lines 372-418):

```javascript
let attempt = 0
const maxAttempts = 2
while (attempt < maxAttempts) {
  attempt++
  try {
    await new Promise((res, rej) => {
      installProc = spawn('npm', ['install', ...], { cwd })
      // ...
    })
    break
  } catch (err) {
    if (attempt < maxAttempts) {
      appendLog('runner', `[runner] npm install failed (attempt ${attempt}/${maxAttempts}): ${err.message}`)
      appendLog('runner', `[runner] deleting corrupted node_modules and retrying from scratch…`)
      await fs.rm(join(cwd, 'node_modules'), { recursive: true, force: true })
      await new Promise(r => setTimeout(r, 500))
    } else {
      throw err
    }
  }
}
```

When `npm install` exits with code 1:
1. Logs the failure clearly
2. Deletes the entire `node_modules/` directory
3. Retries the install once from scratch
4. If the retry fails, surfaces the error with the full npm log

### 3. **UI controls added** ✅

Added Stop/Restart/Hard Reset buttons to `ServerPreview.jsx`:

- **Refresh**: Reloads the iframe (soft refresh)
- **Hard Reset**: Destroys the Fly machine and starts fresh (fixes corrupted `node_modules`)
- **Stop**: Stops the preview machine
- **Cancel** (during startup): Cancels the boot process
- **Retry** (on error): Retries the start after a failure

### 4. **Database cleanup endpoint** ✅

The cleanup endpoint already exists at `/api/previews/:projectId/cleanup-node-modules`:

```javascript
// Deletes all rows where path contains node_modules
const { error } = await supabase
  .from('project_files')
  .delete()
  .eq('project_id', projectId)
  .or('path.like.%/node_modules/%,path.like.node_modules/%')
```

This removes corrupted `node_modules/` rows from the database without touching source files.

## How to Fix Mangia Mama

### Option 1: Use the cleanup script (recommended)

```bash
# Set your auth cookie
export COOKIE="your-session-cookie-here"

# Run the cleanup script
bash scripts/cleanup-mangia-mama.sh
```

### Option 2: Use the UI (easiest)

1. Open the Mangia Mama preview
2. Click **Hard Reset** button
3. Wait ~10 seconds for the machine to be destroyed
4. Click **Start Preview**
5. Wait 5-10 minutes for the fresh `npm install` to complete

### Option 3: Call the API directly

```bash
curl -X POST \
  "https://emanator.vercel.app/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/cleanup-node-modules" \
  -H "Cookie: your-session-cookie"
```

## Verification

After the fix, the runner logs should show:

```
[sync] Fetched 73 source files from Supabase
[sync] Filtered out 13552 node_modules files (keeping 73 source files)
[sync] wrote 73 changed, skipped 0 identical, removed 0 stale (0 binary, 0 storage, 0 failures) in 1234ms
[sync] node_modules excluded from sync (ephemeral build artifacts, not source files)
[runner] node_modules cache hit — skipping npm install
```

Key indicators:
- ✅ `node_modules` files are filtered out during sync
- ✅ 0 stale files removed (not deleting `node_modules/`)
- ✅ `npm install` completes successfully
- ✅ No "Cannot find module" errors

## Why This Happened

1. **Before the fix**: The sync process treated ALL files on disk as source files, including `node_modules/`
2. **First sync**: Wrote 13,552 `node_modules/` rows to the database
3. **Second sync**: Saw those rows as "stale" (not in the new file list) and deleted them from disk
4. **Result**: Corrupted binaries like `vite/dist/node/chunks/dep-D-7KCb9p.js` were deleted mid-install
5. **Subsequent `npm install`**: Tried to repair the corrupted tree instead of doing a clean install

## Prevention

The runner now:
- ✅ Excludes `node_modules/` from sync at ALL levels (root, frontend/, apps/web/, etc.)
- ✅ Never writes `node_modules/` files to the database
- ✅ Never removes `node_modules/` files as "stale"
- ✅ Retries failed `npm install` with a clean slate
- ✅ Logs clearly when `node_modules` is excluded

## Related Files

- `preview-runner/index.js` — Runner sync logic (lines 481-668)
- `app/api/previews/[projectId]/cleanup-node-modules/route.js` — Database cleanup endpoint
- `components/dashboard/tabs/ServerPreview.jsx` — UI controls
- `scripts/cleanup-mangia-mama.sh` — Emergency cleanup script

## Timeline

- **2026-05-28**: Runner sync rewritten to exclude `node_modules/` (commit 58a9bf2)
- **2026-06-03**: UI controls added (Stop/Restart/Hard Reset buttons)
- **2026-06-03**: This documentation written

## Status

✅ **FIXED** — The runner code is correct. Existing projects with corrupted databases need a one-time cleanup via the Hard Reset button or the cleanup endpoint.
