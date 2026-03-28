# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo, run the Next.js AI builder, harden (A-G), implement design system (H).

## Architecture
- Next.js 14 App Router (port 3000, supervisor: `nextjs_api`)
- FastAPI reverse proxy (port 8001 -> 3000)
- Supabase (Postgres + RLS)

## Completed Phases
- **A-G5**: Plan validation, Workspaces, Memory, Routing, Multi-Pass, Self-Critique, Autonomous Execution
- **G6**: Session Forking — `POST /api/chats/:id/fork` + UI Fork button
- **H1**: Moodboard Translation — cosmic dark UI design brief
- **H2**: Design Token System — CSS variables + utility classes + brand logo
- **H3**: Shell Refactor — TopBar, LeftPanel, RightPanel, Dashboard wrapper
- **H4**: Interaction + Motion Layer (Mar 2026)
- **H5**: Login page full token alignment
- **H7**: Aurora Borealis Visual Engine (Mar 2026)
  - Replaced cosmic blob backgrounds with vertical light curtain/veil system
  - 4 keyframe animations: `em-aurora-sway`, `em-aurora-sway-reverse`, `em-aurora-breathe`, `em-aurora-rise`
  - 3 veil layers: cyan curtain, violet curtain, magenta+teal accent
  - Horizon glow + noise grain layers
  - Page variants: login (dramatic), dashboard (welcoming), focused (dark), review (energized)
  - Upgraded all glass panels: blur 20→44px, added inset glows, luminous edges, stronger saturation
  - Brand palette preserved: cyan, violet, magenta primary — teal only as subtle atmosphere

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Shell (H3) + Aurora bg
- `/app/components/dashboard/LeftPanel.jsx` — Messages with motion
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora bg (focused variant)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora bg (dramatic variant)
- `/app/components/dashboard/TopBar.jsx` — Shell (H3)
- `/app/components/dashboard/DiffReviewPanel.jsx` — Diff with glow lines
- `/app/components/dashboard/PlanCard.jsx` — Plan with entrance anim

## Design Rules
- NO Tailwind grays, NO flat backgrounds, NO hard borders, NO box-shadow for depth
- Always use `--em-` variables and `.em-glass`/`.em-aurora` utility classes
- Glass panels: blur 40-50px, saturate 1.4-1.6, inset highlights, luminous edges
- Aurora veils: vertical linear-gradient strips with sway+breathe animation
