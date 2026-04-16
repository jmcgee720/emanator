# Emanator PRD — Self-Sufficient Agent Platform

## How Emanator Works (Like E1)
1. User talks → Emanator reads files → edits with search_replace → changes are LIVE immediately
2. No "Apply to Live" — edits go directly to disk + DB
3. search_replace PRIMARY, edit_lines FALLBACK
4. Auto-snapshot, auto-verify, auto-revert/retry
5. tool_choice: required for action requests

## Preview Rendering System
- Always recompiles from current files (snapshot cache disabled — was causing stale bugs)
- Pre-registers all component names as lazy wrappers before compilation
- Lazy wrappers return `null` when component not found (no ugly error messages)
- SVG `ReactComponent` imports → placeholder icon stubs
- CSS/asset imports → silently handled (no side effects)
- Two-pass Babel compilation for cross-file import resolution

## Completed (This Session)
1. Fixed canvasUpdated scoping crash
2. Fixed resolveTaskMode → 'build' default (was 'inspect')
3. Tightened INSPECT_MODE_PATTERNS + READ_ONLY_PATTERNS
4. Rewrote self-edit system prompt — clear tool hierarchy
5. Fixed all read_files outputs → recommend search_replace
6. Preview: lazy wrapper pre-registration
7. Preview: null fallback (no [X not found] errors)
8. Preview: SVG/CSS/asset import handling
9. Preview: disabled snapshot cache (was serving stale HTML)
10. Dashboard.jsx: 3333→1690 lines (hooks extraction)

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines)

## P2 Backlog
- Additional search_replace robustness
- Re-enable preview snapshot cache with versioning
