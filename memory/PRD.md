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
  - Login panel: see-through frosted glass (bg rgba 0.04-0.08 white tint, blur 32px, bright edge shimmers, diagonal refraction gradient)
  - TopBar: PNG logo only, removed gradient text
  - Project cards: crisp glossy glass matching global `.em-glass` class
  - All glass: shifted from ghosted/transparent to solid/crisp, neutral cool
- **Text Crispness Pass** (Mar 2026):
  - Primary text: `#FFFFFF` (true white, was `#F0F0F8`)
  - Secondary text: `#C0C4D8` (bright off-white, was `#8888AA` — ghosted)
  - Muted text: `#8A8EA6` (visible gray, was `#555577` — near-invisible)
  - All login inline colors updated to match token brightness
  - Shadcn muted-foreground boosted to 62% lightness (was 48%)

## Design Rules
- Glass: bg `rgba(14,18,34, 0.90-0.94)`, blur 48px, saturate 1.7, brightness 1.12 — CRISP/GLOSSY, NOT ghosted
- Headlines: 24 inspirational lines, random on load (inlined in Dashboard.jsx)
- Core System button: teal/cyan style (border + text var(--em-cyan)), NOT yellow/amber
- Borders: `rgba(255,255,255, 0.13)` — neutral cool, visible edge
- Specular: `rgba(255,255,255, 0.22)` top inset + white-to-cyan gradient line (0.28 peak)
- Aurora: TOP-ORIGIN dome, radial ribbon streaks, skewX wave, teal-to-purple
- Background: dark navy #0C1018
- Text Primary: `#FFFFFF` (crisp white), Secondary: `#C0C4D8`, Muted: `#8A8EA6` — ALL text must feel alive, NOT ghosted

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
