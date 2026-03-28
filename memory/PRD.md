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
- **H7/H7.1/H7.2**: Aurora iterations (replaced by H8)
- **H8**: Aurora Borealis Visual Engine — Complete Rebuild (Mar 2026)
  - Rebuilt from scratch using curtain-fold ribbon shape language
  - Each aurora band: 5-7 tall narrow elliptical radial-gradient folds with bright cores
  - Organic contours via non-uniform border-radius
  - Arcing sweeps via CSS `rotate()` transforms with `--au-rot` custom properties
  - 3 drift keyframes with rotation variation + scaleX deformation
  - `mix-blend-mode: screen` for natural overlap brightening
  - 6 distinct aurora formations (2 per veil: primary cluster + secondary thread)
  - ~30 individual curtain folds total across all formations
  - Page variants: login (cinematic, 8px blur), dashboard (balanced), focused (dimmed), review (energized)
- **Glass H7.1**: Premium glass system intact from previous iteration
  - 1px crisp specular edges with color refraction
  - blur 48px, saturate 1.6, brightness 1.05

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Shell + Aurora bg (dashboard variant)
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora bg (focused variant)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora bg (login variant)

## Design Rules
- NO Tailwind grays, NO flat backgrounds, NO hard borders
- Aurora: elliptical radial-gradient folds (NOT linear-gradient columns), mix-blend-mode: screen
- Glass: blur 44-54px, saturate 1.5-1.7, 1px crisp specular edges
- Motion: ease-in-out only, 28-50s drift cycles, rotation + scaleX deformation
