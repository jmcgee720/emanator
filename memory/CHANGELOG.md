# Changelog

## 2026-02 (Previous Sessions)
- Dashboard UI anomalies fixed, service.js Phase 2 refactoring
- Site Monitor, Deploy Tab, Share Preview, Project Templates, OOM fix
- Testing: iterations 57-60, all passed

## 2026-02 - Feature Batch 1 (Previous Fork)
- Template Marketplace, Share Link Expiry, Deployment Status Polling, Cron-based Auto-Crawl
- Testing: iteration 61, 8/8 passed

## 2026-02 - Feature Batch 2 (Current)
### 25 Project Templates
- Replaced 5 basic templates with 25 production-ready templates with real React code
- Categories: Marketing (5), Business (5), Personal (5), Content (5), Commerce (5)
- Each template renders a complete, interactive page (not placeholder)
- Fixed critical template literal `${}` escaping bug (caught by testing agent)

### Template Category Filter
- NewProjectModal now has category filter buttons (all/Marketing/Business/Personal/Content/Commerce)
- Grid layout updated to 4 columns with scrollable area for 25+ templates

### Template Flow Fix
- Fixed bug where `createProject` called `setFiles([])` after template creation
- Now fetches populated files from backend via API after template project is created

### Marketplace Ratings & Reviews
- POST /api/marketplace/:id/reviews - Add star rating (1-5) + text comment
- GET /api/marketplace/:id/reviews - Get all reviews for a template
- Reviews stored in snapshot metadata with avg_rating and review_count
- Users can only submit one review per template (edit replaces existing)
- Star ratings displayed on marketplace template cards

### Testing: iteration 62 - 13/13 backend tests passed (100%)


## 2026-04-11 - Core System Self-Improvement Phase 1
### Self-Edit Targets Expansion
- Added 3 new self-edit targets to `SELF_EDIT_TARGETS` in `constants.js`:
  - Prompt Builder (`lib/ai/prompt-builder.js`) - Design recipes & code patterns
  - Design System (`lib/ai/design-system.js`) - Color tokens, layout rules
  - Image Generator (`lib/ai/image-prefetch.js`) - Art direction & vibe lexicon
- All 3 targets verified in Core System dropdown UI
- Backend `message-stream.js` path-scoped validation confirmed working
- **Bug fix**: Self-edit requests were rejected by task mode enforcement ("I couldn't complete that request"). Fixed by skipping `validateTaskMode` for self-edit chats in `message-stream.js` (line 1015-1016) and always sending `selfEditTarget` from `Dashboard.jsx` even when "All Core System" is selected.
