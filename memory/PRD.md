# Emanator PRD — Self-Sufficient Agent Platform

## How Emanator Works (Like E1)
1. User talks → Emanator reads files → edits with search_replace → changes are LIVE immediately
2. No "Apply to Live" — edits go directly to disk + DB
3. search_replace PRIMARY, edit_lines FALLBACK
4. Auto-snapshot, auto-verify, auto-revert/retry
5. tool_choice: required for action AND build-question requests
6. Broken promise detector catches "Building your project..." and retries

## Completed (This Session — 11 fixes)
1. canvasUpdated scoping crash
2. resolveTaskMode → 'build' default (was 'inspect')
3. Tightened INSPECT_MODE_PATTERNS + READ_ONLY_PATTERNS
4. Rewrote self-edit system prompt — clear tool hierarchy
5. Fixed all read_files outputs → recommend search_replace
6. Preview: lazy wrapper pre-registration
7. Preview: null fallback (no [X not found] errors)
8. Preview: SVG/CSS/asset import handling
9. Preview: disabled stale snapshot cache
10. Force tool_choice for build-question messages ("did you build it?")
11. Expanded broken promise detector ("Building your/all", "creating now")
+ Dashboard.jsx: 3333→1690 lines (hooks extraction)

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines)

## P2 Backlog
- search_replace robustness
- Re-enable preview snapshot cache with versioning
