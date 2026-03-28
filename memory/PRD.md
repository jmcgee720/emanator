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
- **H1-H5**: Moodboard, Token System, Shell Refactor, Motion Layer, Login alignment
- **H7**: Aurora Borealis Visual Engine (Mar 2026)
  - Vertical light curtain/veil system with repeating-linear-gradient filament textures
  - 6 keyframe animations: 3 fold variants, breathe, undulate, filament-drift
  - 3 veil layers (cyan, violet, magenta+teal), each with primary+secondary filaments
  - Page variants: login (dramatic), dashboard (welcoming), focused (dark), review (energized)
- **H7.1**: Premium Glass Refinement (Mar 2026)
  - Specular highlights with cyan→violet→magenta color refraction
  - Glass panels: blur 48px, saturate 1.6, brightness 1.05
  - Deeper void (#030316), stronger depth separation
- **H7.2**: Final Visual Polish (Mar 2026)
  - Aurora: reduced blur (15px/10px primary/secondary) for clearer filament contrast
  - Tighter filament spacing, increased bright-stop opacity (+0.01-0.02)
  - Glass: specular edges tightened to 1px crisp (removed blur(0.5px))
  - Concentrated gradient stops, sharper transitions
  - Breathe keyframe smoothed (removed calc() midpoint, dual-peak curve)
  - Filament-drift keyframe: 3-stop ease-in-out curve (was 2-stop)

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Shell + Aurora bg (dashboard variant)
- `/app/components/dashboard/LeftPanel.jsx` — Messages with motion
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora bg (focused variant)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora bg (dramatic variant)

## Design Rules
- NO Tailwind grays, NO flat backgrounds, NO hard borders
- Always use `--em-` variables and `.em-glass`/`.em-aurora` utility classes
- Glass: blur 44-54px, saturate 1.5-1.7, brightness 1.04-1.06
- Aurora: repeating-linear-gradient filaments + linear-gradient curtain, fold+breathe animations
- Specular edges: 1px crisp (no blur), cyan→violet→magenta refraction
