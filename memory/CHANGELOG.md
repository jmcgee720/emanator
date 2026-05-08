# Changelog


## 2026-02 — Mangia-Mama `react-scripts start` ajv crash fixed (E2E VERIFIED)

**Issue:** After successful `npm install`, CRA fallback spawn of
`react-scripts start` crashed immediately with
`Cannot find module 'ajv/dist/compile/codegen'`. Initial fix attempt
(post-install ajv@8 sidecar with `existsSync` gate) silently never
fired because the gate was checking for a file `codegen.js` when in
ajv@8 it's a directory `codegen/index.js` — bug in detection logic.

**Final fix (E2E VERIFIED against real react-scripts@5.0.1):**
`preview-runner/index.js` now mutates `package.json` BEFORE `npm install`
to inject:

```json
"overrides": {
  "ajv": "^8",
  "ajv-keywords": "^5",
  "schema-utils": "^4"
}
```

This is the canonical npm fix every CRA dev uses. Three deps, not one,
because nested issues cascade:
1. `ajv@^8` fixes `Cannot find module 'ajv/dist/compile/codegen'`
2. `ajv-keywords@^5` fixes `TypeError: Cannot read properties of undefined (reading 'date')`
   from `fork-ts-checker-webpack-plugin/node_modules/ajv-keywords@3`
3. `schema-utils@^4` fixes `Error: Unknown keyword formatMinimum`
   from old schema-utils@2 trying to use deprecated keywords

**Verified:** Locally booted `react-scripts start` against a real
CRA fixture — `compiled successfully: true`, no ajv-related crashes.
Lockfile is invalidated so the next install picks up overrides cleanly.

**Tests:**
- `/app/tests/test-runner-ajv-overrides.test.mjs` — 6 unit tests for patch logic
- `/app/tests/test-runner-ajv-sidecar.test.mjs` — 7 unit tests for fallback
- `/tmp/cra-fixture/run-e2e.mjs` + `test-boot.mjs` — full E2E with real npm install

**Commit:** `62e2af5` on `main`. Requires user to deploy via
`cd ~/emanator && git pull && cd preview-runner && flyctl deploy --remote-only`.



## 2026-05-08 — Mangia-Mama Imports Render + Real-LLM Verified Nexsara

After the user reported a fresh Nexsara still generated images and Mangia-Mama
showed no progress, did a full code-level audit of both flows and found
multiple unshipped failures.

**Mangia-Mama (3 issues, 3 fixed):**
1. `frontend/package.json` ships `scripts.start = "craco start"` but never
   declares `@craco/craco` as a dependency. Runner had a fallback to spawn
   `react-scripts start` directly, but vanilla react-scripts ignores the
   `craco.config.js` webpack alias config — every `import "@/components/..."`
   would fail with "Module not found". **Fixed** in `preview-runner/index.js`:
   detects (craco.config.js + craco scripted + craco binary missing) AND
   installs `@craco/craco --no-save` as a sidecar after main npm install.
2. **Auroraly stores binary assets as `data:image/png;base64,...` strings.**
   Runner's /sync handler used to write the literal data-URI TEXT to disk
   for /assets/sprites/foo.png — Phaser then tried to load text and failed
   to parse as image → every sprite broken. **Fixed**: runner detects the
   data: prefix and decodes back to Buffer bytes before writing. Mangia-Mama
   has 31 image + 1 binary rows that needed this.
3. Preview boot timeout 8min → 15min for big CRA installs (already in prior
   commit). Drawer auto-opens during install with pulse indicator + last
   activity hint.

**Nexsara — verified end-to-end with REAL LLM call:**
- Brief mentioning users/save/login/dashboard → archetype: `fullstack_app`,
  17 files including `app/api/campaigns/route.js`, `app/api/analytics/route.js`,
  `lib/db.js`, `lib/auth.js`, `app/dashboard/page.jsx`. dataModel: Campaign +
  Analytics entities, auth=supabase, storage=supabase.
- Coffee-shop brief (no fullstack signals) → archetype: `hospitality`,
  0 API routes, no dataModel.
- Token budget bumped 3000 → 8000. New tolerant JSON parser
  (lib/ai/safe-json.js) handles 5+ failure modes via 5-pass repair pipeline:
  strict → fenced → cleaned → trailing-commas → auto-close → salvage prefix.
