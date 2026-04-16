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

## Tool Hierarchy
1. **search_replace** — PRIMARY. Exact string matching, safest.
2. **edit_lines** — FALLBACK. Line-number based.
3. **read_files** — Always before editing. Recommends search_replace.
4. **verify_build** — Auto-runs after edits.
5. **exec_command** — Shell commands.
6. **screenshot_verify** — Visual verification.
7. **update_memory** — Cross-conversation notes.
8. **update_canvas** — Only when user explicitly asks.

## Preview Rendering System
- Multi-file projects: pre-register all component names as lazy wrappers on window
- Lazy wrappers return `null` gracefully when component isn't found (no ugly errors)
- SVG imports: `{ ReactComponent as X }` → placeholder SVG icon stub
- CSS/asset imports: silently removed (no side effects in preview)
- Babel AST plugin transforms imports → lazy wrappers for cross-file resolution
- Two-pass compilation: first registers components, second fixes cross-file imports

## Intent Classification
- `resolveTaskMode()` defaults to 'build' (not 'inspect')
- INSPECT_MODE_PATTERNS: only match action verbs at sentence start or after "can you"
- READ_ONLY_PATTERNS: similarly tightened

## Tech Stack
Next.js 14, OpenAI GPT-4o via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe

## Completed
- E2B Sandbox integration, while(true) agent loop (max 12)
- search_replace + edit_lines tools, auto-verify/revert/retry
- Instant-Live editing, CSV/Zip Export, Multi-model routing, Vision
- tool_choice: required, broken promise detector
- Fixed canvasUpdated scoping (2026-04-16)
- Rewritten system prompt, clear tool hierarchy (2026-04-16)
- Fixed resolveTaskMode → 'build' default (2026-04-16)
- Tightened INSPECT_MODE + READ_ONLY patterns (2026-04-16)
- Preview: lazy wrapper pre-registration + null fallback (2026-04-16)
- Preview: SVG/CSS/asset import handling (2026-04-16)
- Dashboard.jsx: 3333→1690 lines (useSandboxOps + useMediaBin)

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines)

## P2 Backlog
- Additional search_replace robustness
