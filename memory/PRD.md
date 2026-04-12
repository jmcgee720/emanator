# Emanator PRD

## Original Problem Statement
Build a self-editing AI builder (Emanator) that can reliably modify its own core files using targeted patches instead of destructive full-file rewrites.

## Core Architecture
- Next.js 14 App Router conversational AI builder
- Self-edit pipeline: reads file → applies patches → saves → Apply to Live → health check → auto-revert on failure
- Tools: `patch_files` (code edits), `update_canvas` (checklist/notes)
- Safety: syntax validation + size guardrails + auto-revert on health check failure

## What's Been Implemented

### Phase 1: Patch Reliability (COMPLETE)
- `patch_files` tool with search/replace arrays
- Fuzzy whitespace matching
- Export validation
- Silent retry (up to 2x) with corrective context

### Phase 2-5: Self-Edit Improvements (COMPLETE)
- Silent validation retries
- Auto-reload after Apply to Live (require.cache clear + file touch)
- Enhanced diff view (dual line numbers, collapsed unchanged regions)
- Intent detection fix (request_router import)

### Core Canvas — PM Portal (COMPLETE)
- Collaborative markdown editor replaces Preview for Core System
- Interactive checkboxes, auto-save, Edit/Preview toggle
- AI auto-updates "Recent Edits" after each edit
- Smart checklist: auto-checks matching items in Next Steps

### Conversational AI (COMPLETE)
- 3-tier intent detection (conversational/status/action)
- `[SYSTEM:` prefix for silent messages (no user bubble)
- AI reads user message before acting — obeys "do not implement"
- `replace_content` SSE event strips AI preamble for clean summaries

### Response Quality (COMPLETE)
- AI summary from `patch_files` tool's `summary` field
- Inline Apply to Live button in chat messages
- Silent post-apply follow-up ("What would you like to work on next?")
- Occasional enhancement suggestions (~30% frequency)

### Full Self-Modification (COMPLETE)
- ALL files unlocked: message-stream.js, service.js, Dashboard.jsx, API routes, tools, etc.
- 22 editable targets in the dropdown
- Post-write health check: auto-reverts from snapshot if app crashes
- Syntax validation blocks broken JS before writing to disk
- Auto-revert toast notification on frontend

### Patch History Timeline (COMPLETE)
- GET /projects/:id/patch-history returns pre-promote snapshots
- One-click restore from any snapshot
- History auto-refreshes after Apply to Live

### update_canvas Tool (COMPLETE)
- AI can directly edit the Project Canvas
- Canvas content injected into system prompt for context
- Handles old JSON → markdown migration

## Known Issues
- AI sometimes generates patches with wrong indentation (mitigated by fuzzy matching + retry)
- Preview tab shows SyntaxError for Node.js files (mitigated by auto-switch to Canvas)
- Large files (38K+) may hit proxy timeout (mitigated by 60s timeout safety net)

## Remaining Backlog
- [ ] CSV export option
- [ ] Conversational AI phases 2-5 (broader)
- [ ] Deploy integration (Vercel/Netlify) — currently mocked
- [ ] Refactor message-stream.js (~2600 lines) and service.js (~2600 lines)
- [ ] Vision support for Core System chat (image analysis)

## Tech Stack
- Next.js 14 App Router
- OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth)
- Tailwind CSS + Shadcn UI