- Phase 1 has a fixer-retry as last-ditch insurance; Phases 2 + 3 use the
  same parser.

**BuildWizard skip-imagery (the actual user-facing Lever 2 bug):**
- /api/build/images accepts { skipImagery: true } and returns deferred sentinel.
- "Skip imagery for now →" secondary button on design_tokens "ready" state.
- Skips Phase 4 + auto-runs compose + lands user on preview with banner CTA.

**fullstack_app archetype:**
- Phase 1 plan prompt detects fullstack signals; output includes `dataModel`
  with entities/endpoints/auth/storage.
- Phase 5 compose has fullstack-aware file-type hints (API routes use
  NextResponse.json shape, lib files have defensive env handling).
- Orchestrator stamps preview_engine_hint='server' so PreviewTab auto-selects
  the Server engine (Babel mode would 404 on /api/*).

**Pre-existing bug fixed during audit:**
- lib/e2b/memory-service.js was importing `db` as default but db.js only
  has named export. Was producing 4× compile warnings on every reload.
- Phase 5 now emits per-file `file_saved` / `file_failed` events for
  real-time progress UI (test-phased-pipeline stub updated).

**Tests**: 114 passing across 24 suites. New: test-safe-json (16),
test-runner-binary-sync (9), test-e2e-user-flows (18), test-fullstack-archetype
(5), test-wizard-skip-imagery (3), test-deferred-imagery (4).

**Commits**: `7c5c6f9` → `bb687bd` → `0b093a4` on `jmcgee720/emanator:main`


## 2026-05-08 — Image-Extraction Pipeline + Deferred Imagery (Levers 1-4)
### Stopped the AI from poisoning projects with 240MB of inline base64 PNGs

**Root cause discovered during a Nexsara repro**: Phase 5 compose was inlining
generated images as `data:image/png;base64,…` URIs directly into JSX source.
A single `app/page.jsx` file ballooned to 24 MB; whole project hit 240 MB.
The `/files` API response then hit Vercel's 4.5 MB body limit and previews
went blank with no error.

**Lever 1 — auto-extract base64 at write time** (`lib/supabase/image-extractor.js`)
- New `extractInlineImages()` runs inside `persistContent()` before any size
  accounting. Catches `data:image/(png|jpe?g|webp|gif|svg+xml);base64,…`
  payloads >1 KB, hashes them with sha1, deduplicates across calls, saves
  one row per unique image at `_assets/__gen_img_<hash>.<ext>`, and rewrites
  the source to the placeholder URL `https://emanator-generated.img/<filename>`
  the existing PreviewTab substitution layer already handles. Zero PreviewTab
  changes needed.
- Skip list: `_assets/`, `_generated/`, `_uploads/` prefixes, `*.png/jpg/svg/...`
  paths, and `components/assets.js` brand-VFS module — extracting from those
  would destroy legitimate binary files.

**Lever 2 — defer Phase 4 on the first build** (`lib/ai/phased-pipeline/`)
- New `imageMode: 'defer'` ctx parameter. The chat-stream first-build path
  (`message-stream.js`) passes `'defer'` so Phase 4 short-circuits to
  `{ images: [], deferred: true }`. Phase 5 already falls back to gradient/SVG
  placeholders when there are no image dataUrls — no compose change needed.
- Orchestrator stamps `project.settings.imagery_status = 'deferred' | 'generated'`.
- Dashboard's BuildWizard handoff message branches on the flag with copy that
  coaches the user toward the explicit "Generate brand imagery" CTA.
- New `<ImageryDeferredBanner>` component shows above the preview iframe with
  a `Generate brand imagery` button when `imagery_status === 'deferred'`.
  `<ImageryGeneratedPill>` in the toolbar shows status afterward.

**Lever 3 — hard size cap safety net** (`lib/supabase/file-storage.js`)
- `MAX_FILE_BYTES = 500 KB` for source files, `MAX_ASSET_BYTES = 8 MB` for
  `_assets/` rows. `persistContent()` throws `FILE_TOO_LARGE` on violation
  so the failure is visible in change-event logs / chat instead of silently
  poisoning a project.
- `bulkInsert()` is now per-row tolerant via `Promise.allSettled` — a
  single malformed file no longer aborts the whole batch.

**Lever 4 — explicit imagery refresh endpoint** (`lib/api/routes/build-steps.js`)
- New `POST /api/build/imagery/generate { projectId, roleFilter? }` loads
  the latest `phase_states` doc, runs Phase 4 in full mode, recomposes
  Phase 5 so the JSX picks up the new image refs, flips
  `imagery_status='generated'`. `roleFilter` narrows to specific image
  roles (e.g. `['hero']`) for per-image regenerate without redoing the
  whole imagery batch.

**One-shot rescue script** (`scripts/rescue-bloated-projects.mjs`)
- Walks every project_files row whose resolved content has inline base64
  data URIs over 200 KB and runs them through the extractor in place.
  Idempotent, dry-run by default, scoped via `--project=<uuid>`.
- First production run on Nexsara `823bd1cf...`: **243 MB → 520 KB
  (99.8% reduction across 22 files)**. Project now previews instantly.
- Hardened skip rules ensure binary asset files (`assets/logo.png`),
  brand VFS modules (`components/assets.js`), and `_generated/`/`_uploads/`
  prefixes are never targeted.

**Tests added (11 + 8 + 4 = 23):**
- `tests/test-image-extractor.test.mjs` — regex coverage, dedup, placeholder
  shape match with PreviewTab, post-extraction size, skip rules
- `tests/test-file-size-cap.test.mjs` — source vs asset cap boundaries
- `tests/test-deferred-imagery.test.mjs` — imageMode short-circuit,
  fallthrough for full mode, backward-compat for legacy callers

**Commits pushed to `main`:**
- `a36d764` — files: auto-extract inline base64 + size cap (Lever 1+3)
- `a823e12` — imagery: defer Phase 4 on first build + Generate Imagery CTA
- `1dc637f` — extractor: harden skip rules (binary + brand VFS)


## 2026-05-08 — Storage Migration Complete + Fly OOM Fix Shipped
### Closed out the Supabase Disk IO budget burn and the Mangia-Mama OOM kill in one push.

**P0 — All 3 items shipped:**
1. **Fly machine RAM bump 1024MB → 2048MB (2 vCPU)** (`lib/fly/machines.js`). The 1GB shared-cpu-1x guest was getting SIGKILL'd (Exit 137) mid-`npm install` for large CRA imports like Mangia-Mama. Now `shared-cpu-2x:2048MB` with 2 vCPUs gives `npm install` enough headroom.
2. **`project_files.content` backfill complete.** Ran `node scripts/migrate-files-to-storage.mjs --apply`. Two-pass execution:
   - Pass 1: 942 rows scanned, ~825 migrated, 118 failed with Supabase Storage `Invalid key` (file paths with spaces / colons / unicode).
   - Pass 2 (after sanitization fix): all 118 remaining files migrated, 0 failures.
   - Final dry-run confirms 0 inline files >8 KB remain. Should kill the Disk IO budget burn that was timing out Nexsara chat at 60s and 522'ing previews.
3. **Storage key sanitization centralized + hardened** (`lib/supabase/file-storage.js`). New `storageKey()` exports a per-segment sanitizer (`[^a-zA-Z0-9._\-]` → `_`). Migration script now imports this same helper so backfill keys exactly match what live writes will produce — no key drift.

**Tests:**
- `tests/test-file-storage.test.mjs`: updated to mirror new logic, added cases for real-world failures ("Screenshot 2026-04-12 at 4.23.22 PM.png", `a:b/c?d.png`). 15 passing, 0 failing.
- `tests/test-fly-machines.test.mjs`: 9 passing (no regressions from RAM bump).

**Commits pushed to `main`:**
- `8fa16b4` — fly: bump preview machines to 2GB/2vCPU
- `2fcd75f` — storage: sanitize keys (Invalid key fix)
- `3f6b50c` — test: align storageKey test + add space/special-char cases

## 2026-05-07 — Fly.io Server-Side Preview Phase 1 LIVE + Spyrals 520 fix
### Auroraly preview infrastructure pivoted from WebContainers → Fly Machines for imported projects

**Phase 1 deployment complete:**
- `auroraly-preview-runner` Fly app deployed (image `deployment-01KR1CDK6H44QF18GX981TTX43`, 179MB)
- Public IPs allocated: v4 `66.241.125.106` (shared) + v6 `2a09:8280:1::112:5818:0` (dedicated)
- Wildcard cert `*.preview.auroraly.co` issued by Let's Encrypt (verified + active)
- Porkbun DNS wired: `*.preview` A/AAAA → Fly IPs, `_acme-challenge.preview` CNAME → flydns
- Vercel env vars set (production + preview + development): `FLY_API_TOKEN`, `FLY_PREVIEW_APP_NAME`, `FLY_ORG_SLUG`, `FLY_REGION`, `PREVIEW_BASE_DOMAIN`, `RUNNER_SECRET_SEED`
- Vercel auto-deployed commit 871f90c → state=READY, production endpoint verified

**Two real Fly client bugs fixed during smoke testing:**
1. **`registry.fly.io/<app>:latest` doesn't exist after `fly deploy`** — Fly tags every release as `deployment-<ULID>`. The orchestrator `createMachineForProject()` was hardcoding `:latest` and getting `manifest unknown` 404. Fix: new `resolveDeployedImage()` reads the live image tag from any existing machine (template machine left over from `fly deploy`), with releases-API fallback.
2. **`/wait?timeout=X` rejects X > 60** with `value must be inside range [1s, 1m0s]`. Fix: `waitForMachineState()` now clamps per-call timeout to ≤60s and loops until total budget consumed.

**Plus minor polish:**
- `fly.toml`: removed the tcp_check on internal_port 3000 (only binds when a project starts; baseline machine was always "unhealthy")
- Verified the `Fly-Force-Instance-Id` header routing works: orchestrator can hit `/health`, `/sync`, `/start`, `/stop`, `/logs` on any per-project machine over `https://auroraly-preview-runner.fly.dev:8443`

**Spyrals 520 import bug fixed (P1):**
The "Spyrals" import was dumping raw Cloudflare 520 HTML into the import UI. Root cause: Supabase-js error messages can contain raw HTML when PostgREST is fronted by Cloudflare and Cloudflare returns a 5xx; `imports.js` was inlining `err.message` directly into JSON error responses.
- New `/app/lib/supabase/error-utils.js`:
  - `cleanSupabaseError(err)` → friendly message + `{transient, retryable, status}` flags. Detects Cloudflare 5xx HTML (520/521/522/523/524 + 504), strips HTML signatures, classifies network errors (ECONNRESET, fetch failed), caps long messages at 500 chars.
  - `withRetry(fn, opts)` → exponential backoff (400/800/1600ms) for transient errors only; throws clean `Error` after exhausting retries.
- `imports.js` (3 entry points): GitHub-import bulkInsert, GitHub-sync upsert, zip-upload bulkInsert all wrapped in `withRetry(...)`. Every catch-block error response now goes through `cleanSupabaseError()`. Transient errors return `503` + `{transient: true}` instead of `500` with raw HTML.

**Tests added:**
- `/app/tests/test-fly-machines.test.mjs` — 8 tests for the Fly client (resolveDeployedImage fallback chain, waitForMachineState clamp+loop, createMachineForProject image regression, publicDevUrl assembly, machineControlUrl Force-Instance-Id header)
- `/app/tests/test-supabase-error-utils.test.mjs` — 13 tests for HTML stripping, status detection (520/521/522/504), retry semantics, message capping, null safety

**Architecture decision recorded:**
WebContainers are now strictly the fast-path for Auroraly-native (greenfield) projects. Imported legacy apps (CRA + Phaser like Mangia-Mama, Next.js exports like Spyrals/Dopples) route through Fly Machines via `ServerPreview.jsx`. The `cra-to-vite.js` translation shim is kept for native projects only and slated for removal in Phase 3.

**Known follow-ups (Phase 2):**
- Idle auto-shutdown after 15m via heartbeat ping from iframe
- Live terminal log streaming wired into `ServerPreview.jsx` (`/logs` SSE endpoint already exists)
- Per-user budget cap (max N concurrent machines + monthly $ ceiling)


## 2026-02-XX — WebContainer reliability (blank-iframe fix)
### Imported projects (Mangia Mama, Spyrals, etc.) now boot inside WebContainers
- **Smart conditional scaffolding** (`lib/webcontainer/file-tree.js`):
  Imported projects with their own `package.json` + (`pages/` or `app/layout.*` or `vite.config.*` or `index.html`) are now treated as self-contained. We no longer overwrite or pollute them with Auroraly's Next.js 14 shell, which was breaking Pages-router and Vite imports.
- **`detectDevCommand` helper**: respects the imported `package.json`'s `dev` (or fallback `start`) script. Auroraly's hardcoded `npm run dev -p 3000` no longer clobbers Vite/Phaser/custom toolchains.
- **Dev-exit error surfacing** (`lib/webcontainer/sandbox.js`): when `npm run dev` exits before any port binds, the UI now shows a clear error instead of a silent blank iframe.
- **ANSI escape stripping**: install/dev logs no longer leak `\x1b[1G\x1b[0K` cursor noise — clean readable output.
- **Iframe auto-reload after first ready** (`WebContainerPreview.jsx`): Next.js dev binds the port before the first compile finishes; the iframe used to load empty. We now soft-reload the iframe ~4.5s after `server-ready` so the first render always paints.
- **Persistent terminal log drawer**: click the Terminal icon in the WebContainer header to see live install/dev output (stripped of ANSI codes, auto-scrolling, with a Clear button).
- **"Open in new tab" link** + manual reload button on the WC URL — lets users debug the dev server independently of the embedded iframe.
- **5 new scaffolding unit tests** at `tests/test-webcontainer-scaffolding.test.mjs` (covers Auroraly default, Pages-router, App-router, Vite, and `detectDevCommand` matrix).



## 2026-02-XX - Phase 4 Image Fallback Chain (Current Fork)
### Image generation no longer depends on Gemini billing tier
- **Phase 4 fallback chain**: Gemini Nano Banana → OpenAI gpt-image-1 → dall-e-3 → subject-aware stock
- When Gemini fails (Free tier, quota, outage), OpenAI takes over using existing OPENAI_API_KEY
- gpt-image-1 → dall-e-3 retry handles unverified OpenAI organizations transparently
- Subject-aware stock picker: coffee-shop briefs no longer return pizza/salad photos
- Expanded food stock library with 8 coffee/cafe/bar/bistro photos
- /api/build/ping-nano-banana probes both providers, returns unified status

### Phase-state storage refactor
- Image dataUrls now stored in dedicated `phase_images` collection (one doc per image)
- Fixes "offset out of range, must be <= 17825792" Mongo BSON 16 MB doc cap error
- `phaseStates.hydrateImages(state, runId)` rehydrates dataUrls before compose

### BuildWizard chat-inline redesign
- Wizard moved from fullscreen modal overlay → rendered inline in chat thread (LeftPanel)
- Each completed phase shown as a chat-bubble-styled card with rich human-friendly output
- No JSON visible to users — all fields shown in plain English (Brand name, Tagline, Vibe, etc)
- **Inline pencil edits per phase**:
  - Plan: brand name, tagline, mood, audience
  - Copy: every headline/subhead/CTA across every section, organized in collapsible per-section panels
  - Tokens: HTML5 color picker swatches for the palette, dropdown font pickers (heading + body), imagery treatment dropdown
  - Images: thumbnail grid with role labels on hover
- New backend endpoint `POST /api/build/edit` shallow-merges user edits into phase state before Proceed
- Auto-starts Phase 1 on mount (no more "Start building" button — it just starts)

### Tests
- tests/test-phase4-fallback.test.mjs (4/4 passing)
- Production Next.js build succeeds clean


## 2026-02 (Previous Sessions)
- Dashboard UI anomalies fixed, service.js Phase 2 refactoring
- Site Monitor, Deploy Tab, Share Preview, Project Templates, OOM fix
- Testing: iterations 57-60, all passed

## 2026-02 - Feature Batch 1 (Previous Fork)
- Template Marketplace, Share Link Expiry, Deployment Status Polling, Cron-based Auto-Crawl
- Testing: iteration 61, 8/8 passed

## 2026-02 - Feature Batch 2 (Current)
### 25 Project Templates
- Replaced 5 basic templates with 25 production-ready templates with real React code
- Categories: Marketing (5), Business (5), Personal (5), Content (5), Commerce (5)
- Each template renders a complete, interactive page (not placeholder)
- Fixed critical template literal `${}` escaping bug (caught by testing agent)

### Template Category Filter
- NewProjectModal now has category filter buttons (all/Marketing/Business/Personal/Content/Commerce)
- Grid layout updated to 4 columns with scrollable area for 25+ templates

### Template Flow Fix
- Fixed bug where `createProject` called `setFiles([])` after template creation
- Now fetches populated files from backend via API after template project is created

### Marketplace Ratings & Reviews
- POST /api/marketplace/:id/reviews - Add star rating (1-5) + text comment
- GET /api/marketplace/:id/reviews - Get all reviews for a template
- Reviews stored in snapshot metadata with avg_rating and review_count
- Users can only submit one review per template (edit replaces existing)
- Star ratings displayed on marketplace template cards

### Testing: iteration 62 - 13/13 backend tests passed (100%)


## 2026-04-11 - Core System Self-Improvement Phase 1
### Self-Edit Targets Expansion
- Added 3 new self-edit targets to `SELF_EDIT_TARGETS` in `constants.js`:
  - Prompt Builder (`lib/ai/prompt-builder.js`) - Design recipes & code patterns
  - Design System (`lib/ai/design-system.js`) - Color tokens, layout rules
  - Image Generator (`lib/ai/image-prefetch.js`) - Art direction & vibe lexicon
- All 3 targets verified in Core System dropdown UI
- Backend `message-stream.js` path-scoped validation confirmed working
- **Bug fix**: Self-edit requests were rejected by task mode enforcement ("I couldn't complete that request"). Fixed by skipping `validateTaskMode` for self-edit chats in `message-stream.js` (line 1015-1016) and always sending `selfEditTarget` from `Dashboard.jsx` even when "All Core System" is selected.
- **Context grounding**: Added self-edit file injection in `message-stream.js` — reads the target file from disk and injects full content + strict rules into the AI system message. The AI now correctly targets the existing file instead of creating disconnected standalone files.

## 2026-02-03 — GitHub Sync Unblocked + Auroraly Rebrand Pushed
- Emergent's "Save to Github" button was failing silently for ~16 commits.
- Used a temporary GitHub PAT to set `origin` and rebase 21 local commits onto `origin/main` (which had legacy folder deletions + `.vercelignore` from GitHub Web Editor edits).
- Conflict resolution: preferred local changes for the 5 shared files (README.md, app/api/[[...path]]/route.js, app/api/debug/mongo/route.js, lib/ai/message-stream.js, lib/api/routes/live-promote.js) — the remote edits were trivial author-bypass commits.
- Pushed `6294e3e..befc1a7` to `main`. Token revoked, remote URL sanitized.
- All Auroraly rebrand artifacts now live on GitHub: SVG/PNG logo, login UI tightening, Aurora MongoDB persistence, locked default Aurora layout, Aetherly Studio footer.

## 2026-05-03 — auroraly.co LIVE + AI Builder Quality Fixes (9 commits)
Domain: **auroraly.co is live on Vercel Pro.** DNS + Supabase Site URL + env vars all swapped.

### Commit train pushed today
- `b5f6d9a` — raise `maxDuration` 60→300s (Vercel Pro unlocks it)
- `d369c6a` — `imageAttachments is not defined` planner crash fix + guard non-image providers
- `6ffe650` — scaffold `max_tokens` 8192→16384 + better wave-failure diagnostics
- `b5fddd0` — OpenAI reasoning models (gpt-5.x, o-series) use `max_completion_tokens`, no `temperature`
- `8ed5064` — fresh-project routing to new pipeline + brief-driven design + tool-call retry + real error messages
- `8210acc` — default new projects to Claude Sonnet 4.5 (best tool-caller available)
- `fc2f8b2` — TDZ fix: removed `effectiveScope` reference before declaration (was breaking every build)
- `e710453` — regression test guarding against TDZ bugs in message-stream.js
- `9e6da7f` — derive brandName + projectDesc from short chat messages (no more "My App" defaults)
- `b8170eb` — stronger visual-excellence prompts (mandatory hero imagery, 2-font pairing, concrete subject imagery, 300-line floor)

### Upgrades / config
- Vercel plan: **Hobby → Pro** ($20/mo). Lifts function timeout, enables collaborator commits.
- Supabase Site URL swapped: `emanatorapp.com` → `www.auroraly.co`
- Creative Brief pipeline confirmed working end-to-end: "Cozy Coffee" produced real coffee copy (8 routes, 16 files, 293s run).

### Known outstanding
- **Chat-only short prompts** ("landing page for coffee shop" typed directly in chat) need commit `9e6da7f` verified after user retests. Fix derives brand from "for a ___" clause.
- **Visual quality** still to be validated post `b8170eb` — next user test will tell us if the stronger prompt produces designer-quality output.
- Old zombie projects ("Nexsara", "Koffee Krazy", etc.) still hold stale error messages — expected, they were built under bugged code.

