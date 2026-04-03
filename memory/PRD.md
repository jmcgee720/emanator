# Emanator AI Builder — Product Requirements

## Original Problem Statement
Build and continuously harden the Emanator AI Builder core system. Key goals:
1. Inject real project file index into all AI prompts (Grounding Injection)
2. Direct-edit mode for simple single-page frontend requests
3. Suppress internal agent jargon from user-facing chats
4. Auto-execute medium-safe plans inline without PlanCard
5. PM Mode (Approval UI) reserved for large/risky tasks
6. Ensure auto-executed direct-build requests write files and refresh preview

## Architecture
- Next.js 14 App Router
- Supabase (Auth + DB)
- OpenAI GPT-4o / Anthropic Claude via Emergent LLM Key
- Stripe for payments

### Key Files
- `/app/lib/ai/service.js` — Core AI orchestrator (~2500 lines)
- `/app/lib/ai/intents.js` — Intent classification (direct-edit, auto-execute, PM mode)
- `/app/lib/api/stream-handler.js` — SSE streaming + DB persistence
- `/app/components/dashboard/Dashboard.jsx` — Frontend state orchestrator
- `/app/components/dashboard/LeftPanel.jsx` — Message rendering, PlanCard
- `/app/components/dashboard/tabs/PreviewTab.jsx` — iframe preview

## What's Implemented ✅
- Grounding Injection (real file index in prompts)
- Direct-Edit Mode (single-page edits bypass planner)
- Core System Chat Fix (Self-Edit routing)
- Conversational UI Cleanup (no jargon)
- Preview Height Fix (flex/iframe layout)
- PlanCard Suppression for auto-executed plans
- **Auto-Execute File Persistence + Preview Refresh** (P0 fix — Apr 2026)

## Upcoming Tasks
- P1: Phase 2-5 conversational AI architecture (Intent Detection, Task Scope, Silent Validation, Learning)
- P1: CSV export for Growth panel
- P2: Deploy integration (Vercel/Netlify) — currently mocked
- Refactor: service.js breakdown (~2500 lines)
