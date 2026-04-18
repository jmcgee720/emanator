# Emanator — Agent Platform PRD

## Original Problem Statement
Transition Emanator into a full Agent Platform that behaves exactly like the AI Engineer (E1). Emanator must autonomously build beautiful, highly polished, fully functional applications from a Creative Brief — including flows the user didn't explicitly ask for (Sign Up, Onboarding, Settings, etc.).

## Product Requirements
- Creative brief pipeline reliably generates 9/10 UI designs (glassmorphism, asymmetric layouts, brand-correct colors).
- Uses Art Direction (logos, style references) via GPT-4o Vision.
- Does NOT produce generic outputs, does NOT hit context/stream timeouts.
- **NEW**: Emanator must generate fully functioning, multi-page applications with real UX flows (auth, onboarding, dashboards) out of the box.

## User Personas
- SaaS founder — needs prototype-to-demo in under 60 seconds
- Designer — wants high-polish output they can hand to a dev team
- PM — wants to validate a concept with a working clickable prototype

## Architecture (current state)
- Next.js 14 + FastAPI + MongoDB + Supabase (projects/files)
- `/app/lib/ai/message-stream.js` — Creative Brief fast-path
- `/app/components/dashboard/tabs/PreviewTab.jsx` — Babel AST-based multi-file preview runtime (SUPPORTS multi-file today — verified)
- `/app/components/dashboard/useDashboardStream.js` — SSE client + auto-recovery polling
- GPT-4o via Emergent LLM key (Vision enabled)

## Architecture Upgrade (in progress — see /app/docs/ARCHITECTURE_UPGRADE.md)

### Three unlocks
1. **Archetype inference** — classifier + manifest of 17 app types with required routes/flows (SHIPPED Session 1)
2. **Multi-file output** — use existing AST transform; emit one file per page/component
3. **Plan-then-build chunked** — architect call → waves → self-review/auto-repair

### Rollout
Behind `EMANATOR_NEW_PIPELINE` env flag. Current fast-path runs unchanged until flag flips.

## Implemented (this session — 2026-02)

### Session 1 (COMPLETE, 2026-02-18)
- `/app/lib/ai/archetypes.js` — 17 archetypes (SaaS, AI app, marketplace, social, content, portfolio, e-commerce, dashboard, chat, utility, CRM, LMS, booking, community, media, productivity, landing-only), regex-first classifier + LLM fallback, mergeArchetypeWithBrief guaranteeing required routes, canonical ROUTE_FILE_MAP, normalizeRouteName alias resolver
- `/app/lib/ai/brief-planner.js` — generatePlan() + validatePlan() + planWaves(). Routes list is deterministic (never dropped by LLM). Wave ordering: scaffold → public → auth → app. Empty waves filtered.
- `/app/lib/ai/recipes.js` — 12 production-ready recipes: auth_context, mock_api, app_router, navbar_glass, footer_4col, signup_form, login_form, forgot_password_form, onboarding_wizard, pricing_3tier, dashboard_empty_state, landing_page. Tailwind-only, React-globals-compatible, data-testids on every interactive.
- Tests: `/app/backend/tests/test_archetypes.test.js` + `test_brief_planner.test.js` — 48/48 tests pass.

### Session 2 (COMPLETE, 2026-02-18)
- `/app/lib/ai/brief-builder.js` — `buildWave()` runs a single wave via forced `create_files`, injects wave-specific recipes, enforces the wave's declared file list (over-produced files dropped), has tool_args_delta recovery + non-streaming retry. `runAllWaves()` orchestrates the full plan and aborts if scaffold fails.
- `/app/lib/ai/message-stream.js` — added `runNewBriefPipeline()` module-level function at EOF. Fast-path gate now checks `EMANATOR_NEW_PIPELINE` env flag; when set, routes brief → classify archetype → generate plan → stream waves → save. When unset, legacy fast-path runs **unchanged**.
- `/app/lib/stream-client.js` — registered new SSE events (`archetype`, `brief_plan`, `wave_start`, `wave_complete`, `wave_error`, `build_aborted`, `review_result`, `repair_start`) with callbacks.
- Tests: `/app/backend/tests/test_brief_builder.test.js` — 6 tests.

