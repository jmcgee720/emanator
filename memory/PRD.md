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
- Fuzzy whitespace matching, export validation, silent retry (up to 2x)

### Phase 2-5: Self-Edit Improvements (COMPLETE)
- Silent validation retries, auto-reload after Apply to Live
- Enhanced diff view, intent detection fix

### Core Canvas — PM Portal (COMPLETE)
- Collaborative markdown editor, interactive checkboxes, auto-save

### Conversational AI (COMPLETE)
- 3-tier intent detection, `[SYSTEM:` prefix for silent messages

### Response Quality (COMPLETE)
- AI summary, inline Apply to Live button, silent post-apply follow-up

### Full Self-Modification (COMPLETE)
- 22 editable targets, post-write health check, syntax validation, auto-revert

### Patch History Timeline (COMPLETE)
- One-click restore from any snapshot

### update_canvas Tool (COMPLETE)
- AI can directly edit the Project Canvas

### Broken Promise Fix — "All Core System" Mode (COMPLETE - Apr 12 2026)
- `identifyTargetFile()` helper: 3-strategy file identification
- Pre-identification loads target file content into AI context upfront
- Broken promise retry with file injection

### Stream Timeout Auto-Recovery (COMPLETE - Apr 13 2026)
- Backend: Real `keepalive` SSE events every 8s
- Frontend: Auto-recovery fetches saved messages/files from DB (3 retries)

### Auth Resilience (COMPLETE - Apr 13 2026)
- Fixed `AbortError: The lock request is aborted` — global handler suppresses lock errors
- Added 15s timeout to sign-in to prevent infinite "Signing In..." hang
- Clean "Connection Timeout" toast when Supabase is slow/down
- AbortError retry: checks session validity after lock interruption

## Known Issues
- AI sometimes generates patches with wrong indentation (mitigated by fuzzy matching + retry)
- Supabase free tier may pause/slow down after inactivity

## Remaining Backlog
- [ ] CSV export option (Emanator should self-implement)
- [ ] Conversational AI phases 2-5 (classifyUserIntent)
- [ ] Deploy integration (/api/projects/:id/export-zip)
- [ ] Vision support for Core System chat
- [ ] Refactor message-stream.js (~2800 lines) and service.js (~2600 lines)

## Tech Stack
- Next.js 14 App Router
- OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth)
- Tailwind CSS + Shadcn UI
