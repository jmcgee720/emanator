# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo (`https://github.com/jmcgee720/emanator`), run the existing Next.js application, and verify/harden core AI builder features. Execute phased hardening (A-G) and design system implementation (H).

## Architecture
- **Frontend**: Next.js 14 App Router (port 3002, supervisor: `nextjs_api`)
- **CRA Stub**: Emergent platform default frontend (port 3000, supervisor: `frontend`)
- **Backend**: FastAPI reverse proxy (port 8001 -> 3002)
- **Database**: Supabase (Postgres + RLS)
- **AI**: OpenAI / Anthropic via user API keys

## Completed Phases
- **Phases A-G5**: Plan validation, Core System Workspaces, Memory, AI Routing, Multi-Pass Planning, Self-Critique, Autonomous Execution
- **Phase G6**: Session Forking — `POST /api/chats/:id/fork` + UI Fork button
- **Phase H1**: Moodboard Translation — design-system brief (cosmic dark UI)
- **Phase H2**: Design Token System — CSS variables, utility classes, brand logo (Mar 2026)
- **Phase H3**: Component Refactor — Dashboard Shell (Mar 2026)
  - TopBar: `em-panel` bg, glow-edge bottom, image logo, cyan icon hovers
  - LeftPanel: `em-panel` bg, `em-accent-edge-right` separator, cyan hover states
  - RightPanel: `em-void` bg, cyan active tabs
  - Dashboard wrapper: void bg, glow-edge workspace tabs, `em-card` project cards, `em-glass` modal, `em-btn-brand/ghost` buttons
  - All gray borders → glow edges, all bg-muted → em-surface/void, all border-border → rgba violet

## Backlog
- P0: Phase H4 — Apply tokens to Chat/Messages, Diff Preview, Memory/Prompts panels
- P1: Phase H5 — Login page token alignment (currently partially styled)
- P2: Refactor `lib/ai/service.js` (~2600 lines)

## Key Files
- `/app/app/globals.css` — Design token system
- `/app/public/emanator-logo.png` — Brand mark (256x256)
- `/app/components/dashboard/TopBar.jsx` — TopBar (H3 patched)
- `/app/components/dashboard/LeftPanel.jsx` — LeftPanel (H3 patched)
- `/app/components/dashboard/RightPanel.jsx` — RightPanel (H3 patched)
- `/app/components/dashboard/Dashboard.jsx` — Dashboard shell (H3 patched)
- `/app/components/auth/LoginPage.jsx` — Login page (partially styled)
- `/app/app/api/[[...path]]/route.js` — API catch-all
- `/app/backend/server.py` — FastAPI proxy (port 3002)
