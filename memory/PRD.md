# Emanator PRD

## Original Problem Statement
Build a self-editing AI builder (Emanator) that can reliably modify its own core files and act as a multi-step agent.

## Core Architecture
- Next.js 14 App Router conversational AI builder
- Agent Loop: AI calls tools sequentially (read → write → verify → fix), max 6 iterations
- Tools: read_files, patch_files, update_files, verify_build, update_canvas
- Safety: syntax validation + bracket balance + import validation + auto-revert + zero-apply save prevention

## Completed Features

### ProjectGrid Extraction + Bulk Select/Delete (Apr 14)
- Extracted ProjectGrid.jsx (351 lines) from Dashboard.jsx (was 3526, now 3330)
- Built-in bulk select/delete: Select button → checkboxes on tiles → Select All → Delete N → confirmation
- SELF_EDIT_TARGETS updated with project_grid entry
- identifyTargetFile keyword map routes "project tile/card/bin/grid" to ProjectGrid.jsx
- Testing: 100% pass rate (iteration_82)

### Agent Loop (Apr 14)
- read_files, verify_build tools with agent loop continuation
- Max 2 read_files calls before forcing action
- Max 6 total iterations per turn

### Patch Reliability Pipeline (Apr 14)
- 3-level fuzzy matching (exact → trim-per-line → normalized whitespace)
- Zero-apply save prevention (blocks save when 0/N patches apply)
- Corrective retry fallback (shows AI exact failed lines for re-patching)
- Smart tool selection (update_files recommended for files >500 lines)

### All Earlier Features
- Self-edit pipeline, Canvas PM, broken promise detector, stalling detector
- Stream timeout recovery, auth resilience, auto-revert self-healing
- AI conversation memory, conversational routing, smart file injection
- Import validation, action enforcement, post-build auto-continue

## Remaining Backlog
- [ ] Further refactor Dashboard.jsx (still 3330 lines)
- [ ] CSV export, classifyUserIntent, export-zip (Emanator to self-implement)
- [ ] Vision support for Core System chat
- [ ] Refactor message-stream.js (~3100 lines)

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- Supabase (DB/Auth), MongoDB (credits), Stripe (payments)