### Session 3 (COMPLETE, 2026-02-18)
- `/app/lib/ai/brief-reviewer.js` — `reviewBuild()` runs a strict self-critique pass (JSON mode, peeks at scaffold + auth + landing files). `repairBuild()` runs ONE repair wave via `create_files`/`update_files` to fix missing/broken items. Non-blocking on provider failure.
- `runNewBriefPipeline` now: classify → plan → build waves → **review → auto-repair** → done. Fetches content via `db.projectFiles.findByProjectId` for review context.
- `/app/components/dashboard/BriefProgressCard.jsx` — live progress UI with archetype badge, wave status icons, review pass/gaps indicator, ETA.
- `useDashboardStream.js` + `LeftPanel.jsx` — wired 8 new SSE callbacks to update `message.metadata.briefProgress`.
- Event collision fix: renamed new pipeline's `plan` event to `brief_plan`.
- Tests: `test_brief_reviewer.test.js` — 8 tests.

### Session 6 (COMPLETE, 2026-02-18) — Preview Fix + Archetype Hint
- `/app/components/dashboard/ArchetypeHint.jsx` — live archetype preview chip in the brief form
- `PreviewTab.jsx` AST plugin: added `window.__NAMED__` registry + `__namedImport()` resolver so named imports of non-component values (hooks, utils) work correctly. PascalCase named imports still use `__lazy`.

### Session 7 (COMPLETE, 2026-02-18) — Flag Removed, Legacy Deleted, Landing Metric
- **REMOVED `EMANATOR_NEW_PIPELINE` feature flag** from `.env.local`
- **DELETED 308 lines of legacy single-file code** from `message-stream.js` (was 4146, now 3838)
- Global hook-name safety net (`window.useAuth`, `window.useMockAPI`) as runtime fallback for LLM-omitted imports
- "From blank page to working app in under 2 minutes" credibility marker on `LoginPage.jsx`

### Session 8 (COMPLETE, 2026-02-18) — Codegen Robustness + Persistence + Share
- `autoInjectMissingImports()` in `brief-utils.js` — scans every generated file for bare `useAuth()`/`useMockAPI()` calls and auto-inserts correct relative-path import. Runs in `normalizeFiles()` pipeline.
- Backend persistence for BriefProgressCard — `stream-handler.js` accumulates archetype/plan/wave/review events into `messages.metadata.briefProgress` on save. Survives chat reload.
- Editable archetype chip — `ArchetypeHint` picker dropdown with all 17 archetypes. Override flows via `Archetype override: <id>` in brief text, bypasses LLM classification.
- Share-build-time feature — clipboard copy + twitter.com/intent/tweet link on BriefProgressCard.

### Session 9 (COMPLETE, 2026-02-18) — 🎉 Full Validation, 4 New Recipes
- Validation dogfood (iteration_103.json): **5/5 features passed, 100% success**. NexsaraV9 built in 72 seconds, 17 files, auto-generated Signup/Login/Dashboard without being asked.
- Added 4 recipes: `generic_list_page`, `item_detail_crud`, `forgot_password_success`, `search_page` wired into archetype-specific wave selection.

### Session 10 (COMPLETE, 2026-02-18) — Telemetry + Real P50 + Archetype Quick-Start
- Build telemetry via existing `generation_runs` (tool_mode encoded as `new_pipeline:${archetype.id}`), no schema changes.
- `/api/stats/build-times` endpoint with P50/P95/counts.
- Landing page now shows real P50 median when ≥5 builds exist.
- ArchetypeQuickStart tiles in InlineBrief (6 one-click starter archetypes).

### Session 11 (COMPLETE, 2026-02-18) — Telemetry-Informed UX
- `/api/stats/build-times` returns per-archetype `total`, `success_rate`, `avg_seconds`.
- Confidence badges in archetype picker (Emerald ≥80%, Amber 50-79%, Grey <50%, "New" for untested).
- Telemetry-informed plan preview on ArchetypeHint: "~17 files · ~122s to build · 94% success".

### Session 12 (COMPLETE, 2026-02-18) — Recommended Archetypes + Remix

