# Emanator PRD

## Original Problem Statement
Build a self-editing AI builder (Emanator) that can reliably modify its own core files using targeted patches instead of destructive full-file rewrites. Make the regular project builder as capable as the Core System.

## Core Architecture
- Next.js 14 App Router conversational AI builder
- Self-edit pipeline: reads file → applies patches → saves → Apply to Live → health check → auto-revert on failure
- Tools: `patch_files` (small files), `update_files` (large files/fallback), `update_canvas` (checklist)
- Safety: syntax validation + bracket balance + import validation + auto-revert + zero-apply save prevention

## What's Been Implemented

### Phase 1-5: Self-Edit Pipeline (COMPLETE)
- patch_files with 3-level fuzzy matching, silent retry, export validation

### Core Canvas PM Portal (COMPLETE)
- Markdown editor, interactive checkboxes, auto-save, AI auto-updates

### Broken Promise + Stalling Detector (COMPLETE)
- Catches action promises AND stalling questions
- Works for both Core System and regular projects

### Smart File Context Injection (COMPLETE)
- Auto-identifies target files from user message (3 strategies)
- Loads actual file content into AI context before response
- Works for both Core System (disk files) and regular projects (DB files)

### Stream Timeout Auto-Recovery (COMPLETE)
- Real keepalive SSE events, auto-recovery from DB

### Auth Resilience (COMPLETE)
- navigator.locks patch, timeouts, "Service Unavailable" toast

### Auto-Revert Self-Healing (COMPLETE)
- AI explains + retries after auto-revert, works for ALL project types

### AI Conversation Memory (COMPLETE)
- Silent messages save full_content in metadata for AI context
- Conversational overrides prevent misclassification

### Zero-Apply Save Prevention (COMPLETE - Apr 14)
- When ALL patches fail (0/N applied), file is NOT saved
- Fixed control flow bug where retry block consumed the condition, making the save-block branch unreachable
- Save blocked in BOTH the retry path AND the fallback path

### patch_files → update_files Fallback (COMPLETE - Apr 14)
- When all patches fail on a self-edit, automatically retries with update_files (full file replacement)
- AI gets the current file content and is told to provide the complete updated file
- update_files now available in Core System tool set alongside patch_files
- System prompt tells AI to use update_files for files > 500 lines
- File size shown in target description (e.g., "3525 lines (LARGE FILE — use update_files)")

### Level 3 Fuzzy Patch Matching (COMPLETE)
- Normalizes whitespace for comparison as third-level fallback

### Action Enforcement Prompt (COMPLETE)
- For detailed user requests (100+ chars), system prompt enforces immediate action

## Known Issues
- Dashboard.jsx is 3525 lines — should be refactored into smaller components for better AI patchability
- Supabase free tier may pause after inactivity

## Remaining Backlog
- [ ] Refactor Dashboard.jsx into smaller components (ProjectGrid, ChatPanel, etc.)
- [ ] CSV export option (Emanator to self-implement)
- [ ] Conversational AI phases 2-5 (classifyUserIntent)
- [ ] Deploy integration (/api/projects/:id/export-zip)
- [ ] Vision support for Core System chat
- [ ] Refactor message-stream.js (~3000 lines) and service.js (~2600 lines)

## Tech Stack
- Next.js 14 App Router, OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth), MongoDB (credits), Stripe (payments)
- Tailwind CSS + Shadcn UI
