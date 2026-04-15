# Emanator PRD — Agent Platform

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, and build checking. Making Emanator work like E1/Emergent.

## Architecture
- Next.js 14 App Router conversational AI builder
- E2B Sandboxed Execution: isolated Linux VM per project
- Agent Loop: max 12 iterations per turn (read -> edit -> exec -> verify -> screenshot -> remember)
- 9 agent tools: read_files, patch_files, update_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, update_canvas

## Completed Phases

### Phase 1-6: Foundation (COMPLETE)
- E2B Sandbox, Agent Loop, Context Management, Testing Framework, Session Memory, Model Router

### Phase 7: Line-Based Editing (COMPLETE - 2026-04-15)
- `edit_lines` tool with 23 passing tests
- `read_files` returns numbered lines for all code paths

### Phase 8: Screenshot Self-Edit (COMPLETE - 2026-04-15)
- `screenshot_verify` works for sandbox (E2B) and self-edit (local Playwright)

### Phase 9: Codebase Refactoring (COMPLETE - 2026-04-15)
- Dashboard.jsx: 3333 -> 2004 lines (40% reduction)
  - useDashboardProject.js (475 lines): 14 CRUD functions
  - useDashboardStream.js (946 lines): sendMessage, executePlan, applyDiffs + 9 state vars
- message-stream.js: 3417 -> 3128 lines
  - message-helpers.js (285 lines): 5 helper functions

### Phase 10: P1 Features (COMPLETE - 2026-04-15)
- **CSV Export**: CodeTab now has CSV export button (handleExportCSV) for project file listings
- **ZIP Download**: CodeTab now has ZIP download button (handleExportZip) via /api/projects/:id/export-zip
- **classifyUserIntent**: New conversational phase classifier in intents.js
  - Classifies messages into: instruction, question, feedback, approval, clarification, greeting, frustration, followup
  - 11/11 test cases passing

### UI Features
- ProjectGrid.jsx extracted, bulk select/delete
- All earlier features: patch reliability, broken promise detection, auto-revert, etc.

## File Structure
```
/app
├── lib/
│   ├── ai/
│   │   ├── message-stream.js      # Core agent loop (3128 lines)
│   │   ├── message-helpers.js     # Extracted helpers (285 lines)
│   │   ├── intents.js             # Intent + conversational phase classification
│   │   ├── tools.js               # Tool schemas
│   │   └── ...
│   ├── e2b/
│   │   ├── agent-tools.js         # read_files, edit_lines, verify_build, exec_command
│   │   ├── screenshot-service.js  # Playwright screenshots (sandbox + local)
│   │   ├── sandbox-service.js     # E2B container management
│   │   └── memory-service.js      # Session memory
│   ├── api/routes/
│   │   ├── exports.js             # ZIP/manifest export + /export-zip endpoint
│   │   └── ...
├── components/dashboard/
│   ├── Dashboard.jsx              # Main workspace (2004 lines)
│   ├── useDashboardStream.js      # Streaming/plan/diff hook (946 lines)
│   ├── useDashboardProject.js     # Project/chat CRUD hook (475 lines)
│   ├── ProjectGrid.jsx            # Grid view (351 lines)
│   └── tabs/CodeTab.jsx           # Code tab with CSV/ZIP export
```

## Remaining Backlog
- [ ] E2B custom template with preinstalled deps
- [ ] Multi-model routing (Claude for reasoning, GPT-4o for quick edits)
- [ ] Vision support for Core System chat
- [ ] Further refactor message-stream.js tool handlers

## Tech Stack
- Next.js 14, OpenAI GPT-4o via Emergent LLM Key
- E2B for sandboxed execution
- Supabase (DB/Auth/Memory), MongoDB (credits), Stripe (payments)
