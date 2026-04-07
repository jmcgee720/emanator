# Changelog

## 2026-04-07
- Fixed 3 Dashboard UI anomalies: removed green "Self-Builder Active" badge, removed broken "x" tab bar row, restyled "Projects | New Project" navigation as pill button tabs
- Completed Phase 2 service.js refactoring: extracted processMessageStream (1758 lines) → message-stream.js, executePlanStream + applyDiffs → plan-executor.js, processMessage → message-processor.js. service.js reduced from 2627 to 318 lines
- Implemented Site Monitor feature in Growth Panel:
  - Backend: monitorDb CRUD in growth/service.js, API routes (GET/POST /growth/monitors, POST /growth/monitors/:id/check, DELETE /growth/monitors/:id)
  - Frontend: Pages/Monitors tab toggle in sidebar, monitor list with change indicators, "Monitor" button on page detail, monitor detail view with detected changes and counter-move suggestions
- Testing: All tests passed (iteration 57, 100% backend 11/11, 100% frontend)

## Previous Sessions
- Live streaming preview pipeline, Babel fix, Preview skeleton loading state
- Regression guardrails, AI Art Director, Creative Brief Cards, Suggestion Chips
- Growth Panel: CSV export, SEO fixes, Build Better Version, Persona analysis, Batch crawl
- Visual Quality Prompt Overhaul, Glassmorphism UI redesign
- service.js Phase 1 refactor (canvas-ops, context-loader, file-operations, image-generation, prompt-builder)
