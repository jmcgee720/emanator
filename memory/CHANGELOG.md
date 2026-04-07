# Changelog

## 2026-04-07 (Session 3)
- Implemented Share Public Preview Link feature:
  - Backend: POST /projects/:id/share (snapshot files), GET /projects/:id/shares (list), DELETE /projects/:id/share/:id (revoke), GET /shared/:token (public, no auth)
  - Frontend: Share button in RightPanel toolbar with copy-to-clipboard
  - Public preview page at /share/:token with iframe rendering, code view toggle, view counter, "Build Your Own" CTA
  - Storage: Uses existing `snapshots` table with `__share__` prefix (no new table needed)
- Testing: All tests passed (iteration 59, 100% backend 10/10, 100% frontend)

## 2026-04-07 (Session 2)
- Implemented real Deploy functionality (Download ZIP via JSZip, Vercel deploy with token, deployment history)
- Added "Check All Monitors" bulk action button in Growth Panel
- Testing: All tests passed (iteration 58)

## 2026-04-07 (Session 1)
- Fixed 3 Dashboard UI anomalies (Self-Builder badge, broken tab bar, pill-style navigation)
- Completed service.js Phase 2 refactoring (2627 → 318 lines)
- Implemented Site Monitor feature (backend CRUD + frontend tabs, detail view, change detection, counter-moves)
- Testing: All tests passed (iteration 57)

## Previous Sessions
- Live streaming preview pipeline, Babel fix, Preview skeleton loading state
- Regression guardrails, AI Art Director, Creative Brief Cards, Suggestion Chips
- Growth Panel: CSV export, SEO fixes, Build Better Version, Persona analysis, Batch crawl
- Visual Quality Prompt Overhaul, Glassmorphism UI redesign
- service.js Phase 1 refactor (canvas-ops, context-loader, file-operations, image-generation, prompt-builder)
