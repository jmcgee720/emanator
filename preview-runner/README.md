# Auroraly Preview Runner — Deploy Guide

This is the Fly.io-side service. The Auroraly app on Vercel boots one of these per active preview project, syncs the user's files in, and runs their dev server. The iframe in Auroraly loads `<projectId>.preview.auroraly.co`, which Fly's edge routes to the right machine.

---

## One-time setup (do this in order)

### 1. Install flyctl + log in
```bash
curl -L https://fly.io/install.sh | sh   # macOS / Linux
# Windows: iwr https://fly.io/install.ps1 -useb | iex
fly auth login
```

### 2. Create the Fly app
From this directory (`preview-runner/`):
```bash
fly apps create auroraly-preview-runner --org personal
```
*If you get "name taken", pick something else and update both `fly.toml` (`app = "..."`) and Vercel's `FLY_PREVIEW_APP_NAME` env var to match.*

### 3. Build & deploy the image
```bash
fly deploy --remote-only
```
First deploy takes ~3–5 min (Docker build). The app will exist with **0 machines** running — that's intentional. Machines are created on demand by the orchestrator.

### 4. Confirm the app is up
```bash
fly status -a auroraly-preview-runner
```
You should see the app listed, no machines yet.

### 5. Wildcard DNS (Porkbun)
1. Log in to Porkbun → DNS for `auroraly.co`.
2. Add a new record:
   ```
   Type:   ALIAS  (or CNAME — Porkbun supports both at apex-adjacent)
   Host:   *.preview
   Answer: auroraly-preview-runner.fly.dev
   TTL:    600
   ```
3. Save. Propagation is usually instant on Porkbun, occasionally 1–2 min.

### 6. Tell Fly about the wildcard hostname
```bash
fly certs create '*.preview.auroraly.co' -a auroraly-preview-runner
fly certs check '*.preview.auroraly.co' -a auroraly-preview-runner
```
Wait for status to show `Issued`. Fly auto-provisions per-subdomain Let's Encrypt certs the first time anyone visits `<projectId>.preview.auroraly.co`.

### 7. Vercel env vars (Auroraly side)
Add these to your Vercel project (Settings → Environment Variables, all environments):

| Key | Value |
|---|---|
| `FLY_API_TOKEN` | the token you gave me (already in `.env.local`) |
| `FLY_ORG_SLUG` | `personal` |
| `FLY_PREVIEW_APP_NAME` | `auroraly-preview-runner` |
| `FLY_REGION` | `iad` (or wherever you put it) |
| `PREVIEW_BASE_DOMAIN` | `preview.auroraly.co` |
| `RUNNER_SECRET_SEED` | any long random string — used to derive per-project runner secrets |

### 8. Redeploy Auroraly on Vercel
The new `/api/previews/*` routes only ship after the next Vercel build. Push any commit (or hit Redeploy in the dashboard).

---

## Verifying it works

1. Open `auroraly.co`, click into Mangia-Mama, go to the **Preview** tab.
2. The engine toggle should show three buttons: **Babel** / **Server** / **WC**.
3. **Server** is auto-selected for framework projects (CRA/Vite/Next).
4. Status bar should go: idle → "Starting…" → "Ready".
5. First boot takes 1–2 min (npm install). Subsequent boots are < 10s.
6. Iframe should load Mangia-Mama's actual app at `<projectId>.preview.auroraly.co`.
7. Terminal drawer at the bottom shows live npm + dev-server logs streaming via SSE.

---

## Cost expectations

Default `fly.toml` settings:
- **Machine size:** `shared-cpu-1x`, 1 GB RAM
- **Region:** `iad` (Ashburn — closest to Vercel's us-east-1)
- **Auto-stop:** enabled, stops idle machines after ~5 min of no traffic
- **Cold start:** ~1–3s to wake a stopped machine; ~30s for `npm install` if not cached
- **Cost while running:** ~$0.0000022/sec ≈ $0.008/hour ≈ $0.20/day (24/7)
- **Cost while stopped:** $0

Practical estimate for **10 active previews, 4 hr/day each**: ~$25–35/month.
For **50 active, 8 hr/day**: ~$200–300/month.

---

## Day-2 ops

**See running machines:**
```bash
fly machines list -a auroraly-preview-runner
```

**Tail logs from a specific machine:**
```bash
fly logs -a auroraly-preview-runner -i <machine-id>
```

**Force-stop a runaway machine:**
```bash
fly machines stop <machine-id> -a auroraly-preview-runner
```

**Force-destroy a machine (frees the project's machine slot):**
```bash
fly machines destroy <machine-id> --force -a auroraly-preview-runner
```

**Update the runner image after editing `index.js` or `Dockerfile`:**
```bash
cd preview-runner && fly deploy --remote-only
```
Existing machines keep running their old image until they restart. To force-update all running machines:
```bash
fly machines list -a auroraly-preview-runner -j | jq -r '.[].id' | xargs -I{} fly machines update {} --image registry.fly.io/auroraly-preview-runner:latest -a auroraly-preview-runner
```

---

## Troubleshooting

**"app not found" on deploy**
You hit this earlier. Make sure `fly apps create auroraly-preview-runner` succeeded BEFORE running `fly deploy`. The app must exist in your Fly account first.

**Machine starts but iframe shows 502**
- Check `fly certs check '*.preview.auroraly.co'` — cert may still be `Awaiting Configuration` if DNS isn't propagated.
- Or the user's dev server is still installing — check the terminal drawer in Auroraly's UI.

**"runner failed to become healthy within 30s"**
- The runner Express service crashed during boot. Check `fly logs -a auroraly-preview-runner -i <machine-id>` for the actual error.
- Most common cause: out of memory during npm install. Bump `[[vm]] memory = "2gb"` in `fly.toml` and redeploy.

**npm install hangs forever**
- Big monorepos exceed Fly's default machine image disk (~6 GB). Bump `[[vm]] disk = "20gb"` if needed (costs ~$3/month per 10GB extra).
