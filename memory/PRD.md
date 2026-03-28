# Emanator — AI Self-Builder

## Problem Statement
Import GitHub repo, run the Next.js AI builder, harden (A-G), implement design system (H).

## Architecture
- Next.js 14 App Router (port 3000, supervisor: `nextjs_api`)
- FastAPI reverse proxy (port 8001 -> 3000)
- Supabase (Postgres + RLS)

## Completed Phases
- **A-G5**: Plan validation, Workspaces, Memory, Routing, Multi-Pass, Self-Critique, Autonomous Execution
- **G6**: Session Forking
- **H1-H5**: Moodboard, Token System, Shell Refactor, Motion Layer, Login alignment
- **H10**: Aurora Borealis — Sky-Dome Crown (top-origin perspective, radial ribbons, skewX wave)
- **Glass H7.1**: Premium glass — clear glass, no purple tint, neutral cool tone
- **Project Bin Rebuild**: Hero prompt, mode toggles, floating glass cards on aurora, credits/import UI
- **Visual Correction Pass** (Mar 2026):
  - Login panel: clear glossy glass (bg opacity 0.52, neutral fill, white specular)
  - TopBar: PNG logo only, removed gradient text
  - Project cards: highly transparent glass (bg opacity 0.28-0.34), stronger top highlight
  - All glass: shifted from purple-tinted to neutral cool, white+cyan specular edges

## Design Rules
- Glass: bg `rgba(14,18,32, 0.28-0.34)`, blur 48px, saturate 1.4, brightness 1.12
- Borders: `rgba(255,255,255, 0.07-0.08)` — NO purple tint
- Specular: `rgba(255,255,255, 0.16)` top inset + white-to-cyan gradient line
- Aurora: TOP-ORIGIN dome, radial ribbon streaks, skewX wave, teal-to-purple
- Background: dark navy #0C1018
- Headlines: 24 inspirational lines, random on load (inlined in Dashboard.jsx)

## Key Files
- `/app/app/globals.css` — Token system + Aurora engine + Glass system
- `/app/components/dashboard/Dashboard.jsx` — Project Bin + hero + headlines + modals
- `/app/components/dashboard/TopBar.jsx` — Logo, credits, import, search, user menu
- `/app/components/auth/LoginPage.jsx` — Login + clear glass + aurora

## Backlog
- P1: H6 — ChatComposer, ModelSelector, SearchPanel token pass
- P1: Credits backend integration
- P1: Import Project ingestion logic
- P2: Refactor `lib/ai/service.js`
