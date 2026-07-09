# ESCALATION UI FIX — COMPLETE IMPLEMENTATION

## Problems Identified

1. **Button not clickable when inactive**
   - `disabled={!isActive}` on line 54 of EscalationButton.jsx
   - Should be clickable always (just grey when inactive)

2. **Wrong hook usage**
   - Line 30 uses `useState` instead of `useEffect` for auto-open logic
   - Causes React warning and doesn't trigger

3. **No auto-open on creation**
   - `escalate_to_core_system` tool doesn't set `auto_open: true` in metadata
   - Button never auto-expands when escalation is created

4. **Project agent can't send messages to escalation**
   - No tool to post messages to the escalation chat
   - Agent creates escalation but can't communicate through it

5. **Listener query may not match**
   - Query filters for `project_id IS NULL` but also checks `metadata->is_escalation`
   - Need to verify the query matches the actual chat structure

## Fixes Required

### 1. Fix EscalationButton.jsx
- Remove `disabled={!isActive}` (keep button always clickable)
- Change line 30 from `useState` to `useEffect`
- Make button visually indicate "click to open" even when inactive

### 2. Fix agent-escalation.js
- Add `auto_open: true` to escalation chat metadata
- This triggers auto-expansion of the panel

### 3. Add send_escalation_message tool
- New tool for project agent to post messages to escalation chat
- Tagged with `agent_source: 'project_agent'`
- Core System can read these and respond

### 4. Fix useEscalationListener query
- Verify the query correctly finds escalation chats
- Add debug logging to see what's being fetched

### 5. Add auto-open logic
- When `activeEscalation.metadata.auto_open === true`, set `isPanelOpen(true)`
- Clear the flag after opening so it doesn't re-open on every render

## Implementation Order

1. Fix EscalationButton (clickability + auto-open)
2. Fix agent-escalation (add auto_open flag)
3. Add send_escalation_message tool
4. Test end-to-end flow
5. Document usage for project agents

## Expected Behavior After Fix

1. Project agent calls `escalate_to_core_system({ task_description: "...", urgency: "blocking" })`
2. Tool creates escalation chat with `auto_open: true`
3. Button appears in bottom-right, pulsing blue
4. Panel auto-opens showing the escalation chat
5. Project agent calls `send_escalation_message({ message: "..." })` to communicate
6. Core System sees messages and responds
7. User can also send messages to both agents
8. User clicks "Exit Escalation" when done
9. Summary posted to source project chat
10. Button returns to inactive grey state
