# Emanator PRD

## Original Problem Statement
Build a self-editing AI builder (Emanator) that can reliably modify its own core files and act as a multi-step agent — reading files, writing changes, verifying compilation, and self-debugging like a real engineer.

## Core Architecture
- Next.js 14 App Router conversational AI builder
- **Agent Loop**: AI can call tools sequentially (read → write → verify → fix) up to 6 iterations per turn
- Tools: `read_files`, `patch_files`, `update_files`, `verify_build`, `update_canvas`
- Safety: syntax validation + bracket balance + import validation + auto-revert + zero-apply save prevention

## What's Been Implemented

### Agent Loop (COMPLETE - Apr 14)
- `read_files` tool: AI reads 1-5 project files to understand codebase before editing
  - Works for both regular projects (from Supabase DB) and Core System (from disk)
  - 30K char limit per file, max 5 files per call
- `verify_build` tool: AI checks compilation after writing files
  - Hits /api/health endpoint, reads error logs if compilation fails
  - Returns clear success/failure message with error details
- Agent loop: After read_files or verify_build, tool result is fed back to AI as a tool response message, AI decides next action
- Max 6 iterations per turn (safety limit)
- System prompt teaches the workflow: read → write → verify → fix

### patch_files → update_files Fallback (COMPLETE - Apr 14)
- When all patches fail, automatically retries with update_files (full file replacement)
- Smart tool selection: AI told to use update_files for files >500 lines
- File size shown in target description (e.g., "3525 lines — LARGE FILE")
- update_files added to Core System tool set

### Zero-Apply Save Prevention (COMPLETE - Apr 14)
- Fixed control flow bug: retry block consumed the if-condition, making save-block unreachable
- Save now blocked in BOTH the retry path AND the fallback path
- `saveTool = '__blocked__'` prevents save pipeline from running

### Smart File Context Injection (COMPLETE)
- Auto-identifies target files from user message (3 strategies)
- Loads actual content into AI context before response

### Broken Promise + Stalling Detector (COMPLETE)
- Catches action promises AND stalling questions
- Forces tool_choice retry with file context

### All Previous Features (COMPLETE)
- Self-edit pipeline, Canvas PM portal, stream timeout recovery
- Auth resilience, auto-revert self-healing, conversation memory
- Import validation, bracket balance checks, Level 3 fuzzy matching
- Post-build auto-continue, action enforcement prompt

## Known Issues
- Dashboard.jsx is 3525 lines — should be refactored into smaller components
- message-stream.js is ~3100 lines — should be refactored

## Remaining Backlog
- [ ] Refactor Dashboard.jsx into smaller components
- [ ] CSV export, classifyUserIntent, export-zip (Emanator to self-implement)
- [ ] Vision support for Core System chat
- [ ] Refactor message-stream.js and service.js

## Tech Stack
- Next.js 14 App Router, OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth), MongoDB (credits), Stripe (payments)
- Tailwind CSS + Shadcn UI