**2 UX-coherent features landed:**

1. **Recommended Archetypes surface** — when classifier confidence is 0.55–0.70 (ambiguous), ArchetypeHint now shows 2–3 archetype cards side-by-side instead of silently picking one. Each card:
   - Archetype label
   - Confidence badge (Emerald/Amber/Grey by success rate, or "New")
   - First required flow as preview text
   - "Top" indicator on the auto-detected winner
   - Click → commits that archetype as override
   - Tagline: "Top match will be used if you don't pick — or just keep typing to refine."

   Turns "Emanator guessed" into "Emanator showed me the options." `classifyArchetypeFast` now returns `runnersUp: Archetype[]` (top 3) alongside the primary pick.

2. **Remix archetype** — post-build, BriefProgressCard now shows a "Remix as different archetype" button with a dropdown picker of the other 16 archetypes (current one excluded). Clicking one:
   - Composes a proper Creative Brief message with `Archetype override: <id>`
   - Pre-fills the chat composer via the existing `[data-testid="chat-input"]` dispatch pattern
   - User clicks Send to trigger the rebuild
   - Tagline: "Picking one will pre-fill the chat with a remix brief — click Send to rebuild."

   No new backend routes needed — reuses the existing archetype-override flow. Surgical UX addition, ~120 lines total across BriefProgressCard.

**Tests:** 84/84 pipeline tests pass (33 archetype tests including new runnersUp assertions). Lint clean. HTTP 200.

**Deliberately deferred:**
- Real Supabase wiring opt-in → Session 13 (needs a full feature flow for key collection + MockAPI→Supabase template swap)
- Deployable Vercel export → Session 14 (needs export format + deploy hook integration)

## Prioritized Backlog

### P0 — Session 13 (NEXT)
- Real Supabase wiring opt-in for generated apps: user provides Supabase URL + anon key in project settings → recipes swap MockAPI calls for real Supabase client at generation time
- Responsive / accessibility passes on generated output (mobile breakpoints, ARIA, focus states)

### P1 — Session 14
- Deployable Vercel export with one-click deploy-to-Vercel button
- Versioning/rollback UI for projects
- Project templates / one-click starters on the Dashboard empty state

### P2 — Future
- Stripe wiring for user-paid builds
- Full SSE dry-run mode if plan preview isn't enough
- Per-archetype recipe-tuning admin dashboard
- Multi-step onboarding wizard for first-time Emanator users

