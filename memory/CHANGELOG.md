# Emanator AI Builder — Changelog

## 2026-04-03 — Direct-Edit tool_choice Enforcement (P0)
- **Root cause**: In direct-edit mode, `tool_choice` was NOT forced → AI could respond with text only, never calling `create_files` → zero files saved → preview empty
- **Fix 1**: Force `tool_choice: { type: 'function', function: { name: directEditFileAction } }` in direct-edit mode — AI MUST call the file tool
- **Fix 2**: Hoisted `directEditFileAction` (create_files vs update_files) to be computed at detection time and reused for both system prompt and tool_choice
- **Fix 3**: Success text guard — "Done — I built..." only emits when `savedFiles.length > 0`
- **Fix 4**: Text-parse fallback — if tool call somehow produces no files, attempts to parse and auto-save from response text
- **Fix 5**: `proposedPlan = null` after auto-execute — prevents PlanCard from showing for auto-executed plans
- **Verified**: 15/15 frontend tests passed across two fresh projects (fintech dashboard + SaaS landing page)

## 2026-03-29 — System Hardening Session
- Grounding Injection: `buildProjectGroundingBlock()` passes real file index to LLM
- Direct-Edit Mode: Bypass planner for single-page edits, premium layout system prompt
- Core System Chat Fix: Fixed "New Chat" routing to `createSelfEditChat()`
- Conversational UI Cleanup: Stripped "Intent: BUILD", raw JSON, "Implementation Plan" from chat
- Preview Height Fix: `min-h-0` and `absolute inset-0` in RightPanel/PreviewTab
- PlanCard Suppression: Hidden for medium/safe edits (`autoExecute: true`)

## Earlier Changes
- Initial Emanator AI Builder implementation
- Dashboard, chat interface, project management
- Supabase auth integration
- Stripe payments integration
- Preview system (HTML, React/JSX, Node.js)
- Core System self-editing architecture
- Growth analytics panel
