# Emanator PRD — Self-Sufficient Agent Platform

## How Emanator Works (Like E1)
1. User talks → Emanator reads files → edits with search_replace → changes are LIVE immediately
2. No "Apply to Live" button — edits go directly to disk + DB
3. search_replace is the PRIMARY edit tool (exact string matching — safest method)
4. edit_lines is the FALLBACK for large structural changes
5. Auto-snapshot before every edit (/app/.emanator-backups/)
6. Auto-verify after every edit (page request to force recompilation)
7. If build breaks → auto-revert → user sees "retrying..." → AI retries
8. tool_choice: required for action requests

## Tools
- search_replace: EXACT string matching (primary — 8 unit tests passing)
- edit_lines: line-number based (fallback — 22 unit tests passing)
- read_files, verify_build, exec_command, screenshot_verify, update_memory, update_canvas, patch_files

## Tech Stack
Next.js 14, OpenAI GPT-4o via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe

## Completed (Phase 1-5)
- E2B Sandbox integration
- while(true) agent loop (max 12 iterations)
- search_replace + edit_lines tools
- Auto-verify compilation after edits
- Auto-revert/retry self-recovery
- Instant-Live editing (no "Apply to Live")
- Dashboard.jsx partial refactor (3333→~2000 lines)
- message-stream.js helpers extracted to message-helpers.js
- CSV Export, classifyUserIntent, Zip Export
- Multi-model routing, Vision support
- tool_choice: required enforcement for all action intents
- Broken promise detector for both self-edit and normal project mode
- Fixed canvasUpdated scoping bug (2026-04-16)

## P1 Backlog
- Dashboard.jsx: extract ~800 lines of sandbox/media ops into hooks
- message-stream.js: decouple tool handlers from agent loop

## P2 Backlog
- Additional search_replace robustness
