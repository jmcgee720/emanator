# Agent-to-Agent Escalation

## Overview

When a project agent encounters a task it cannot complete due to missing capabilities, it can **escalate to Core System** and spawn a joint conversation where both agents collaborate in real-time. The user watches both agents work together, then exits back to the project chat when done.

## How It Works

### 1. Project Agent Recognizes Gap

```javascript
// User asks: "Deploy my Firebase Functions"
// Project agent realizes: "I can write files but cannot run `firebase deploy`"
```

### 2. Agent Calls `escalate_to_core_system`

```javascript
escalate_to_core_system({
  task_description: "I need a run_command tool to execute `firebase deploy --only functions` in the preview environment. The user wants to deploy Firebase Functions but I can only write files, not run shell commands in the preview runner.",
  urgency: "blocking"
})
```

### 3. Escalation Chat Created

- New Core System chat created with metadata: `{ is_escalation: true, escalation_source: { chat_id, project_id, task } }`
- Initial context message posted explaining the task
- User sees split-screen UI:
  - **Left:** Source project chat (read-only during escalation)
  - **Right:** Escalation chat (Core System + project agent collaborate)

### 4. Agents Collaborate

- Core System implements the missing capability (e.g., adds `run_command_in_preview` tool)
- Project agent verifies it works in their project
- Both agents see each other's messages
- User can send messages to either chat

### 5. User Exits Escalation

- Clicks "Exit Escalation" button
- Summary posted to source project chat
- Redirected back to source project chat
- Escalation chat marked as resolved

## UI Flow

```
┌─────────────────────────────────────────────────────────────┐
│  🤝 Agent Collaboration Mode                [Exit Escalation]│
│  Project agent escalated: "Need run_command tool"           │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│ 📁 Source Project Chat   │ ⚙️ Core System Escalation        │
│ (read-only)              │ (active)                         │
│                          │                                  │
│ User: Deploy my Firebase │ Core System: I'll add a          │
│ Functions                │ run_command_in_preview tool.     │
│                          │                                  │
│ Project Agent: I need a  │ [commits code]                   │
│ run_command tool. I've   │                                  │
│ escalated this to Core   │ Core System: Tool deployed.      │
│ System.                  │ Try calling it now.              │
│                          │                                  │
│                          │ Project Agent: Testing...        │
│                          │ ✅ Works! Firebase Functions     │
│                          │ deployed successfully.           │
└──────────────────────────┴──────────────────────────────────┘
```

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
- Task is genuinely impossible (violates physics, security, etc.)

## Implementation Details

### Database Schema

```sql
-- Escalation metadata stored in chats.metadata
{
  "is_escalation": true,
  "escalation_source": {
    "chat_id": "uuid",
    "project_id": "uuid",
    "task": "description",
    "created_at": "timestamp"
  },
  "resolved": false,
  "resolved_at": null
}
```

### API Endpoints

- `POST /api/escalations/:id/exit` — Exit escalation, return to source chat

### Tool Definition

```javascript
{
  name: 'escalate_to_core_system',
  description: 'Escalate a task to Core System when you lack the capability to complete it yourself.',
  input_schema: {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Clear description of what you need Core System to build.'
      },
      urgency: {
        type: 'string',
        enum: ['blocking', 'important', 'nice-to-have']
      }
    },
    required: ['task_description', 'urgency']
  }
}
```

## Security

- Only project agents can escalate (not Core System → project)
- Escalation chat inherits user's permissions (owner-only for self-edit)
- Core System cannot write to project files (scope isolation)
- Project agent cannot write to Auroraly source (existing guard)

## Benefits

1. **No more middle-man:** User doesn't have to copy-paste between chats
2. **Real-time collaboration:** Both agents see each other's work
3. **Faster iteration:** Core System can test changes immediately
4. **Better context:** Core System sees the exact project state that triggered the gap
5. **Audit trail:** Full conversation preserved in escalation chat

## Example Scenarios

### Scenario 1: Missing Tool

```
User: "Deploy my Firebase Functions"
Project Agent: [calls escalate_to_core_system]
→ Escalation chat opens
Core System: "I'll add a run_command_in_preview tool"
Core System: [implements tool, commits to Auroraly]
Project Agent: "Testing... ✅ Works!"
User: [clicks Exit Escalation]
→ Back to project chat with summary
```

### Scenario 2: Tool Needs More Parameters

```
User: "Take a screenshot of the /login page"
Project Agent: "screenshot_preview tool exists but can't navigate to specific routes"
Project Agent: [calls escalate_to_core_system]
→ Escalation chat opens
Core System: "I'll add a `route` parameter to screenshot_preview"
Core System: [updates tool, redeploys]
Project Agent: "Testing with route='/login'... ✅ Works!"
User: [clicks Exit Escalation]
```

### Scenario 3: Workflow Automation

```
User: "I want to deploy to Vercel every time I say 'ship it'"
Project Agent: "I can write files but can't trigger Vercel deployments"
Project Agent: [calls escalate_to_core_system]
→ Escalation chat opens
Core System: "I'll add a deploy_to_vercel tool"
Core System: [implements tool with Vercel API integration]
Project Agent: "Testing... ✅ Deployed to production!"
User: [clicks Exit Escalation]
```

## Future Enhancements

- **Multi-agent escalations:** More than 2 agents in one escalation
- **Escalation templates:** Pre-filled task descriptions for common gaps
- **Auto-exit:** Escalation auto-closes when both agents agree task is done
- **Escalation history:** Dashboard showing all past escalations + outcomes
- **Learning:** Core System learns which gaps are most common and proactively builds tools
