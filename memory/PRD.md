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

## Intent Classification (Fixed 2026-04-16)
- `resolveTaskMode()` defaults to 'build' (was 'inspect' — blocked legitimate requests)
- `detectTaskMode()` gates inspect mode at the start of the stream
- INSPECT_MODE_PATTERNS tightened — bare words like 'analyze', 'search', 'review' no longer trigger inspect when they're app feature descriptions
- READ_ONLY_PATTERNS similarly tightened

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
├── lib/e2b/agent-tools.js         # search_replace, edit_lines, read_files implementations
├── components/dashboard/
│   ├── Dashboard.jsx              # Main workspace (~1690 lines)
│   ├── useDashboardProject.js     # Project CRUD hook
│   ├── useDashboardStream.js      # Streaming/plan/diff hook
│   ├── useSandboxOps.js           # Sandbox operations hook
│   ├── useMediaBin.js             # Media bin operations hook
│   ├── InlineBrief.jsx            # Creative Brief form
│   └── ProjectGrid.jsx            # UI for project management
```

## Completed (All Phases)
- E2B Sandbox integration
- while(true) agent loop (max 12 iterations)
- search_replace + edit_lines tools
- Auto-verify compilation after edits
- Auto-revert/retry self-recovery
- Instant-Live editing (no "Apply to Live")
- Dashboard.jsx refactoring (3333→1690 lines)
- message-stream.js helpers extracted
- CSV Export, classifyUserIntent, Zip Export
- Multi-model routing, Vision support
- tool_choice: required enforcement
- Broken promise detector
- Fixed canvasUpdated scoping bug (2026-04-16)
- Rewrote self-edit system prompt — clear tool hierarchy (2026-04-16)
- Fixed all read_files outputs to recommend search_replace (2026-04-16)
- Fixed retry/recovery messages to push search_replace (2026-04-16)
- Extracted useSandboxOps.js + useMediaBin.js hooks (2026-04-16)
- Fixed resolveTaskMode defaulting to 'inspect' — now 'build' (2026-04-16)
- Tightened INSPECT_MODE_PATTERNS — no longer catches app feature words (2026-04-16)
- Tightened READ_ONLY_PATTERNS — same fix (2026-04-16)

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines) into separate module

## P2 Backlog
- Additional search_replace robustness
