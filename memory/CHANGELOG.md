# Emanator AI Builder — Changelog

## 2026-04-02: Narrow PM Mode — Direct-Edit for Medium-Safe Builds
- Widened `isSimpleFrontendEdit` to catch dashboards, settings screens, profiles, navbars, modals, tables, heroes, galleries, forms, cards, banners, etc.
- Added `isLargeAppBuild()` — only triggers PM mode for full apps, multi-page, SaaS, CRM, marketplace, auth+billing combos
- PM mode no longer fires for "build a dashboard" or "build a pricing page" — those go straight to direct-edit
- Classification chain: PROCEED → DIRECT-EDIT → PM MODE → NORMAL

## 2026-04-02: Project Manager Conversational Mode + UI Jargon Cleanup
- Added `isProceedSignal()` in `intents.js` — detects explicit "go ahead" / "build it" signals
- For build intents without a proceed signal, AI now responds conversationally as a project manager
  - Plain-language plan of action, no code, no file paths, no jargon
  - User can discuss, adjust, then say "go ahead" to trigger actual building
- Removed "Intent: BUILD" badge from chat messages (LeftPanel.jsx)
- Removed "Grounded on: NONEXISTENT" display from PlanCard.jsx
- Removed technical grounding check badges from PlanCard.jsx
- Removed intent badge from plan card header

## 2026-04-02: Fix Core System Chat Creation
- Root cause: "New Chat" in core mode created regular chats, but sidebar only shows SELF_EDIT chats — so chats appeared to fail/vanish
- Fix: Route "New Chat" through `createSelfEditChat()` when `builderMode === 'core'` (both ProjectHub and LeftPanel)
- Added try/catch + error logging to backend `db.chats.create` for better error visibility
- Verified: self-edit chat creation returns 201 with `chat_type: "self_edit"`

## 2026-04-01: Upgrade Direct-Edit System Prompt to Premium Quality
- Replaced minimal 12-line prompt with comprehensive premium generation instructions
- Mandatory 10-section page structure (nav, hero, social proof, features, stats, showcase, testimonials, pricing, final CTA, footer)
- Visual quality requirements (spacing py-16+, container max-w-6xl, typography hierarchy, depth/polish)
- Brand expression rules (theme-aware copy, visual tone matching, authentic placeholder content)
- Single-file execution rules preserved

## 2026-04-01: Simple Frontend Direct-Edit Mode
- Added `isSimpleFrontendEdit()` + `findMainPagePath()` in `lib/ai/intents.js`
- Modified `processMessageStream` in `lib/ai/service.js` to detect simple frontend requests
- Bypass: plan mode, task-mode enforcement, diff pipeline — files saved directly to DB
- Preview auto-updates via existing srcdoc iframe path (no install/start-preview needed)
- Planner UI now reserved for multi-file, architecture, backend, and risky changes only

## 2026-04-01: Grounding Injection for AI Calls
- Created `buildProjectGroundingBlock()` helper in `lib/ai/service.js`
- Injects project identity (name, ID, core/project mode) + full file index into all AI system prompts
- Injected into all 3 AI entry points: `processMessageStream`, `executePlanStream`, `processMessage`
- Prevents AI from hallucinating non-existent file paths during planning and code generation

## 2026-03-31: Phase 2 Route Modularization
- route.js reduced from 2038 to 119 lines (94.2% reduction from original 4113 lines)
- Extracted 9 high-risk route modules into `lib/api/routes/`
- Phase 2 dispatcher array with strict ordering

## 2026-03-31: Phase 1 Route Modularization
- route.js reduced from 4113 to 2038 lines (50.4% reduction)
- Created `lib/api/helpers.js` — shared helpers
- Extracted 17 route modules into `lib/api/routes/`

## 2026-03-31: Core System Self-Editing
- Created `lib/api/routes/live-promote.js` with promote-to-live and rollback endpoints
- Added Apply to Live / Rollback UI to CodeTab + ProjectHub
- Fixed Core System button lookup to use `settings.is_core === true`

## 2026-03-31: UI Hardening
- Fixed optimistic UI state updates for project/chat renames
- Replaced blur/implicit save with explicit Save/Cancel rename controls
- Fixed JSON.parse crash on "New Chat" creation
- Removed "Delete All" button from Dashboard
