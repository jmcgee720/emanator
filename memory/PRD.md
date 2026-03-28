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
  - 5 keyframe animations: `em-aurora-fold-1/2/3` (organic folding with scaleX+skew), `em-aurora-breathe` (asymmetric opacity), `em-aurora-undulate` (vertical)
  - `em-aurora-filament-drift` for texture micro-motion
  - Filament textures via repeating-linear-gradient inside each veil
  - 3 veil layers: cyan curtain, violet curtain, magenta+teal accent — each with primary+secondary filament strips
  - Horizon glow (dual radial) + noise grain
  - Page variants: login (dramatic/vivid), dashboard (welcoming), focused (dark), review (energized)
- **H7.1**: Premium Glass Refinement (Mar 2026)
  - Specular highlights: 2px top-edge with color refraction (cyan→violet→magenta gradient)
  - Inner reflection: bright cyan-to-violet refraction shift, 100px depth
  - Glass panels: blur 48px, saturate 1.6, brightness 1.05
  - Depth: darker void (#030316), stronger box-shadow (100px outer), inset glows
  - Color refraction on all edge treatments (sidebar, topbar, panel)

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Shell + Aurora bg (dashboard variant)
- `/app/components/dashboard/LeftPanel.jsx` — Messages with motion
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora bg (focused variant)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora bg (dramatic variant)
- `/app/components/dashboard/TopBar.jsx` — Shell (H3)

## Design Rules
- NO Tailwind grays, NO flat backgrounds, NO hard borders, NO box-shadow for depth
- Always use `--em-` variables and `.em-glass`/`.em-aurora` utility classes
- Glass panels: blur 44-54px, saturate 1.5-1.7, brightness 1.04-1.06, inset highlights 0.08-0.12 white
- Aurora veils: repeating-linear-gradient filaments + linear-gradient curtain, fold+breathe animations
- Specular edges: 2px with cyan→violet→magenta color refraction
