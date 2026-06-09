# Preview Engine Standardization (Feb 2026)

## TL;DR

Auroraly now uses **one** preview engine: Fly Machines (server-side
preview via `preview-runner`). The in-browser WebContainer engine and
its supporting code are removed. The in-browser Babel srcDoc compiler
is retained for one purpose only: the live-streaming preview during a
fresh AI build, before files are persisted to a project.

## Why we removed the engine choice

The dashboard previously had a 3-way engine switch:

| Engine | What it did | Cold-start cost | Reliability |
|---|---|---|---|
| Babel srcDoc | In-browser AST transform + iframe | None | Limited (no real Node, lots of stubs) |
| WebContainer | In-browser Node.js runtime | 30s–10 min per open | Architectural mismatch for CRA/Next |
| Server (Fly) | Real Linux container on Fly Machines | 5–10 min first boot, <10s subsequent | Real Node — anything that runs locally runs here |

Three engines meant three different "Starting your preview…" screens,
three different bug surface areas, and three different code paths for
every feature (CSS streaming, asset resolution, framework detection).
The user-facing symptom: the preview tab was the single most
frustrating part of Auroraly. Standardizing on the engine that actually
matches a real `npm run dev` is the long-term fix.

## Code that was deleted

```
components/dashboard/tabs/WebContainerPreview.jsx
lib/webcontainer/sandbox.js
lib/webcontainer/file-tree.js
lib/webcontainer/cra-to-vite.js
tests/test-cra-to-vite.test.mjs
tests/test-cra-to-vite-e2e.test.mjs
tests/test-webcontainer-scaffolding.test.mjs
```

## Code that was simplified

* `components/dashboard/tabs/PreviewTab.jsx`
  - Removed `previewEngineRaw` / `setPreviewEngine` state machine
  - Removed `detectedFramework` heuristic + auto-engine selection effect
  - Removed `<WebContainerPreview />` JSX branch
  - The render path is now: `project?.id` → `<ServerPreview />`,
    otherwise → the Babel srcDoc fallback (live-streaming only).
* `components/dashboard/tabs/ServerPreview.jsx`
  - The "Starting your preview…" loading screen now embeds the live
    install log tail (last 8 lines collapsed, expandable to last 300).
  - Adds a one-line "last activity" hint pulled from the npm install
    output so users can see specifics like "added react-router-dom
    14.2.0" instead of a static "1-2 / 5-10 min" message.

## Phase 3 — install-hash persistence (the real perf fix)

Fly's `auto_stop_machines = "stop"` keeps the machine rootfs intact
across stop/start cycles — including `node_modules`. But the runner's
`lastInstallHash` was an in-memory variable that reset to `null` on
every restart, which made the cache-miss branch in `runInstallIfNeeded()`
nuke `node_modules` even though nothing had actually changed.

The fix:

* `preview-runner/index.js#loadPersistedInstallHash()` — reads
  `/project/.auroraly-install-hash` on boot.
* `preview-runner/index.js#savePersistedInstallHash()` — writes the
  current hash after every successful `npm install`.
* The `/sync-from-supabase` cleanup preserves `.auroraly-install-hash`
  alongside `.npmrc` and `.next`.
* `/force-install` clears both the in-memory AND on-disk hash so the
  next `/start` sees a true cache miss.

User-facing result: a project's SECOND cold-boot drops from "5–10
minutes" (full reinstall) to "<10 seconds" (skip install, spawn dev
server only). Only an actual `package.json` / lockfile change triggers
a real reinstall.

## What's still on the to-do list

1. **Machine keep-warm for active projects.** Currently
   `min_machines_running = 0` in `fly.toml`, so any inactivity beyond
   ~10 min triggers a cold boot on next open. Recommended: per-user
   keepalive ping (every 5 min while the dashboard is open) hitting
   the machine's `/health` endpoint to keep it `started`. A heavier
   alternative is `min_machines_running = 1` for projects opened in
   the last 24h.
2. **Surface install progress percentage**, not just the last log line.
   npm 10 emits structured progress to stderr; parsing `[N/M]` markers
   would let us render a real progress bar.
3. **Multi-region Fly app** so EU/AP users get a nearby machine. Today
   the app is `primary_region = "iad"` only.

## How to test

```bash
# Preview the standardization contract is locked in:
node --test tests/test-preview-engine-standardization.test.mjs
node --test tests/test-preview-runner-install-hash-persistence.test.mjs
```

Both files have explicit assertions for the dead code that must not
return and the persistence path that must stay wired.
