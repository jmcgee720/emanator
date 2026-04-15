# Emanator PRD — Agent Platform (COMPLETE)

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, build checking, smart model routing, vision support, and conversational intelligence. Emanator can read, edit, verify, screenshot, and reason about its own code — just like E1/Emergent.

## Architecture
- Next.js 14 App Router conversational AI builder
- E2B Sandboxed Execution: isolated Linux VM per project, pre-installs React/Next/Tailwind
- Agent Loop: max 12 iterations per turn (read -> edit -> exec -> verify -> screenshot -> remember)
- 9 agent tools: read_files, patch_files, update_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, update_canvas
- Smart Model Router: auto-selects gpt-4o for complex tasks, gpt-4o-mini for quick edits
- Vision Support: AI analyzes uploaded images via GPT-4o vision in self-edit mode
- Conversational Intelligence: classifyUserIntent detects frustration/feedback/followup and adapts response style

## ALL Phases Complete

### Phase 1-6: Foundation
- E2B Sandbox, Agent Loop, Context Management, Testing Framework, Session Memory, Model Router

### Phase 7: Line-Based Editing
- `edit_lines` tool with 23 passing tests
- `read_files` returns numbered lines for all code paths (sandbox, DB fallback, self-edit)

### Phase 8: Screenshot Self-Edit
- `screenshot_verify` works for sandbox (E2B Playwright) and self-edit (local Python Playwright)
- Returns headings, buttons, inputs, console errors, body preview

### Phase 9: Codebase Refactoring
- Dashboard.jsx: 3333 -> 2004 lines (40% reduction)
- message-stream.js: 3417 -> 3165 lines
- 4 new modules extracted: useDashboardProject.js, useDashboardStream.js, message-helpers.js

### Phase 10: Features
- CSV Export + ZIP Download in CodeTab
- classifyUserIntent (8 conversational phases, 11/11 tests)
- /api/projects/:id/export-zip endpoint

### Phase 11: Intelligence Layer
- Multi-model routing (AIService.routeModel)
- Vision support (image analysis via GPT-4o in self-edit mode)
- E2B sandbox pre-installs react/next/tailwind in background
- Conversational phase adaptation (frustration -> empathy, feedback -> precision, followup -> continuation)

## File Structure
```
components/dashboard/
  Dashboard.jsx              (2004 lines)
  useDashboardStream.js      (946 lines)
  useDashboardProject.js     (475 lines)
  ProjectGrid.jsx            (351 lines)
  tabs/CodeTab.jsx           (CSV/ZIP export)

lib/ai/
  message-stream.js          (3165 lines)
  message-helpers.js          (285 lines)
  intents.js                 (+classifyUserIntent)
  service.js                 (+routeModel)
  tools.js, context.js, etc.

lib/e2b/
  agent-tools.js             (323 lines - read/edit/verify/exec)
  screenshot-service.js      (283 lines - sandbox + local Playwright)
  sandbox-service.js         (+pre-install deps)
  memory-service.js

lib/api/routes/
  exports.js                 (+export-zip endpoint)
```

## Tech Stack
- Next.js 14, OpenAI GPT-4o/GPT-4o-mini via Emergent LLM Key
- E2B for sandboxed execution
- Supabase (DB/Auth/Memory), MongoDB (credits), Stripe (payments)
