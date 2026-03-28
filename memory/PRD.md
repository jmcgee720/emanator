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
- **H7-H9**: Aurora iterations (superseded by H10)
- **H10**: Aurora Borealis — Crown/Dome Formation (Mar 2026)
  - Crown/dome perspective: CSS `perspective()` + `rotateX()` on all aurora formations
  - Two-zone color: teal/cyan bottoms (#00CCD0) + purple/magenta tops (#9C32C8)
  - 10 ray pairs per main formation (teal component + purple component per ray)
  - 6-layer depth system: 2 far (blur 32-45px) + 2 mid (blur 8-24px) + 2 near (blur 2-10px)
  - Dark navy background (#0C1018) matching reference
  - 3 keyframes: em-au-drift, em-au-sway, em-au-glow
  - mix-blend-mode: screen on all veils
  - Page variants: login (cinematic), dashboard (balanced), focused (dimmed), review (energized)
- **Glass H7.1**: Premium glass system — 1px crisp specular edges, blur 48px, saturate 1.6

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Shell + Aurora (6 veils)
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora (4 veils, focused)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora (6 veils, cinematic)

## Design Rules
- Aurora: perspective dome with teal-bottom/purple-top ray pairs, mix-blend-mode: screen
- Glass: blur 44-54px, saturate 1.5-1.7, 1px crisp specular edges
- Background: dark navy #0C1018
- Motion: ease-in-out only, perspective-aware drift keyframes
