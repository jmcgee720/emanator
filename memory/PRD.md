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
- **H10 REBUILT** (Mar 2026): Aurora Borealis — Sky-Dome Crown with 3D Perspective
  - **transform-origin: 50% 0%** (top) — ribbons fan DOWNWARD from sky dome apex
  - **rotateX(30-38deg)** with **perspective(1400-1800px)** — true 3D foreshortening
  - **border-radius: 0 0 55% 55% / 0 0 50% 50%** — dome arch curvature on bottom
  - **skewX wave animations** — horizontal sine-ripple deformation (em-au-wave, em-au-curtain, em-au-drift)
  - Radial gradient ribbon streaks with non-uniform widths and asymmetric positioning
  - Center dark void for dome depth illusion
  - Two-zone color: teal/cyan at bottom (#00D2DC), purple/magenta at top (#A846D8)
  - 6-layer depth: 2 far (blur 22-35px) + 2 mid (blur 6-14px) + 2 near (blur 3-6px)
  - Dark navy background #0C1018
  - Page variants: login (vivid), dashboard (balanced), focused (dimmed), review (energized)
- **Glass H7.1**: Premium glass — 1px specular edges, blur 48px, saturate 1.6

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Shell + Aurora (6 veils)
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora (4 veils, focused)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora (6 veils, cinematic)

## Design Rules
- Aurora: TOP-ORIGIN perspective dome, conic→radial hybrid ribbons, skewX wave motion
- Glass: blur 44-54px, saturate 1.5-1.7, 1px crisp specular edges
- Background: dark navy #0C1018
- Motion: ease-in-out, perspective-aware keyframes with rotateY + skewX components

## Technical Notes
- Conic gradients become invisible under strong perspective transforms (angular bands too thin after foreshortening). Solution: use radial-gradient streaks for ribbon visibility + top-origin perspective for dome shape.
- perspective() value must be > element_height * sin(rotateX_angle) to avoid behind-camera clipping.
