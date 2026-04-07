# Changelog

## 2026-04-07 (Session 4)
- Implemented Project Templates gallery (5 starters: Landing Page, Portfolio, SaaS Dashboard, Blog, E-Commerce)
  - Backend: GET /templates listing, project creation with template_id auto-populates files
  - Frontend: New Project modal redesigned with 6-card template gallery (Blank + 5 templates)
- Implemented Netlify deploy integration
  - Backend: POST /projects/:id/deploy/netlify with JSZip packaging and Netlify API v1
  - Frontend: 3-column Deploy tab grid with Netlify card, token input, deploy button
- Implemented Scheduled Auto-Crawl batch endpoint (POST /growth/monitors/check-all)
- Fixed OOM memory thrashing
  - Increased NODE_OPTIONS max-old-space-size from 512MB to 2048MB
  - Enabled webpack filesystem cache in next.config.js
  - Optimized watch polling interval and ignored directories
- Fixed `toolArgsAccum` scoping bug in message-stream.js from Phase 2 refactoring
- Testing: All tests passed (iteration 60, 100% backend 11/11, 100% frontend)

## 2026-04-07 (Session 3)
- Share Public Preview Link (backend API + /share/:token public page)
- Testing: iteration 59, 100% passed

## 2026-04-07 (Session 2)
- Real Deploy Tab (Download ZIP, Vercel deploy, deployment history)
- Check All Monitors bulk action
- Testing: iteration 58, 100% passed

## 2026-04-07 (Session 1)
- Dashboard UI fixes (badge, tab bar, pill navigation)
- service.js Phase 2 refactoring (2627 → 318 lines)
- Site Monitor feature (CRUD + change detection + counter-moves)
- Testing: iteration 57, 100% passed
