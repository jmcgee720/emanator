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
- **H7-H8**: Aurora iterations (superseded by H9)
- **H9**: Aurora Borealis — 6-Layer Depth System (Mar 2026)
  - 6 veil divs: 2 far + 2 mid + 2 near
  - FAR (veil-1,2): blur 36-44px, 48-60s cycles, atmospheric washes
  - MID (veil-3,4): blur 14-20px, 30-38s cycles, main curtain-fold ribbons (7 folds each)
  - NEAR (veil-5,6): blur 6-12px, 24-30s cycles, sharp bright detail curtains
  - 5 keyframes: em-au-far, mid-a, mid-b, near-a, near-b (+ pulse)
  - CSS custom properties: --r (rotation), --lo/--hi (pulse range)
  - mix-blend-mode: screen on all veils
  - ~50 individual curtain fold radial-gradients across all layers
  - Non-uniform border-radius for organic contour
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
- Aurora: elliptical radial-gradient curtain folds, 3 depth tiers, mix-blend-mode: screen
- Glass: blur 44-54px, saturate 1.5-1.7, 1px crisp specular edges
- Motion: ease-in-out only, per-layer speed variation, CSS custom property rotation
