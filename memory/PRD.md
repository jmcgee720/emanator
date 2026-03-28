# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo, run the Next.js AI builder, harden (A-G), implement design system (H).

## Architecture
- Next.js 14 App Router (port 3002, supervisor: `nextjs_api`)
- FastAPI reverse proxy (port 8001 -> 3002)
- Supabase (Postgres + RLS)

## Completed Phases
- **A-G5**: Plan validation, Workspaces, Memory, Routing, Multi-Pass, Self-Critique, Autonomous Execution
- **G6**: Session Forking — `POST /api/chats/:id/fork` + UI Fork button
- **H1**: Moodboard Translation — cosmic dark UI design brief
- **H2**: Design Token System — CSS variables + utility classes + brand logo
- **H3**: Shell Refactor — TopBar, LeftPanel, RightPanel, Dashboard wrapper
- **H4**: Interaction + Motion Layer (Mar 2026)
  - Messages: `em-message-enter` (fade+slide 180ms), streaming avatar breathe+glow ring, energy-pulse cursor
  - Buttons: scale 1→1.02 hover, 0.98 active, glow intensify (150ms ease)
  - Cards/Panels: `em-panel-enter`, hover translateY(-1px) + glow expand, `em-selected` state
  - Diff: `em-diff-add`/`em-diff-remove` with glow-pulse left edge, fade-in entrance
  - PlanCard: entrance animation, token surfaces, muted→em-text-muted
  - Zero remaining `bg-muted` in chat/diff/plan components

## Backlog
- P0: H5 — Login page full token alignment
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + keyframes (H2+H4)
- `/app/components/dashboard/LeftPanel.jsx` — Messages with motion
- `/app/components/dashboard/DiffReviewPanel.jsx` — Diff with glow lines
- `/app/components/dashboard/PlanCard.jsx` — Plan with entrance anim
- `/app/components/dashboard/TopBar.jsx` — Shell (H3)
- `/app/components/dashboard/Dashboard.jsx` — Shell (H3)
- `/app/components/dashboard/RightPanel.jsx` — Shell (H3)
