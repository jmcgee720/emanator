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

## Tool Hierarchy (clear, non-contradictory)
1. **search_replace** — PRIMARY. Exact string matching, safest editing method.
2. **edit_lines** — FALLBACK. Line-number based, for large structural changes.
3. **patch_files** — DEPRECATED. Use search_replace instead.
4. **read_files** — Always before editing. Output recommends search_replace.
5. **verify_build** — Auto-runs after edits.
6. **exec_command** — Shell commands.
7. **screenshot_verify** — Visual verification.
8. **update_memory** — Cross-conversation notes.
9. **update_canvas** — Only when user explicitly asks.

## Intent Classification
- `resolveTaskMode()` defaults to 'build' (not 'inspect')
- `detectTaskMode()` gates inspect mode at the start of the stream
- INSPECT_MODE_PATTERNS tightened — only matches action verbs at sentence start or after "can you"
- READ_ONLY_PATTERNS similarly tightened

## Preview Rendering
- Multi-file projects pre-register all component names as lazy wrappers on window
- Lazy wrappers defer lookup to render time when all components are available
- Babel AST plugin transforms imports to lazy wrappers for cross-file resolution
- Two-pass compilation: first pass registers components, second pass fixes cross-file imports

## Tech Stack
Next.js 14, OpenAI GPT-4o via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe

## Architecture
```
/app
├── lib/ai/message-stream.js       # Core Agent Loop (~3580 lines)
├── lib/ai/intents.js              # Intent classification + task mode detection
├── lib/ai/message-helpers.js      # Extracted stream helpers
├── lib/ai/tools.js                # AI tool definitions
├── lib/ai/prompt-builder.js       # System prompt templates
├── lib/ai/plan-validator.js       # Plan + task mode validation
├── lib/e2b/agent-tools.js         # search_replace, edit_lines, read_files
├── components/dashboard/
│   ├── Dashboard.jsx              # Main workspace (~1690 lines)
│   ├── useDashboardProject.js     # Project CRUD hook
│   ├── useDashboardStream.js      # Streaming/plan/diff hook
│   ├── useSandboxOps.js           # Sandbox operations hook
│   ├── useMediaBin.js             # Media bin operations hook
│   ├── InlineBrief.jsx            # Creative Brief form
│   ├── tabs/PreviewTab.jsx        # Preview renderer (~1470 lines)
│   └── ProjectGrid.jsx            # Project management
```

## Completed (All Phases + E1 Parity)
- E2B Sandbox integration
- while(true) agent loop (max 12 iterations)
- search_replace + edit_lines tools
- Auto-verify/revert/retry self-recovery
- Instant-Live editing (no "Apply to Live")
- CSV Export, classifyUserIntent, Zip Export
- Multi-model routing, Vision support
- tool_choice: required enforcement
- Broken promise detector
- Fixed canvasUpdated scoping bug (2026-04-16)
- Rewrote self-edit system prompt — clear tool hierarchy (2026-04-16)
- Fixed all read_files outputs to recommend search_replace (2026-04-16)
- Fixed resolveTaskMode defaulting to 'inspect' — now 'build' (2026-04-16)
- Tightened INSPECT_MODE_PATTERNS + READ_ONLY_PATTERNS (2026-04-16)
- Fixed preview rendering for multi-file projects — lazy wrapper pre-registration (2026-04-16)
- Extracted useSandboxOps.js + useMediaBin.js hooks (2026-04-16)
- Dashboard.jsx: 3333→1690 lines

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines) into separate module
  (Complex: each handler uses 15+ outer-scope variables from the generator function)

## P2 Backlog
- Additional search_replace robustness
