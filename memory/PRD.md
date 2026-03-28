# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo (`https://github.com/jmcgee720/emanator`), run the existing Next.js application, and verify/harden core AI builder features (preview, planner, diff, apply) end-to-end. Execute phased hardening fixes spanning Plan Validation, Core System Workspaces, Memory Injection, AI Routing, Multi-Pass Planning, Self-Critique, and Autonomous Multi-Step Execution (Phases A through G).

## Architecture
- **Frontend**: Next.js 14 App Router (port 3002, supervisor: `nextjs_api`)
- **CRA Stub**: Emergent platform default frontend (port 3000, supervisor: `frontend`)
- **Backend**: FastAPI reverse proxy (port 8001 -> 3002)
- **Database**: Supabase (Postgres + RLS)
- **AI**: OpenAI GPT-4o / Anthropic Claude via user API keys or Emergent Universal Key

## Completed Phases
- **Phase A**: Plan validation, `validatePatchGrounding` in `executePlanStream` and text-parsing fallbacks
- **Phase B**: Cancel-In-Flight (SSE), Core System Workspace path-scoping, Self-Edit Mode UI
- **Phase C**: Builder Memory injection, Adaptive learning error logging, Auto-Routing collision fix
- **Phase D**: E2E integration tests (`/app/tests/e2e-plan-apply.test.mjs`)
- **Phase E**: Structural Refactor — extracted streaming logic into `/app/lib/api/stream-handler.js`
- **Phase F**: Multi-Pass Planning, Self-Critique Loop, Retry Learning, Memory Scoring, Novel-Problem Reasoning
- **Phase G1-G5**: Multi-Step Execution, Goal Persistence, Task Breakdown, Verification Loop, Confidence Scoring
- **Phase G6**: Session Forking (Mar 2026)
  - Backend: `POST /api/chats/:id/fork` endpoint
  - Frontend: "Fork" button in quick actions bar (LeftPanel.jsx) + `forkChat` handler in Dashboard.jsx
  - Compresses source chat history, creates new chat "Fork of: <original>", seeds with synthetic summary + latest plan/diff metadata
  - Tested: title, metadata carryover (proposedPlan, diffStatus, planId), error cases (401, 404), small chat fork

## Backlog
- P2: Refactor `lib/ai/service.js` (~2600 lines) into smaller modules
- P3: Additional polish/UX for fork feature (e.g., confirmation dialog, fork history)

## Key Files
- `/app/app/api/[[...path]]/route.js` — API catch-all (fork endpoint at line ~1355)
- `/app/lib/ai/service.js` — Core AI service with `compressContext()`
- `/app/lib/api/stream-handler.js` — Extracted SSE streaming logic
- `/app/components/dashboard/Dashboard.jsx` — Main dashboard with `forkChat` handler
- `/app/components/dashboard/LeftPanel.jsx` — Chat panel with Fork button in quick actions
- `/app/backend/server.py` — FastAPI proxy (routes to Next.js on port 3002)
- `/app/tests/test-fork-endpoint.mjs` — Fork endpoint test suite
