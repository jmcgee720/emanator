# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo (`https://github.com/jmcgee720/emanator`), run the existing Next.js application, and verify/harden core AI builder features. Execute phased hardening (A-G) and design system implementation (H).

## Architecture
- **Frontend**: Next.js 14 App Router (port 3002, supervisor: `nextjs_api`)
- **CRA Stub**: Emergent platform default frontend (port 3000, supervisor: `frontend`)
- **Backend**: FastAPI reverse proxy (port 8001 -> 3002)
- **Database**: Supabase (Postgres + RLS)
- **AI**: OpenAI / Anthropic via user API keys or Emergent Universal Key

## Completed Phases
- **Phases A-G5**: Plan validation, Core System Workspaces, Memory Injection, AI Routing, Multi-Pass Planning, Self-Critique, Autonomous Multi-Step Execution
- **Phase G6**: Session Forking — `POST /api/chats/:id/fork` + UI Fork button
- **Phase H1**: Moodboard Translation — design-system brief from cosmic AI moodboard
- **Phase H2**: Design Token System (Mar 2026)
  - Rewrote `globals.css` with complete token layer: `--em-void`, `--em-panel`, `--em-surface`, accent colors, gradient tokens
  - Added utility classes: `.em-panel`, `.em-card`, `.em-input`, `.em-glass`, `.em-elevated-interactive`, `.em-btn-brand`, `.em-btn-ghost`, `.em-text-primary/secondary/muted`, `.em-accent-edge-*`
  - Swapped TopBar logo from inline SVG to new brand mark image (`/public/emanator-logo.png`)
  - Updated shadcn semantic tokens (`.dark`) to map to Emanator palette
  - Tokens compiled and verified live in Next.js build

## Backlog
- P0: Phase H3 — Apply tokens to Dashboard shell (TopBar, LeftPanel, RightPanel structure)
- P0: Phase H4 — Apply tokens to Chat/Messages, Diff Preview, Memory panels
- P2: Refactor `lib/ai/service.js` (~2600 lines) into smaller modules

## Key Files
- `/app/app/globals.css` — Design token system (H2)
- `/app/public/emanator-logo.png` — New brand mark
- `/app/components/dashboard/TopBar.jsx` — Updated with image logo + `em-panel` class
- `/app/components/dashboard/Dashboard.jsx` — Main dashboard (forkChat handler)
- `/app/components/dashboard/LeftPanel.jsx` — Chat panel with Fork button
- `/app/app/api/[[...path]]/route.js` — API catch-all (fork endpoint)
- `/app/backend/server.py` — FastAPI proxy (port 3002)
