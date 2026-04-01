# Emanator AI Builder — Changelog

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
