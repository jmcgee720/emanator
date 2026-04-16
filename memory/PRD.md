# Emanator PRD — Self-Sufficient Agent Platform

## How Emanator Works (Like E1)
1. Creative Brief → FAST PATH → single-file build → preview renders immediately
2. search_replace PRIMARY, edit_lines FALLBACK for self-edit mode
3. Auto-snapshot, auto-verify, auto-revert/retry for self-edits

## Creative Brief Fast Path (NEW — 2026-04-16)
- Completely separate code path from the complex plan/validate/intent pipeline
- When `isBriefBuild` detected, skip ALL: plan validators, task mode gates, intent classifiers, request mode checks
- Focused system prompt → `tool_choice: create_files` → stream → save → done
- Single file architecture: `app/page.jsx` with ALL components inline
- No cross-file imports, no react-router, no React imports
- Provider method: `chatWithToolsStream` with tool_choice forced to create_files
- Live preview streaming via `tool_args_delta` → `preview_partial` events

## Completed (This Session)
1. canvasUpdated scoping crash
2. resolveTaskMode → 'build' default
3. Tightened INSPECT_MODE + READ_ONLY patterns
4. Rewrote self-edit system prompt
5. Fixed read_files outputs → recommend search_replace
6. Preview: lazy wrapper pre-registration + null fallback
7. Preview: SVG/CSS/asset import handling
8. Preview: disabled stale snapshot cache
9. Force tool_choice for build-question messages
10. Expanded broken promise detector
11. **Rewrote Creative Brief pipeline — complete fast-path bypass**
12. Dashboard.jsx hooks extraction (1911→1690 lines)

## P1 Backlog
- Creative Brief: brand name + specific brief details not fully reflected in output (prompt tuning)
- message-stream.js: extract tool dispatch handlers (~1200 lines)

## P2 Backlog
- search_replace robustness, snapshot cache with versioning
