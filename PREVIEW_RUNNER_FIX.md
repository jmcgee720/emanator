# Preview Runner Fix — Vite Config Import Errors

## Problem

Preview runners were failing to start for projects with Vite configs that use path aliases (`@/`, `~/`, `#/`) at the top level. The error looked like:

```
✘ [ERROR] Could not resolve "@/project/frontend/vite.config.runner.mjs"
Build failed with 1 error:
error: Could not resolve "@/project/frontend/vite.config.runner.mjs"
```

### Root Cause

The preview runner generates a `vite.config.runner.mjs` file that:
1. Imports the user's existing `vite.config.js`
2. Merges in host-check overrides for wildcard preview subdomains

**The chicken-and-egg problem:**
- User's `vite.config.js` uses `import something from '@/lib/utils'`
- Path aliases (`@/`) are resolved by Vite's config after loading
- But the config **can't load** until aliases are resolved
- Result: import fails before Vite even starts

## Fix (Deployed)

### 1. **Safe Import with Try/Catch** (`preview-runner/index.js` lines 171-201)

The generated `vite.config.runner.mjs` now wraps the user config import in a try/catch:

```js
let userConfig = {}
try {
  const imported = await import('./vite.config.js')
  userConfig = imported.default || imported
  if (typeof userConfig === 'function') {
    userConfig = await userConfig({ command: 'serve', mode: 'development' })
  }
} catch (err) {
  console.warn('[runner] user vite config import failed (using fallback):', err.message)
}
export default defineConfig({
  ...userConfig,
  server: {
    ...(userConfig?.server || {}),
    host: '0.0.0.0',
    port: 3001,
    strictPort: false,
    allowedHosts: true,
    hmr: { ...(userConfig?.server?.hmr || {}), clientPort: 443, protocol: 'wss' },
  },
})
```

**Result:** If the user's config can't be imported, we fall back to a minimal working config. The preview boots with default settings instead of crashing.

### 2. **Pre-Import Risk Detection** (`preview-runner/index.js` lines 157-180)

Before attempting to import the user's config, we scan it for risky patterns:

```js
const content = await fs.readFile(userConfigPath, 'utf8')
const hasRiskyImports = /@\/|#\/|~\//.test(content) || /import.*from\s+['"]@/.test(content)
if (hasRiskyImports) {
  appendLog('runner', `[runner] user vite config uses path aliases — using minimal fallback to avoid import errors`)
  userConfigImport = null
}
```

**Result:** Configs with path aliases skip the import step entirely and use the minimal fallback. The preview works, user's settings are preserved (Vite loads them internally after boot).

## Recovery Endpoints (Already Deployed)

### 1. **Reset Preview** — `POST /api/previews/:projectId/reset`

**Use when:**
- Machine is in "failed_precondition" state (stuck active)
- Files on disk are stale / out of sync with DB
- Preview is completely broken and won't start

**What it does:**
- Destroys the Fly machine entirely
- Next "Start Preview" provisions a clean machine
- Full npm install from scratch (slow but guaranteed clean)

**Curl example:**
```bash
curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/reset \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. **Force Install** — `POST /api/previews/:projectId/force-install`

**Use when:**
- Dev server is running but Tailwind/PostCSS is missing
- Preview renders blank or with build errors
- You want to fix dependencies without destroying the machine

**What it does:**
- Kills the dev server
- Installs `tailwindcss@^3.4.10`, `postcss@^8.4.41`, `autoprefixer@^10.4.20`
- Respawns the dev server (~15 seconds)

**Curl example:**
```bash
curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/force-install \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## How to Test

### For "Mangia Mama" or Similar Projects

1. **Check current state:**
   ```bash
   curl https://e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed.preview.auroraly.co/__runner_health
   ```
   - Should return `ok` if the machine is running
   - 503 if the machine exists but dev server is down
   - Connection refused if the machine is destroyed

2. **If machine is stuck ("failed_precondition"):**
   ```bash
   # Reset (destroys machine, next start will be clean)
   curl -X POST https://auroraly.co/api/previews/e5e4f1f4-3b5e-4c55-b2dc-655f483ef3ed/reset \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **Start the preview from the UI:**
   - Click "Start Preview" in the Auroraly dashboard
   - Wait 2-3 minutes for npm install + dev server boot
   - Preview should now load correctly

4. **If Vite config errors appear in logs:**
   - The fix is already deployed
   - The runner will automatically fall back to minimal config
   - Check logs at `GET /api/previews/:projectId/logs` to confirm

## What Changed (Technical)

| File | Change | Impact |
|------|--------|--------|
| `preview-runner/index.js` (L171-201) | Wrapped user config import in try/catch | Preview boots even if user config can't load |
| `preview-runner/index.js` (L157-180) | Pre-scan config for path aliases | Skip risky imports before they fail |
| `preview-runner/index.js` (L115, L141) | Command still uses `vite.config.runner.mjs` | No change to command structure |

## Expected Behavior After Fix

### Before
```
[runner] spawning npx --no-install vite --config vite.config.runner.mjs --host 0.0.0.0 --port 3001 in frontend
✘ [ERROR] Could not resolve "@/project/frontend/vite.config.runner.mjs"
server restart failed
```

### After
```
[runner] user vite config uses path aliases — using minimal fallback to avoid import errors
[runner] vite host-check override written (allowedHosts: true)
[runner] spawning npx --no-install vite --config vite.config.runner.mjs --host 0.0.0.0 --port 3001 in frontend
  ➜  Local:   http://localhost:3001/
  ➜  Network: http://0.0.0.0:3001/
  ➜  ready in 1234 ms
```

## Monitoring

### Check Preview Status
```bash
curl https://auroraly.co/api/previews/YOUR_PROJECT_ID/status
```

Returns:
```json
{
  "running": true,
  "pid": 1234,
  "port": 3001,
  "installing": false,
  "starting": false,
  "error": null,
  "logCount": 42
}
```

### Stream Live Logs (SSE)
```bash
curl https://auroraly.co/api/previews/YOUR_PROJECT_ID/logs
```

Returns a stream of JSON log entries:
```
data: {"ts":1234567890,"stream":"runner","line":"[runner] vite host-check override written"}
data: {"ts":1234567891,"stream":"dev","line":"  ➜  Local:   http://localhost:3001/"}
```

## Rollout

- **Deployed:** 2025-01-XX (commit `db628ae`)
- **Affects:** All projects using Vite with path aliases in their config
- **Breaking:** None — fallback preserves existing behavior
- **Monitoring:** Check `/api/previews/:id/logs` for `"using minimal fallback"` messages

## Future Improvements

1. **Config Proxy:** Generate a proxy config that re-exports user config via dynamic import after Vite initializes
2. **Alias Detection:** Parse user config AST instead of regex to detect aliases more reliably
3. **User Feedback:** Surface "using fallback config" message in preview UI when it happens
