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
- **H10 REBUILT** (Mar 2026): Aurora Borealis — Sky-Dome Crown
  - top-origin perspective, radial ribbon streaks, skewX wave deformation
  - 6-layer depth, teal-to-purple two-zone color, dark navy #0C1018
- **Glass H7.1**: Premium glass — 1px specular edges, blur 48px, saturate 1.6
- **Project Bin Rebuild** (Mar 2026):
  - Removed outer container panel — cards float directly on aurora
  - Dynamic headline system (24 inspirational lines, random on load)
  - Builder-first hero: prompt input + mode toggles (Full Stack / Mobile / Landing)
  - TopBar: Credits display (211.73) + Buy Credits button + Import Project button
  - Credits modal: balance, usage info, purchase tiers (100/500/1000)
  - Import modal: Upload File, Import from Zip, Connect Repository
  - All UI-only (no backend logic yet)

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P1: Credits backend integration
- P1: Import Project ingestion logic
- P2: Refactor `lib/ai/service.js`

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/lib/constants/headlines.js` — 24 dynamic inspirational headlines
- `/app/components/dashboard/Dashboard.jsx` — Project Bin + hero + modals
- `/app/components/dashboard/TopBar.jsx` — Credits, Import, Search, User menu
- `/app/components/dashboard/RightPanel.jsx` — Shell + Aurora (focused variant)
- `/app/components/auth/LoginPage.jsx` — Login + Aurora (cinematic variant)

## Design Rules
- Aurora: TOP-ORIGIN perspective dome, radial ribbon streaks, skewX wave motion
- Glass: blur 44-54px, saturate 1.5-1.7, 1px crisp specular edges
- Background: dark navy #0C1018
- No outer container panels on project grid — cards float on aurora
- Motion: ease-in-out, perspective-aware keyframes
