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

### Session 7 (COMPLETE, 2026-02-18) — Flag Removed, Legacy Deleted, Landing Metric

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
