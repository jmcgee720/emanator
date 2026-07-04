# Agent-to-Agent Escalation — Implementation Summary

## What Was Built

A complete **agent-to-agent escalation system** that lets project agents spawn joint conversations with Core System when they hit capability gaps. The user watches both agents collaborate in real-time, then exits back to the project chat when done.

## Files Created

1. **`lib/ai/agent-escalation.js`** — Core escalation logic
   - `createEscalationChat()` — Creates escalation chat with metadata
   - `exitEscalation()` — Exits escalation, posts summary to source chat
   - `handleEscalation()` — Tool handler for project agents
   - `escalateToCoreSystemTool` — Tool definition

2. **`components/chat/EscalationView.jsx`** — Split-screen UI
   - Left: Source project chat (read-only during escalation)
   - Right: Escalation chat (Core System + project agent collaborate)
   - Top: Banner with task description + "Exit Escalation" button

3. **`lib/api/routes/escalations.js`** — API endpoints
   - `POST /api/escalations/:id/exit` — Exit escalation, return to source chat

4. **`app/escalations/[id]/page.js`** — Escalation page
   - Loads escalation chat + source chat
   - Renders EscalationView component

5. **`docs/agent-escalation.md`** — Documentation
   - How it works
   - When to use
   - Example scenarios
   - Security model

## Files Modified

1. **`lib/ai/agent-tools-v2.js`**
   - Added `escalateToCoreSystemTool` import
   - Wired tool into project agent toolset (when userId + chatId available)
   - Updated `buildDefaultToolset()` signature to accept userId + chatId

2. **`lib/api/stream-handler-v2.js`**
   - Updated project system prompt to explain escalation capability
   - Passed userId + chatId to `buildDefaultToolset()`

3. **`app/api/[[...path]]/route.js`**
   - Registered `escalationsRoutes` in phase2Modules

## How It Works

### 1. Project Agent Recognizes Gap

```javascript
// User: "Deploy my Firebase Functions"
// Agent: "I can write files but cannot run `firebase deploy`"
```

### 2. Agent Calls Tool

```javascript
escalate_to_core_system({
  task_description: "I need a run_command tool to execute `firebase deploy --only functions` in the preview environment.",
  urgency: "blocking"
})
```

### 3. Escalation Chat Created

- New Core System chat with metadata: `{ is_escalation: true, escalation_source: { chat_id, project_id, task } }`
- User sees split-screen UI
- Both agents can see each other's messages

### 4. Agents Collaborate

- Core System implements the missing capability
- Project agent verifies it works
- User watches both agents work together

### 5. User Exits

- Clicks "Exit Escalation" button
- Summary posted to source project chat
- Redirected back to source project chat

## UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│  🤝 Agent Collaboration Mode                [Exit Escalation]│
│  Task: Need run_command tool for Firebase deploy            │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ 📁 Source Project Chat   │ ⚙️ Core System Escalation        │
│ (read-only)              │ (active)                         │
│                          │                                  │
│ User: Deploy Firebase    │ Core System: I'll add the tool.  │
│ Functions                │                                  │
│                          │ [commits code]                   │
│ Project Agent: Escalated │                                  │
│ to Core System.          │ Core System: Tool deployed.      │
│                          │                                  │
│                          │ Project Agent: ✅ Works!         │
└──────────────────────────┴──────────────────────────────────┘
```

## Security

- ✅ Only project agents can escalate (not Core System → project)
- ✅ Escalation chat inherits user's permissions
- ✅ Core System cannot write to project files (scope isolation)
- ✅ Project agent cannot write to Auroraly source (existing guard)

## When to Use

**✅ Escalate when:**
- Missing tool (run_command, database access, API integration)
- Tool exists but lacks parameters you need
- Workflow requires manual steps that should be automatable
- User says "I don't want to do anything" but you need them to do something
- You're about to give >3 manual terminal commands

**❌ Don't escalate when:**
- User error (wrong API key, typo) — fix it yourself
- Code bug in the project — debug it yourself
- Missing information you can ask the user for
- Task is genuinely impossible

## Example Scenario

```
User (in MyNexus chat): "Deploy my Firebase Functions"

Project Agent: "I can write files but cannot run shell commands in the preview 
environment. I need a run_command tool. Let me escalate this to Core System."

[calls escalate_to_core_system]

→ Split-screen UI opens

Core System (in escalation chat): "I'll add a run_command_in_preview tool that 
executes commands in the Fly preview runner. Give me a moment."

[Core System commits code to Auroraly]

Core System: "Tool deployed. It's now available as `run_command_in_preview`. 
Try calling it with command='firebase deploy --only functions'."

Project Agent: "Testing..."

[Project Agent calls the new tool]

Project Agent: "✅ Works! Firebase Functions deployed successfully to 
https://us-central1-mynexus-abc123.cloudfunctions.net"

User: [clicks "Exit Escalation"]

→ Back to MyNexus chat

Project Agent: "Escalation complete. Core System added the run_command_in_preview 
tool. Your Firebase Functions are now deployed. You can use this tool in future 
chats too."
```

## Benefits

1. **No more middle-man:** User doesn't copy-paste between chats
2. **Real-time collaboration:** Both agents see each other's work
3. **Faster iteration:** Core System can test changes immediately
4. **Better context:** Core System sees the exact project state
5. **Audit trail:** Full conversation preserved in escalation chat
6. **Platform evolution:** Missing capabilities get built on-demand

## Testing

To test the feature:

1. Open a project chat (e.g., MyNexus)
2. Ask the agent to do something it can't (e.g., "run `npm install` in the preview")
3. Agent should call `escalate_to_core_system`
4. Split-screen UI should open
5. Core System should respond in the escalation chat
6. Click "Exit Escalation" to return to project chat

## Future Enhancements

- **Multi-agent escalations:** More than 2 agents in one escalation
- **Escalation templates:** Pre-filled task descriptions for common gaps
- **Auto-exit:** Escalation auto-closes when both agents agree task is done
- **Escalation history:** Dashboard showing all past escalations + outcomes
- **Learning:** Core System learns which gaps are most common and proactively builds tools

## Deployment

All changes committed to `jmcgee720/emanator@main`. Vercel will auto-deploy in ~2 minutes.

Once deployed, the feature is immediately available to all project chats. No user action required.
