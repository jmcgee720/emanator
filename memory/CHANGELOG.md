# Emanator AI Builder — Changelog

## 2026-04-03 — Auto-Execute File Persistence Fix (P0)
- **Fixed**: Direct-edit and auto-execute now properly save files to DB and refresh the preview
- **Fixed**: `proposedPlan` cleared after auto-execute → PlanCard no longer shows for auto-executed/direct-edited requests
- **Added**: Debug logging in `service.js` (`[Done]`) and `stream-handler.js` (`[StreamHandler]`) for data flow tracing
- **Verified**: 9/9 frontend tests passed — files persist, preview renders React/Babel/Tailwind content, no PlanCard for auto-executed messages

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
- Removed "Delete All" button from Dashboard
