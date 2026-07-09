# Persistent Cross-Session Memory Implementation

**Date**: 2025-01-XX  
**Status**: ✅ Implemented (Phase 1)  
**Goal**: Agents should NEVER ask the user for the same information twice, even across different chat sessions or after forking.

---

## WHAT WAS BUILT

### 1. Persistent Memory Storage Layer (`lib/ai/persistent-memory.js`)

Two-tier memory system:

#### **Project-Scoped Memory** (survives across all chats for a project)
- **Storage**: `project_memory` table in Supabase
- **Scope**: Facts about a specific project (framework, API endpoints, deployment URLs, file structure)
- **Lifetime**: Permanent (until explicitly deleted or project deleted)
- **Examples**:
  - `framework: "React + Vite"`
  - `build_tool: "Vite"`
  - `production_url: "https://mynexus.vercel.app"`
  - `api_endpoint: "https://api.example.com/v1"`

#### **User-Scoped Memory** (follows the user across all projects)
- **Storage**: `users.metadata.agent_memory` JSONB column
- **Scope**: Facts about the user (API keys, preferences, team info, external service credentials)
- **Lifetime**: Permanent (until user deletes account or explicitly clears memory)
- **Examples**:
  - `preferred_framework: "Next.js"`
  - `stripe_account_id: "acct_xxx"`
  - `team_size: "solo developer"`
  - `timezone: "America/Los_Angeles"`

### 2. Auto-Learning from Tool Calls

The system automatically extracts and saves facts from agent actions:

**Framework Detection** (from `read_file` on `package.json`):
- Detects React, Next.js, Vue, Vite, Create React App
- Saves to project memory: `framework`, `build_tool`

**Deployment URLs** (from successful `deploy` tool calls):
- Saves to project memory: `production_url`

**API Endpoints** (from code reads):
- Extracts URLs from source files
- Saves to project memory: `api_endpoint`

**Future Auto-Detections** (Phase 2):
- Database connection strings (from env files)
- Authentication providers (from OAuth config)
- External service integrations (Stripe, Twilio, SendGrid)
- Deployment patterns (Vercel, Netlify, Firebase)

### 3. Memory Injection into System Prompts

Both project and self-edit system prompts now include:

```markdown
═══════════════════════════════════════════════════════════════════
                    PERSISTENT CROSS-SESSION MEMORY
═══════════════════════════════════════════════════════════════════

## PERSISTENT PROJECT MEMORY (survives across all chats)

Facts about this project that you have learned in previous conversations:

  • **framework**: React + Vite _(learned 2 days ago)_
  • **build_tool**: Vite _(learned 2 days ago)_
  • **production_url**: https://mynexus.vercel.app _(learned 1 hour ago)_

## PERSISTENT USER MEMORY (follows this user across all projects)

Facts about this user that you have learned:

  • **preferred_framework**: Next.js _(learned 1 week ago)_
  • **timezone**: America/Los_Angeles _(learned 3 days ago)_

**CRITICAL RULES**:
  1. NEVER ask the user for information that is already in this memory
  2. If a fact is stale (user says "that changed"), update it immediately
  3. When you learn a new fact, save it to persistent memory so future chats know it
  4. Project facts = deployment URLs, API endpoints, framework choices, file structure
  5. User facts = API keys, preferences, team info, external service credentials
```

### 4. Integration Points

**Stream Handler** (`lib/api/stream-handler-v2.js`):
1. **Load persistent memory** BEFORE building system prompts (line ~1315)
2. **Inject memory summary** into both project and self-edit prompts
3. **Auto-save facts** after each agent turn (fire-and-forget, line ~2035)

**Memory Functions**:
- `loadProjectMemory(projectId)` — load all project facts
- `loadUserMemory(userId)` — load all user facts
- `saveProjectFact(projectId, key, value, source)` — save a project fact
- `saveUserFact(userId, key, value, source)` — save a user fact
- `buildPersistentMemorySummary(projectId, userId)` — format for system prompt
- `autoSaveFacts(projectId, userId, events)` — extract and save from tool calls

---

## HOW IT WORKS

### Example: User Creates a New Project

**Turn 1** (first chat):
```
User: "Build me a React app with Vite"
Agent: [writes package.json with react + vite dependencies]
System: Auto-detects framework from package.json → saves to project memory:
  - framework: "React"
  - build_tool: "Vite"
```

**Turn 5** (same chat):
```
User: "Deploy this to Vercel"
Agent: [calls deploy tool]
System: Auto-saves deployment URL to project memory:
  - production_url: "https://my-app-abc123.vercel.app"
```

**Turn 10** (user forks chat):
```
User: "What framework am I using?"
Agent: "You're using React + Vite (detected from package.json 2 hours ago). 
        Your production URL is https://my-app-abc123.vercel.app."
```

**NEW CHAT** (user creates fresh chat for same project):
```
User: "Add a new component"
Agent: [reads persistent memory, sees framework: "React", build_tool: "Vite"]
Agent: "I'll create a new React component. Since you're using Vite, I'll put it in src/components/..."
[NO QUESTION ASKED — agent already knows the framework]
```

