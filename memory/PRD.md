# Emanator PRD — Agent Platform (COMPLETE)

## Vision
Full agent platform with sandboxed execution, multi-step reasoning, session memory, screenshot verification, build checking, smart model routing, vision support, and conversational intelligence.

## Architecture
- Next.js 14 App Router + E2B Sandboxed Execution
- Agent Loop: while(true) with max 12 iterations (read -> edit -> exec -> verify -> screenshot -> remember)
- 9 tools: read_files, patch_files, update_files, edit_lines, verify_build, exec_command, screenshot_verify, update_memory, update_canvas
- Smart Model Router: auto-selects gpt-4o vs gpt-4o-mini based on task complexity
- Vision Support: GPT-4o image analysis in self-edit mode
- Conversational Intelligence: frustration/feedback/followup detection + adaptive prompts

## ALL Phases Complete (2026-04-15)

### Phase 1-6: Foundation
E2B Sandbox, Agent Loop, Context Management, Testing Framework, Session Memory, Model Router

### Phase 7: Line-Based Editing — 23 tests passing
### Phase 8: Screenshot Self-Edit — Playwright (local + sandbox)
### Phase 9: Codebase Refactoring — Dashboard.jsx 3333→2004 lines (40% reduction)
### Phase 10: Features — CSV Export, ZIP Download, classifyUserIntent, /export-zip
### Phase 11: Intelligence Layer — Model routing, vision, E2B pre-install, phase adaptation

### CRITICAL BUG FIX (Phase 12)
- **Agent Loop Structure**: while(true) was closing at line 1475 (before tool processing). All tool handlers (read_files, edit_lines, etc.) executed OUTSIDE the loop, so agentLoopContinue=true was never checked. AI would read files but never edit them.
- **Fix**: Restructured braces so while loop extends to line 2787, enclosing all tool processing + agentLoopContinue check. Verified with brace depth analysis.

## File Structure
```
components/dashboard/
  Dashboard.jsx (2004), useDashboardStream.js (946), useDashboardProject.js (475), ProjectGrid.jsx (351)
lib/ai/
  message-stream.js (3180), message-helpers.js (285), intents.js (+classifyUserIntent), service.js (+routeModel)
lib/e2b/
  agent-tools.js (323), screenshot-service.js (283), sandbox-service.js (+pre-install), memory-service.js
lib/api/routes/
  exports.js (+export-zip)
```

## Tech Stack
Next.js 14, OpenAI GPT-4o/GPT-4o-mini via Emergent LLM Key, E2B, Supabase, MongoDB, Stripe
