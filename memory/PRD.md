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
- `/app/components/dashboard/BriefProgressCard.jsx` — live progress UI. Shows archetype badge, route/file count, per-wave status icons (pending/running/complete/error), review pass/gaps indicator, estimated time remaining.
- `/app/components/dashboard/useDashboardStream.js` — wired `onArchetype`, `onBriefPlan`, `onWaveStart`, `onWaveComplete`, `onWaveError`, `onBuildAborted`, `onReviewResult`, `onRepairStart` callbacks; each updates `message.metadata.briefProgress` so the card re-renders live.
- `/app/components/dashboard/LeftPanel.jsx` — imports & renders `<BriefProgressCard>` above PlanCard when message has `briefProgress` metadata.
- Tests: `/app/backend/tests/test_brief_reviewer.test.js` — 8 tests covering review ok-path, missing flows, malformed JSON, empty files, provider failure, repair wave mechanics, tool_args_delta recovery. **62/62 total tests pass**.
- Event collision fix: renamed new pipeline's `plan` event to `brief_plan` to avoid triggering existing approval UI.
- ZERO impact on legacy flow. Flag still unset by default.

## Prioritized Backlog

### P0 — Session 4 (NEXT)
- **Flip the flag and dogfood** — set `EMANATOR_NEW_PIPELINE=1` in env, restart, run 3 briefs: Nexsara (SaaS), a marketplace, a portfolio
- Run `testing_agent_v3_fork` end-to-end on Nexsara: assert ≥8 files produced, Signup exists even though brief didn't list it, "Start Free Trial" → signup form → dashboard flow works, refresh preserves auth state
- Tune recipes and prompts based on real output quality
- Remove `EMANATOR_NEW_PIPELINE` flag, delete legacy single-file prompt (lines 145–176 of message-stream.js)

### P1 — Session 5 (polish)
- Remaining recipes: settings, profile, data_table, item_detail, search, chat_interface, conversations_list
- Dry-run / confirm mode: pause at `brief_plan` event, require user click to start waves. Needs a new message round-trip — ~200 lines of UI + backend plumbing.
- "Remix archetype" button: one-click switch archetype while keeping brand/copy

### P2 — Future (out of scope for architecture upgrade)
- Real Supabase wiring (opt-in via user-provided keys)
- Deployable export to Vercel
- Responsive / accessibility passes
- Versioning/rollback UI
- Project templates / one-click starters

## Known Issues
None from this session.

## 3rd Party Integrations
- OpenAI GPT-4o via Emergent LLM key (text + vision)
- Supabase (projects DB + auth)
- E2B Sandbox

## Critical Rules for Next Agent
- DO NOT install `sharp` or native binary modules (crashes Next.js).
- DO NOT modify the existing fast-path in Session 2 without keeping it behind the flag — new code runs side-by-side with old.
- The `frontend` supervisor entry is a dead CRA leftover; the real app runs via `nextjs_api`. Ignore frontend FATAL status unless port 3000 actually stops responding.
- PreviewTab.jsx **does support multi-file imports** via its AST plugin (lines 362–444). The old handoff was wrong about this.
- Tests use Jest via next/jest; run with `npx jest backend/tests/<file>.test.js`.
