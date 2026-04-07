# Changelog

## 2026-04-07 (Session 2)
- Implemented real Deploy functionality:
  - Backend: GET /projects/:id/download (returns files for client-side ZIP), POST /projects/:id/deploy/vercel (Vercel API v13 deploy), GET /projects/:id/deployments (history)
  - Frontend: Redesigned DeployTab with glassmorphism styling, Download ZIP (JSZip + FileSaver), Vercel deploy with token input, deployment history
  - DB: Added deployments.create and deployments.findByProjectId to Supabase db helper
- Added "Check All Monitors" bulk action button in Growth Panel sidebar
- Testing: All tests passed (iteration 58, 100% backend 5/5, 100% frontend)

## 2026-04-07 (Session 1)
- Fixed 3 Dashboard UI anomalies: removed green "Self-Builder Active" badge, removed broken "x" tab bar row, restyled "Projects | New Project" navigation as pill button tabs
- Completed Phase 2 service.js refactoring: extracted processMessageStream (1758 lines) → message-stream.js, executePlanStream + applyDiffs → plan-executor.js, processMessage → message-processor.js. service.js reduced from 2627 to 318 lines
- Implemented Site Monitor feature in Growth Panel (backend CRUD + frontend tabs, detail view, change detection, counter-moves)
- Testing: All tests passed (iteration 57, 100% backend 11/11, 100% frontend)

## Previous Sessions
- Live streaming preview pipeline, Babel fix, Preview skeleton loading state
- Regression guardrails, AI Art Director, Creative Brief Cards, Suggestion Chips
- Growth Panel: CSV export, SEO fixes, Build Better Version, Persona analysis, Batch crawl
- Visual Quality Prompt Overhaul, Glassmorphism UI redesign
- service.js Phase 1 refactor (canvas-ops, context-loader, file-operations, image-generation, prompt-builder)
