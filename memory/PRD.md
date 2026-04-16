# Emanator PRD — Self-Sufficient Agent Platform

## How Emanator Works (Like E1)
1. User talks → Emanator reads files → edits with search_replace → changes are LIVE
2. search_replace PRIMARY, edit_lines FALLBACK
3. Auto-snapshot, auto-verify, auto-revert/retry
4. Creative Brief → SINGLE FILE generation (app/page.jsx, all components inline)

## Creative Brief Architecture (CRITICAL)
- Generates ONE file: `app/page.jsx` with ALL components defined inline
- No cross-file imports (preview can't resolve them reliably)
- No react-router (use useState for page navigation)
- No React imports (preview runtime provides React globally)
- 600-1000 lines, Tailwind CSS only, dark theme by default
- Glassmorphism, gradient text, glass cards, glow effects

## Completed (This Session — 12 fixes)
1. canvasUpdated scoping crash
2. resolveTaskMode → 'build' default
3. Tightened INSPECT_MODE/READ_ONLY patterns
4. Rewrote self-edit system prompt
5. Fixed read_files outputs → recommend search_replace
6. Preview: lazy wrapper pre-registration
7. Preview: graceful null fallback (children pass-through)
8. Preview: SVG/CSS/asset import handling
9. Preview: disabled stale snapshot cache
10. Force tool_choice for build-question messages
11. Expanded broken promise detector
12. **Rewrote Creative Brief prompt → single-file architecture**

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines)

## P2 Backlog
- search_replace robustness, snapshot cache with versioning