### Example: User Preference Learning

**Project A** (first time):
```
User: "I prefer Next.js for all my projects"
System: Saves to user memory: preferred_framework: "Next.js"
```

**Project B** (different project, weeks later):
```
User: "Build me a new web app"
Agent: [reads user memory, sees preferred_framework: "Next.js"]
Agent: "I'll scaffold a Next.js app for you (your preferred framework)."
[NO QUESTION ASKED — agent remembers user preference]
```

---

## BENEFITS

### Before (No Persistent Memory):
```
Chat 1:
User: "What framework am I using?"
Agent: "Let me check... [reads package.json] You're using React + Vite."

Chat 2 (forked from Chat 1):
User: "Add a new page"
Agent: "What framework are you using?"  ❌ REDUNDANT QUESTION
User: "React + Vite (I already told you this!)"
```

### After (With Persistent Memory):
```
Chat 1:
User: "What framework am I using?"
Agent: "Let me check... [reads package.json] You're using React + Vite."
System: [auto-saves framework: "React", build_tool: "Vite"]

Chat 2 (forked from Chat 1):
User: "Add a new page"
Agent: "I'll create a new React component in src/pages/... [writes file]"
✅ NO QUESTION — agent already knows from persistent memory
```

---

## PHASE 2 ENHANCEMENTS (Future)

### 1. Manual Memory Management Tools
Give agents tools to explicitly manage memory:

```typescript
// Agent can save facts explicitly
save_project_fact({
  key: "api_base_url",
  value: "https://api.example.com/v1",
  reason: "User configured this in .env file"
})

// Agent can query memory
get_project_fact({ key: "api_base_url" })
→ "https://api.example.com/v1 (learned 2 days ago)"

// Agent can update stale facts
update_project_fact({
  key: "production_url",
  value: "https://new-domain.com",
  reason: "User changed domain"
})
```

### 2. Memory Verification
Periodically verify facts are still accurate:

```typescript
// After 7 days, agent proactively checks:
Agent: "I have your production URL saved as https://old-url.com. 
        Is this still correct, or has it changed?"
```

### 3. Memory Sharing Across Users
For team projects, share project memory across team members:

```typescript
// User A saves fact:
save_project_fact({ key: "staging_url", value: "https://staging.example.com" })

// User B (different account, same project) sees it:
Agent: "Your staging environment is at https://staging.example.com 
        (configured by teammate@example.com 3 days ago)"
```

### 4. Memory Export/Import
Let users export and import memory for backup/migration:

```typescript
export_memory({ scope: "project", projectId: "abc123" })
→ { framework: "React", build_tool: "Vite", ... }

import_memory({ scope: "project", projectId: "xyz789", data: {...} })
```

---

## TESTING

### Manual Test Cases

**Test 1: Framework Detection**
1. Create new project
2. Agent writes package.json with React + Vite
3. Fork chat
4. Ask "what framework am I using?"
5. ✅ Agent should answer without reading package.json again

**Test 2: Deployment URL Persistence**
1. Deploy project to Vercel
2. Fork chat
3. Ask "what's my production URL?"
4. ✅ Agent should answer from memory

**Test 3: User Preference Learning**
1. Tell agent "I prefer Next.js"
2. Create NEW project (different project ID)
3. Ask agent to scaffold a web app
4. ✅ Agent should use Next.js without asking

**Test 4: Memory Staleness**
1. Agent saves production_url: "https://old-url.com"
2. User says "I changed my domain to https://new-url.com"
3. ✅ Agent should update the fact in memory

---

## IMPLEMENTATION CHECKLIST

- [x] Create `lib/ai/persistent-memory.js` with storage functions
- [x] Add `buildPersistentMemorySummary()` for system prompt injection
- [x] Add `autoSaveFacts()` for auto-learning from tool calls
- [x] Integrate into `stream-handler-v2.js`:
  - [x] Load persistent memory before system prompt construction
  - [x] Inject memory summary into system prompts
  - [x] Auto-save facts after each agent turn
- [ ] Add manual memory management tools (Phase 2)
- [ ] Add memory verification protocol (Phase 2)
- [ ] Add memory export/import (Phase 2)
- [ ] Add team memory sharing (Phase 2)

---

## RELATED FILES

- `lib/ai/persistent-memory.js` — Core memory storage/retrieval
- `lib/api/stream-handler-v2.js` — Integration point (loads + injects memory)
- `lib/ai/agent-memory.js` — Session-scoped memory (complementary, not replaced)
- `lib/supabase/db.js` — Database adapter (projectMemory, users tables)

---

## NOTES

- Persistent memory is **additive** to session memory (both are injected)
- Session memory = facts learned THIS chat (files created, attempts made)
- Persistent memory = facts learned ACROSS ALL chats (framework, URLs, preferences)
- Auto-save is **fire-and-forget** (never blocks the response stream)
- Memory is **scoped** (project facts stay with project, user facts follow user)
- Memory is **timestamped** (shows age in system prompt: "learned 2 days ago")

---

**Status**: ✅ Phase 1 complete. Agents now have persistent memory that survives chat forks and new sessions.
