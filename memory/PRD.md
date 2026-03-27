# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo (`https://github.com/jmcgee720/emanator`), run the existing Next.js application, and verify/harden core AI builder features (preview, planner, diff, apply) end-to-end.

## Architecture
- **Frontend**: Next.js 14 App Router (port 3000)
- **Backend**: FastAPI reverse proxy (port 8001 -> 3000)
- **Database**: Supabase (Postgres + RLS)
- **AI**: OpenAI GPT-4o / Anthropic Claude via user API keys

## Completed
- Next.js env setup and Supabase connection verified
- FastAPI `server.py` rewritten as reverse proxy
- Missing DB models (`changelog`, `projectMemory`, `generationRuns`) added
- Silent `.catch(() => {})` mapped to `console.warn`
- React hydration error fixed in `MessageRenderer.jsx`
- Image routing fixed (BUILD intent bypasses image gen)
- Image Generation UX: inline progress bar in `LeftPanel.jsx`
- Phase A1 Logging: `file_actions` added to all plan rejections; missing `execute` event added
- Supabase RLS recursion fix (`005_fix_generation_runs_rls.sql`)
- Plan Validator empty-project bypass fixed in `_processStream`
- **`validatePlan()` guard added to `executePlanStream`** (Feb 2026) — rejects invalid plans before any file operations

## Backlog
- P1: Further Phase A2 Plan Validator audits (user-directed)
- P2: Refactor `lib/ai/service.js` (~2500 lines) into smaller modules
