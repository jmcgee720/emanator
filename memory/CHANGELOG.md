# Changelog


## 2026-02-XX - Phase 4 Image Fallback Chain (Current Fork)
### Image generation no longer depends on Gemini billing tier
- **Phase 4 fallback chain**: Gemini Nano Banana → OpenAI gpt-image-1 → subject-aware stock
- When Gemini fails (Free tier, quota, outage), OpenAI gpt-image-1 takes over using existing OPENAI_API_KEY — no user action needed
- Subject-aware stock picker scores candidates against per-image manifest subject keywords; coffee-shop briefs no longer return pizza/salad photos
- Expanded food stock library with 8 coffee/cafe/bar/bistro photos
- BuildWizard UI shows breakdown: "Gemini N · OpenAI fallback M · Stock K"
- /api/build/ping-nano-banana now probes BOTH providers and returns unified status
- Tests: tests/test-phase4-fallback.test.mjs (4/4 passing — verifies all fallback paths)
- Local commits ready to push: `3db628b`, `d62242e` (awaiting GitHub PAT)

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
- **Context grounding**: Added self-edit file injection in `message-stream.js` — reads the target file from disk and injects full content + strict rules into the AI system message. The AI now correctly targets the existing file instead of creating disconnected standalone files.

## 2026-02-03 — GitHub Sync Unblocked + Auroraly Rebrand Pushed
- Emergent's "Save to Github" button was failing silently for ~16 commits.
- Used a temporary GitHub PAT to set `origin` and rebase 21 local commits onto `origin/main` (which had legacy folder deletions + `.vercelignore` from GitHub Web Editor edits).
- Conflict resolution: preferred local changes for the 5 shared files (README.md, app/api/[[...path]]/route.js, app/api/debug/mongo/route.js, lib/ai/message-stream.js, lib/api/routes/live-promote.js) — the remote edits were trivial author-bypass commits.
- Pushed `6294e3e..befc1a7` to `main`. Token revoked, remote URL sanitized.
- All Auroraly rebrand artifacts now live on GitHub: SVG/PNG logo, login UI tightening, Aurora MongoDB persistence, locked default Aurora layout, Aetherly Studio footer.

## 2026-05-03 — auroraly.co LIVE + AI Builder Quality Fixes (9 commits)
Domain: **auroraly.co is live on Vercel Pro.** DNS + Supabase Site URL + env vars all swapped.

### Commit train pushed today
- `b5f6d9a` — raise `maxDuration` 60→300s (Vercel Pro unlocks it)
- `d369c6a` — `imageAttachments is not defined` planner crash fix + guard non-image providers
- `6ffe650` — scaffold `max_tokens` 8192→16384 + better wave-failure diagnostics
- `b5fddd0` — OpenAI reasoning models (gpt-5.x, o-series) use `max_completion_tokens`, no `temperature`
- `8ed5064` — fresh-project routing to new pipeline + brief-driven design + tool-call retry + real error messages
- `8210acc` — default new projects to Claude Sonnet 4.5 (best tool-caller available)
- `fc2f8b2` — TDZ fix: removed `effectiveScope` reference before declaration (was breaking every build)
- `e710453` — regression test guarding against TDZ bugs in message-stream.js
- `9e6da7f` — derive brandName + projectDesc from short chat messages (no more "My App" defaults)
- `b8170eb` — stronger visual-excellence prompts (mandatory hero imagery, 2-font pairing, concrete subject imagery, 300-line floor)

### Upgrades / config
- Vercel plan: **Hobby → Pro** ($20/mo). Lifts function timeout, enables collaborator commits.
- Supabase Site URL swapped: `emanatorapp.com` → `www.auroraly.co`
- Creative Brief pipeline confirmed working end-to-end: "Cozy Coffee" produced real coffee copy (8 routes, 16 files, 293s run).

### Known outstanding
- **Chat-only short prompts** ("landing page for coffee shop" typed directly in chat) need commit `9e6da7f` verified after user retests. Fix derives brand from "for a ___" clause.
- **Visual quality** still to be validated post `b8170eb` — next user test will tell us if the stronger prompt produces designer-quality output.
- Old zombie projects ("Nexsara", "Koffee Krazy", etc.) still hold stale error messages — expected, they were built under bugged code.

