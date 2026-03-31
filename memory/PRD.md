# Emanator AI Builder — Product Requirements Document

## Original Problem Statement
Continuously harden the Emanator AI Builder core system. Refine the Aurora UI, improve workspace navigation, execute a multi-step hardening plan (Steps 1-18) to enforce strict mode boundaries, safe patch generation, cross-project context checks, and tackle significant technical debt by refactoring massive files.

## Architecture
- **Frontend**: Next.js 14 App Router with Aurora dark luxury UI
- **Backend**: FastAPI proxy + Supabase + MongoDB
- **AI Engine**: OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key
- **Payments**: Stripe (Emergent Test Key)
- **Pipeline**: Classification -> Mode Routing -> Validation -> Execution

## What's Been Implemented

### Hardening Steps 1-17 (ALL COMPLETE)
- Step 1: `GET /api/projects/:id/files-index` + `projectFileIndex` state
- Step 2: Hard Grounding Gate (reject non-existent updates, require/validate `plan.projectId`)
- Step 3: Conversation Lock (block cross-project streaming, UI project labels)
- Step 4: Structured Task Modes (plan_only / patch_only / read_only_report classification + enforcement)
- Step 5: Large File Rewrite Safety (>70% replacement rejection)
- Step 7: Cross-Project Resolver (exact-path lookup, suggestion-only, no auto-switch)
- Step 8: UI Fixes (file count badge, chat mode label, wrong project warning)
- Steps 16-17: Execution Pipeline Separation (tool filtering, hasPlanCall guard, text-fallback blocking)

### Step 18: Final Validation Pass (COMPLETE)
- Full audit of all 22 checks across Steps 1-17
- All checks PASS with file + line evidence
- No regressions detected
- Status: READY TO CLOSE

### Service Extractions (COMPLETE)
- `pending-diff.js` — pending diff helpers extracted from service.js
- `internal-api-exec.js` — internal API execution extracted from service.js
- `read-only-report.js` — read-only inspection logic extracted from service.js

### Step 20: Phase 1 Route Modularization (COMPLETE — 2026-03-31)
- **route.js reduced from 4113 to 2038 lines (50.4% reduction)**
- Created `lib/api/helpers.js` — shared helpers (handleCORS, getAuthUser, checkAllowlist, initializeOwner)
- Extracted 17 route modules into `lib/api/routes/`:
  - `public.js` (3 endpoints: /, /health, /providers/status)
  - `auth.js` (1 endpoint: /auth/check)
  - `admin.js` (2 endpoints: /admin/monitored, /admin/activity)
  - `exports.js` (3 endpoints: exports CRUD + manifest import)
  - `credits.js` (3 endpoints: credits balance/use/add)
  - `search.js` (1 endpoint: global search)
  - `growth.js` (14 endpoints: trends, crawl, analyze, drafts, pages, feedback)
  - `personas.js` (3 endpoints: CRUD)
  - `imports.js` (3 endpoints: GitHub import, GitHub sync, ZIP import)
  - `deployments.js` (2 stub endpoints)
  - `snapshots.js` (3 endpoints: snapshots CRUD + restore)
  - `generations.js` (2 endpoints: generation runs, file events)
  - `memory.js` (4 endpoints: project memory CRUD)
  - `builder-status.js` (1 endpoint)
  - `prompt-library.js` (3 endpoints: CRUD)
  - `learning.js` (9 endpoints: learning, rules, preferences)
- Dispatcher pattern in route.js with preserved evaluation order
- All Phase 2 routes remain inline (admin/users, projects, sandbox, chats, files, canvas, design, diffs, assets/upload)
- Zero behavior changes — all endpoints verified working

## Prioritized Backlog

### P0 — Next
- Phase 2 extraction: remaining inline routes in route.js (~2038 lines -> target ~200 line dispatcher)
  - admin/users, projects, account, sandbox, chats/messages, project files, canvas, design, diffs, assets/upload

### P1 — Growth
- CSV export option

### P2 — Future
- Deploy integration (Vercel/Netlify) — currently mocked

## Key Files
- `/app/lib/ai/service.js` — Core AI handler
- `/app/lib/ai/plan-validator.js` — Plan & patch validation
- `/app/lib/ai/intents.js` — Intent classification + request-mode gate
- `/app/lib/ai/tools.js` — Tool schemas (propose_plan, PLAN_ONLY_TOOLS)
- `/app/lib/supabase/db.js` — Database queries + cross-project resolvers
- `/app/lib/api/stream-handler.js` — SSE endpoint + Conversation Lock
- `/app/lib/api/helpers.js` — Shared route helpers (handleCORS, getAuthUser, checkAllowlist, initializeOwner)
- `/app/lib/api/routes/` — Phase 1 extracted route modules (17 files)
- `/app/components/dashboard/Dashboard.jsx` — Main UI state
- `/app/components/dashboard/LeftPanel.jsx` — Sidebar + UI indicators
- `/app/app/api/[[...path]]/route.js` — Catch-all API dispatcher + Phase 2 inline routes (~2038 lines)
