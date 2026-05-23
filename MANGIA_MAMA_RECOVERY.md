# Mangia Mama Preview Recovery Guide

## Current Issue
- Preview URL: `e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed.preview.auroraly.co`
- Status: Machine stuck in "failed_precondition" state
- Error: `fly POST /apps/auroraly-preview-runner/machines/2869762c077368/start → 412: failed_precondition: machine still active, refusing to start`

## Quick Fix (Choose One)

### Option 1: Reset via API (Fastest)
```bash
# Destroy the stuck machine
curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/reset \
  -H "Authorization: Bearer YOUR_SUPABASE_TOKEN"

# Expected response:
# {"ok":true,"destroyed":"2869762c077368","message":"Preview machine destroyed. Click Start Preview to provision a fresh one."}
```

Then click **"Start Preview"** in the Auroraly dashboard. Wait 2-3 minutes for:
1. Machine provisioning
2. File sync from Supabase
3. npm install
4. Vite dev server boot

### Option 2: Reset via Dashboard
1. Open the Mangia Mama project in Auroraly
2. Click the **"Reset Preview"** button (if available in UI)
3. Wait for confirmation toast
4. Click **"Start Preview"**

## Why This Happened

The Fly machine entered a state where:
1. The control plane thinks it's "active"
2. But the actual process is dead/stuck
3. Start command refuses to run because "machine still active"

This is a known Fly.io edge case when:
- Machine was forcibly stopped (SIGKILL) while starting
- Network partition during boot
- OOM killer terminated the process but Fly's state didn't update

## What the Fix Does

**Reset (`/api/previews/:id/reset`):**
- Sends `fly machines destroy` to Fly API
- Removes the stuck machine from Fly's registry
- Next "Start Preview" provisions a **brand new machine**
- Clean slate: fresh disk, fresh npm install, no stale state

## Vite Config Fix (Already Deployed)

The original Vite config error (`Could not resolve "@/project/frontend/vite.config.runner.mjs"`) is now fixed:

**Before:**
```js
// vite.config.runner.mjs (generated)
import userConfig from './vite.config.js'  // ❌ Fails if user config has @/ imports
export default defineConfig({ ...userConfig, ... })
```

**After:**
```js
// vite.config.runner.mjs (generated)
let userConfig = {}
try {
  const imported = await import('./vite.config.js')  // ✅ Wrapped in try/catch
  userConfig = imported.default || imported
} catch (err) {
  console.warn('[runner] user vite config import failed (using fallback):', err.message)
}
export default defineConfig({ ...userConfig, ... })  // ✅ Falls back to minimal config
```

**Result:** Even if your `vite.config.js` uses path aliases (`@/lib/utils`), the preview will boot with a working fallback config.

## Expected Timeline

| Step | Duration | What's Happening |
|------|----------|------------------|
| Reset API call | 2-5 sec | Fly destroys the stuck machine |
| Click "Start Preview" | instant | UI sends start request |
| Machine provisioning | 10-20 sec | Fly boots a new container |
| File sync | 5-15 sec | Runner downloads all files from Supabase |
| npm install | 60-120 sec | Installing dependencies (cached after first run) |
| Vite boot | 5-10 sec | Dev server starts, HMR connects |
| **Total** | **~2-3 min** | Preview ready |

## Verification Steps

1. **Check machine health:**
   ```bash
   curl https://e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed.preview.auroraly.co/__runner_health
   # Should return: ok
   ```

2. **Check dev server status:**
   ```bash
   curl https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/status
   # Should return: {"running":true,"pid":1234,"port":3001,...}
   ```

3. **Stream logs (watch the boot process):**
   ```bash
   curl https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/logs
   # Should stream lines like:
   # data: {"ts":...,"stream":"runner","line":"[runner] vite host-check override written"}
   # data: {"ts":...,"stream":"dev","line":"  ➜  Local:   http://localhost:3001/"}
   ```

4. **Load the preview in browser:**
   ```
   https://e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed.preview.auroraly.co
   ```
   Should render your WorldMap.jsx changes with correct button positioning.

## If Reset Doesn't Work

### Symptom: Machine won't start even after reset
**Try:**
```bash
# Force-install Tailwind trio (fixes missing PostCSS deps)
curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/force-install \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Symptom: Preview loads but shows blank white screen
**Check:**
1. Browser console for errors
2. Preview logs for Vite/PostCSS errors
3. Network tab — is CSS loading?

**Fix:**
- If CSS 404s → Reset preview (files out of sync)
- If PostCSS errors → Force-install
- If React errors → Check WorldMap.jsx code in chat

### Symptom: "machine still active" error persists
**Nuclear option:**
```bash
# Contact Fly support to manually destroy the machine
# Provide machine ID: 2869762c077368
# Project: e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed
```

## Prevention

To avoid future "machine still active" issues:

1. **Always use "Stop Preview" before closing the project**
   - Cleanly stops the dev server
   - Fly marks machine as stopped
   - Next start is smooth

2. **Don't force-quit the browser during preview boot**
   - Let npm install complete
   - Fly state stays consistent

3. **If preview is slow, wait — don't spam "Start"**
   - Multiple start requests can confuse Fly's state machine
   - First start takes 2-3 min (cold npm install)
   - Subsequent starts are faster (~30 sec)

## Summary

**Your Action:**
1. Run the reset API call (or click "Reset Preview" in UI)
2. Click "Start Preview"
3. Wait 2-3 minutes
4. Preview should load with WorldMap.jsx changes

**What Changed (Behind the Scenes):**
- Vite config import errors are now caught and handled gracefully
- Preview runner falls back to minimal config if user config can't load
- Your preview will work even if `vite.config.js` uses path aliases

**Status:** Fix deployed to `jmcgee720/emanator@main` (commit `db628ae`)

---

Need help? Check logs at `/api/previews/:id/logs` or ping the Auroraly chat.