**UX-coherent delivery (respecting user's "build to the flow" directive):**

1. **Per-archetype stats in the API** — `/api/stats/build-times` endpoint now returns `archetype_stats` with `total`, `success_rate`, `avg_seconds` per archetype. Computed from last 500 runs in the 30-day window.

2. **Confidence badges in the archetype picker** — Picker items now show either:
   - `N · XX%` pill (emerald if ≥80% success, amber 50-79%, grey <50%) when the archetype has ≥3 historical builds
   - `New` badge for archetypes with no track record yet
   - Tooltip on hover: "N builds · XX% success · avg Ys"
   Users picking between "saas_tool" vs "ai_app" now see which is *proven* at a glance.

3. **Telemetry-informed plan preview** — New bottom row on the ArchetypeHint card:
   - `Plan preview: ~17 files · ~122s to build · 94% success across 12 builds`
   - Uses archetype's own avg when available; falls back to global P50
   - Zap icon, `data-testid="archetype-plan-preview"`
   - This is effectively a client-side dry-run — users see what they're committing to BEFORE clicking Build, without the complexity of backend stream pause/resume.

**The UX flow this session enables:**
```
User types brief → ArchetypeHint appears ("Looks like a SaaS tool / B2B software")
  → User sees "~17 files · ~122s · 94% success" below
  → Confidence: decide-go or remix archetype via picker
  → Pick different archetype → see its confidence badge + updated plan preview
  → Click Build with informed expectations
```

**Tests:** 84/84 pipeline tests pass. Lint clean. Stats endpoint verified returning `archetype_stats` (6 historical `unknown` builds; new builds will populate per-archetype).

**Deliberately deferred:**
- "Remix archetype" button on existing projects (rebuild-in-place needs file versioning plumbing; different feature) — Session 12
- Full SSE pause/resume dry-run (complex backend; plan preview delivers the trust value without this) — Session 12 if still wanted

## Prioritized Backlog

### P0 — Session 12 (NEXT)
- "Remix archetype" button on existing projects with file-archive + fresh-build
- Real Supabase wiring opt-in for generated apps (replaces MockAPI with per-project real backend)
- Deployable Vercel export

### P1 — Session 13
- Responsive / accessibility passes on generated output
- Versioning/rollback UI for projects
- Project templates / one-click starters

### P2 — Future
- Full SSE dry-run mode if plan-preview trust proves insufficient
- Per-archetype recipe-tuning admin dashboard (uses the same telemetry)
- Stripe wiring for user-paid builds

**Build telemetry — zero schema changes:**
- `runNewBriefPipeline` now logs `tool_mode: 'new_pipeline:${archetype.id}'` into the existing `generation_runs` table. Archetype is encoded in the tool_mode string; no migration needed.
- New `/api/stats/build-times` endpoint at `/app/lib/api/routes/stats.js`. Queries last 200 successful builds in the 30-day window, computes P50/P95/fastest, returns counts by archetype. 60-second cache. Public (no auth) — these are marketing metrics. Clamps anomalies (<5s, >15min).

**Landing page now shows REAL data:**
- `LoginPage.jsx` fetches `/api/stats/build-times` on mount. When ≥5 builds exist, the metric changes from static "under 2 minutes" to dynamic **"From blank page to working app in 122 seconds · median of 6 builds"** (cyan accent, dim subtitle). First-time credibility shifts from "claim" to "evidence".
- Current live values: P50=122s, P95=162s, fastest=35s across 6 builds.

**Archetype quick-start tiles in InlineBrief:**
- New `/app/components/dashboard/ArchetypeQuickStart.jsx` — 6 clickable tiles (SaaS tool / AI app / Marketplace / Portfolio / Store / CRM) with icon + label. Renders above the "What are you building?" input.
- Click fills `elevator_pitch` with a starter template + sets `archetype_override` so the pipeline skips LLM classification. Turns a blank form into a decisive starting point.

**Tests:** 84/84 pipeline tests pass. Lint clean. HTTP 200. Stats endpoint verified returning real data. Screenshot confirmed P50 rendered cleanly on landing.

**Deferred to Session 11 (scope creep defense):**
- "Remix archetype" button on existing projects — overlaps with the editable picker; bigger ask than Session 10 budget
- Dry-run / confirm-before-build mode — requires new SSE pause/resume plumbing

## Prioritized Backlog

### P0 — Session 11 (NEXT)
- "Remix archetype" button on existing projects: rebuild with new archetype preserving brand/copy
- Dry-run / confirm mode: pause pipeline at `brief_plan`, require user click to start waves
- "Build recipe preview" link in archetype picker: show file/flow breakdown before committing

### P1 — Session 12
- Real Supabase wiring opt-in for generated apps (replace MockAPI with real backend)
- Deployable Vercel export
- Responsive / accessibility passes on generated output

### P2 — Future
- Versioning/rollback UI for projects
- Project templates / one-click starters
- Per-archetype success-rate dashboard (uses the same telemetry)

**Validation dogfood (iteration_103.json): ALL 5 FEATURES PASSED, 100% success rate.**

- ✅ **Feature 1 — Archetype hint with editable picker** (SaaS tool / B2B software detected, picker has 17 archetypes, reset-to-auto works)
- ✅ **Feature 2 — autoInjectMissingImports post-processor** (Signup.jsx first non-blank line is `import { useAuth } from '../components/AuthContext'` — LLM omitted the import, post-processor auto-inserted it)
- ✅ **Feature 3 — Preview renders cleanly** (no useAuth/useMockAPI runtime errors)
- ✅ **Feature 4 — BriefProgressCard persistence** (card survives tab switches, shows "72s to working app")
- ✅ **Feature 5 — Share build time** (copy-to-clipboard works, tweet intent URL valid)

**Build stats from the dogfood:**
- Project: NexsaraV9 (SaaS archetype)
- 17 files across 4 waves
- Build time: **72 seconds** — beats the "under 2 minutes" promise on the landing page
- Auto-generated Signup/Login/Dashboard/Onboarding without user asking for them

**4 new recipes added this session:**
- `generic_list_page` — list view with Navbar + DataTable + create CTA (used by CRM/marketplace/e-commerce/productivity)
- `item_detail_crud` — edit/save/delete detail view (same archetypes)
- `forgot_password_success` — standalone success page after forgot-password submit
- `search_page` — live-filter search across any MockAPI collection (content_site/e-commerce/lms/marketplace/media)

**Recipe wiring updated in `recipesForWave()`:**
- Dashboard-heavy archetypes → get `data_table` + `generic_list_page` + `item_detail_crud`
- Content/commerce archetypes → get `search_page`
- Any archetype with `forgot_password_form` → automatically gets `forgot_password_success` too

**Tests:** 84/84 pipeline tests pass, lint clean, HTTP 200.

**Minor issues deferred:**
- CORS warning for `react-router-dom` from unpkg in preview iframe (non-blocking, noted in test report)
- Signup form could use more visual polish (recipe enhancement candidate)

## Prioritized Backlog

### P0 — Session 10 (NEXT)
- Archetype onboarding cards on Emanator landing page (6 big tiles replacing/alongside the current login form — turns the landing into "what will you build today?")
- "Remix archetype" button on existing projects: one-click swap archetype while preserving brand/copy
- Optional dry-run / confirm-before-build mode (~200 lines UI + stream plumbing)
- P50/P95 "time to working app" metric on Emanator's own dashboard (observability)

### P1 — Session 11
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- "Build recipe" link next to each archetype in the picker showing file/flow breakdown

### P2 — Future
- Responsive / accessibility passes on generated output
- Versioning/rollback UI for projects
- Project templates / one-click starters
- Real backend polish for generated apps (beyond MockAPI)

**4 deliverables shipped:**

1. **Missing-imports post-processor** — `autoInjectMissingImports()` in `/app/lib/ai/brief-utils.js` scans every generated file for bare `useAuth()`/`useMockAPI()` calls and auto-inserts the correct relative-path import if absent. Runs in `normalizeFiles()` after every wave + repair. Fixes the LLM's occasional import-omission at save time instead of relying on the runtime safety net. 11 new unit tests cover: pages/*, components/* (uses `./` path), never-touches-source-files, idempotent, combined imports, injects-after-existing-imports.

2. **BriefProgressCard persistence to backend** — `stream-handler.js` now accumulates `archetype` / `brief_plan` / `wave_complete` / `review_result` events during the stream into `briefProgressAccumulator`, then writes it into `messages.metadata.briefProgress` on final save. Chat reload via `loadMessages()` now restores the progress card from database metadata — card survives page refresh.

3. **Editable archetype chip** — ArchetypeHint now renders its archetype label as a clickable button with a ChevronDown. Click → opens a scrollable picker of all 17 archetypes. Selecting one sets `brief.archetype_override`, which gets appended to the build instructions ("Archetype override: saas_tool"). The pipeline's classifier step now checks for `Archetype override:` in the message text FIRST and skips LLM classification when user has explicitly chosen one. "Reset to auto" link returns to the auto-detected archetype.

4. **Share-build-time button** — `ShareBuildTime` sub-component on `BriefProgressCard`. Shows two pills after build completion: "Share build time" (copies "I just built {brand} — a working {archetype} with {N} files in {seconds} seconds. 🚀 #Emanator" to clipboard) + "Tweet it" (opens pre-filled twitter.com/intent/tweet). Zero dependencies.

**Tests:** **84/84 pipeline tests pass**, lint clean, service restart clean, HTTP 200. Smoke screenshot confirmed InlineBrief form renders properly with The Big Picture section visible.

**Status of the runtime safety net:** still in place as belt-and-suspenders. Two layers now protect against missing imports: (1) codegen post-processor inserts them at save time, (2) runtime `window.useAuth` / `window.useMockAPI` catches any that slip through.

## Prioritized Backlog

### P0 — Session 9 (NEXT)
- End-to-end validation dogfood confirming: new builds now include `useAuth` imports on first try, archetype override works, BriefProgressCard persists across reload, share button works
- Optional dry-run / confirm-before-build mode: render the plan for 10 seconds with a Cancel button before starting waves
- Remaining recipes: `forgot_password_success`, `generic_list_page`, `item_detail_crud`, `search_page`

### P1 — Session 10
- Archetype onboarding cards on landing (6 giant tiles instead of login form as primary CTA)
- "Remix archetype" button on existing projects — swap archetype while preserving brand/copy
- "Time to working app" metric that tracks the P50 / P95 over the last 100 builds (observability)

### P2 — Future
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

**🎉 MILESTONE: New pipeline is the only pipeline.** Fourth dogfood (iteration_102.json) confirmed:
- ✅ `__namedImport` preview fix works (landing page renders cleanly, Navbar + Login with imports work)
- ✅ Symbol-name discipline holds
- ✅ All wins from Sessions 1–6 hold
- Remaining: LLM occasionally drops the `import { useAuth }` line → runtime `useAuth is not defined`

**Shipped in this session:**
- **Global hook-name safety net** — preamble pre-declares `window.useAuth` / `window.useMockAPI` as deferred-lookup wrappers that scan `__NAMED__` for the hook. Files without imports now fall through to the global instead of throwing `ReferenceError`. Real imports continue to shadow the global (correct).
- **Mandatory-imports prompt rule** (HARD RULES #12) — every wave + repair prompt now explicitly requires `import { useAuth }` / `import { useMockAPI }` at the top of any file that uses them. Reduces the problem at the source.
- **REMOVED `EMANATOR_NEW_PIPELINE` env flag** — deleted from `/app/.env.local`.
- **DELETED the legacy single-file fast-path** — 308 lines of dead code removed from `message-stream.js` (was lines 141–448). File is now 3838 lines (was 4146). New pipeline is the unconditional path for all Creative Brief submissions.
- **Landing page credibility marker** — `LoginPage.jsx` now shows `"From blank page to working app in under 2 minutes"` under the "AI Builder Platform" subtitle. Cyan accent, `data-testid="landing-time-metric"`. Screenshot-verified rendering cleanly.

**Tests:** 73/73 pipeline tests pass, lint clean, service healthy, HTTP 200.

## Known Issues
- BriefProgressCard disappears on chat reload (frontend-only metadata). Deferred to Session 8. Low user-facing impact.
- Occasional LLM-omitted import statements are now **non-blocking** at runtime thanks to global safety net, but ideal would be 100% import discipline. Session 8 could add a codegen post-processor that inserts missing imports.

## Prioritized Backlog

### P0 — Session 8 (NEXT)
- Post-processor for missing imports: scan generated files for `useAuth`/`useMockAPI` calls; if a file uses them without importing, auto-insert the import line before save. Eliminates the runtime-fallback dependency.
- BriefProgressCard persistence: write `briefProgress` into `messages.metadata` JSON column on save, restore on `loadMessages`. ~50 lines.
- Add editable archetype chip in InlineBrief — if user disagrees with the auto-detected archetype, click to pick a different one from the 17 available.

### P1 — Session 9
- Optional dry-run / confirm-before-build mode
- "Remix archetype" button on existing projects
- Archetype onboarding cards on landing (6 giant tiles instead of/alongside the login form)
- Remaining recipes: `forgot_password_success`, `generic_list_page`, `item_detail_crud`, `search_page`

### P2 — Future
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

**Third dogfood (iteration_101.json) key wins verified:**
- ✅ Symbol-name fix **confirmed working** — all generated code uses lowercase `signup`/`login`/`logout`, no more camelCase drift
- ✅ Double-escape fix holds — all 17 files have real newlines
- ✅ **NEW: ArchetypeHint component** appears live as user types the brief. Verified: "Looks like a SaaS tool / B2B software" appears with auto-routes ("login · signup · forgot_password · dashboard"). Turns the invisible classification step into a trust-building moment before the 90-second build.

**Blocker surfaced: preview iframe threw `useAuth is not a function`** even though generated code was correct. Root cause: the Babel AST plugin in `PreviewTab.jsx` rewrote all named imports as `__lazy('useAuth')`, which returns a React component wrapper — not a callable hook.

**Fix shipped (Session 6):**
- Added `window.__NAMED__` registry to preview runtime preamble
- Added `__namedImport(modName, exportName)` resolver — returns a deferred function that looks up the real hook at call time (handles any eval order)
- Patched AST plugin's `ImportSpecifier` handler: PascalCase named imports keep the `__lazy` path (named component exports), lowercase ones use `__namedImport` (hooks/utils)
- Patched AST plugin's `ExportNamedDeclaration` handler: now emits `window.__NAMED__[modName].exportName = exportName` for every named function/const export, so sibling files can resolve them

**New components/files:**
- `/app/components/dashboard/ArchetypeHint.jsx` — client-side live archetype preview below the elevator-pitch field

**Known minor issue deferred to Session 7:**
- BriefProgressCard disappears on chat reload because `briefProgress` metadata is frontend-only (not persisted to backend). The earlier preserve-on-save fix works during the stream, but `loadMessages()` wipes it on chat switch. Fix needs backend metadata persistence or sessionStorage hydration. LOW user-facing impact (card is correctly shown during the build — the moment that matters).

**Flag status:** `EMANATOR_NEW_PIPELINE=1` remains active. Flag removal deferred to Session 7 pending one more dogfood confirming the preview actually renders end-to-end now.

## Prioritized Backlog

### P0 — Session 7 (NEXT)
- **Final dogfood** to verify the `__namedImport` / `__NAMED__` fix makes the preview render cleanly (no `useAuth is not a function`). If green, **remove the flag and legacy single-file prompt** — milestone.
- Fix BriefProgressCard persistence: persist `briefProgress` to message metadata in backend (small schema addition + write in runNewBriefPipeline), or sessionStorage hydration in useDashboardStream
- Add the "Time to working app" metric (~90s) as a credibility marker on Emanator's landing page

### P1 — Session 8
- Optional dry-run / confirm-before-build mode
- "Remix archetype" button
- Archetype onboarding cards on landing
- Remaining recipes

### P2 — Future
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

### Session 4 (COMPLETE, 2026-02-18) — DOGFOOD + double-escape fix
- Flipped `EMANATOR_NEW_PIPELINE=1`, ran testing agent on Nexsara brief → 17 files in 162s, Signup auto-generated ✓
- Found bug: LLM double-escaped content in repair wave → literal `\n` instead of newlines
- Fix: `/app/lib/ai/brief-utils.js` with `normalizeFileContent()` helpers, applied in builder + reviewer

### Session 5 (COMPLETE, 2026-02-18) — Symbol-name discipline + 5 recipes
- Second dogfood confirmed double-escape fix; surfaced LLM camelCase drift (`signUp` instead of `signup`)
- Fix: "★ EXACT SYMBOL NAMES" prompt section in builder + reviewer
- Added 5 recipes: settings_page, profile_page, data_table, chat_interface, empty_state
- Smart archetype-aware recipe injection in `recipesForWave()`
- Live "time to working app" elapsed counter on BriefProgressCard

## Known Issues
- BriefProgressCard disappears after chat reload (frontend-only metadata, not persisted). Deferred to Session 7.

## 3rd Party Integrations
- OpenAI GPT-4o via Emergent LLM key (text + vision)
- Supabase (projects DB + auth)
- E2B Sandbox

## Critical Rules for Next Agent
- DO NOT install `sharp` or native binary modules (crashes Next.js).
- The `frontend` supervisor entry is a dead CRA leftover; the real app runs via `nextjs_api`. Ignore frontend FATAL status unless port 3000 actually stops responding.
- PreviewTab.jsx supports multi-file imports via its AST plugin. Now also supports NAMED imports of non-component values (hooks, utils) via the new `__NAMED__` registry + `__namedImport()` resolver (PascalCase = lazy component, camelCase = named function).
- Tests use Jest via next/jest; run with `npx jest backend/tests/<file>.test.js`.
- The legacy single-file fast-path at `message-stream.js` lines 145–176 is scheduled for removal next session, but remains in place until one more successful dogfood confirms the preview renders cleanly with the new `__namedImport` fix.
