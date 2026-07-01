# Agent Learning System — Phase 1 Implementation

**Status**: ✅ Backend complete, UI pending  
**Deployed**: 2025-01-XX  
**Next**: Phase 2 (user preferences + embeddings)

---

## What Was Built

### 1. Database Schema (`supabase/migrations/010_agent_learning.sql`)

**`agent_incidents` table**:
- Records when the agent fails, loops, or hits capability limits
- Columns: `incident_type`, `user_request`, `what_failed`, `resolution`, `embedding` (for similarity search)
- Incident types:
  - `capability_limit` — "you can't do X"
  - `loop_detected` — agent tried same thing 3+ times
  - `redundant_question` — "you already asked me this"
  - `false_confidence` — "you said it worked but it didn't"
  - `tool_failure` — tool returned error
  - `wrong_approach` — user corrected the approach

**`agent_feedback` table**:
- Captures user feedback on specific agent actions (file edits, commands, etc.)
- Columns: `action_type`, `action_details`, `feedback` ('worked' | 'failed' | 'partial'), `user_note`
- Action types: `file_edit`, `file_create`, `file_delete`, `command_run`, `diagnosis`, `explanation`, `suggestion`

**Helper functions**:
- `search_similar_incidents(embedding, threshold, count)` — vector similarity search (requires pgvector)
- `get_action_feedback_stats(action_type, user_id)` — aggregate success rates

### 2. Detection Logic (`lib/ai/agent-learning.js`)

**`detectIncident(context)`**:
- Scans user messages for failure patterns:
  - "you can't do X" → `capability_limit`
  - "you already asked me this" → `redundant_question`
  - "still broken" after agent said "fixed" → `false_confidence`
  - "no, that's wrong" → `wrong_approach`
  - Same tool called 3+ times in 5 turns → `loop_detected`
- Returns incident payload or null

**`recordIncident(incident, embedding?)`**:
- Persists incident to database
- Optional embedding for similarity search (Phase 2)

**`searchSimilarIncidents(userRequest, userId, embedFn)`**:
- Finds past incidents similar to current request
- Uses embedding-based vector search (Phase 2)
- Fallback: keyword matching (Phase 1)

**`buildIncidentSummary(incidents)`**:
- Formats past incidents for system prompt injection
- Shows: incident type, what failed, resolution (if any)

**`detectFeedbackableAction(toolCall)`**:
- Identifies tool calls that should trigger feedback capture
- Returns action metadata for write_file, edit_file, delete_file, run_command

### 3. Integration (`lib/api/stream-handler-v2.js`)

**Incident detection** (after user message persisted):
```javascript
const incident = detectIncident({
  userMessage: { content: actualContent },
  chatHistory: recentHistory,
  chatId, projectId, userId
})
if (incident) recordIncident(incident)
```

**Incident search** (before building system prompt):
```javascript
const recentIncidents = await db.agentIncidents.findByUserId(userId, 10)
const relevant = recentIncidents.filter(/* keyword overlap */)
const incidentSummary = buildIncidentSummary(relevant)
```

**System prompt injection**:
- Both `buildSelfEditSystemPrompt` and `buildProjectSystemPrompt` now accept `incidentSummary`
- Injected after memory summary, before main instructions
- Format:
  ```
  ## PAST INCIDENTS (similar to current request):
  
  **capability_limit** (similarity: 85%)
    User asked: "extract video frames for load screen debugging"
    What failed: project agent can't analyze video
    Resolution: video extraction requires ffmpeg in Core System chat
  
  **Learn from these past failures. Do not repeat the same mistake.**
  ```

### 4. Database Adapter (`lib/supabase/db.js`)

**`db.agentIncidents`**:
- `create(payload)` — record new incident
- `findByUserId(userId, limit)` — get recent incidents
- `findByType(userId, type, limit)` — filter by incident type
- `searchSimilar(embedding, userId, threshold, limit)` — vector search (Phase 2)
- `updateResolution(id, resolution)` — record how it was fixed

**`db.agentFeedback`**:
- `create(payload)` — record user feedback
- `findByUserId(userId, limit)` — get feedback history
- `findByActionType(userId, actionType, limit)` — filter by action
- `getStats(actionType, userId)` — aggregate success rates

---

## How It Works

### Incident Recording Flow

1. **User sends message** → `handleStreamMessageV2` persists it
2. **Detect incident** → `detectIncident` scans for failure patterns
3. **Record incident** → `recordIncident` writes to `agent_incidents` table
4. **Next turn** → `searchSimilarIncidents` finds past failures
5. **Inject summary** → system prompt includes "PAST INCIDENTS" section
6. **Agent responds** → sees past failures, avoids repeating them

### Feedback Capture Flow (UI pending)

1. **Agent calls tool** → `write_file`, `edit_file`, etc.
2. **Tool result shown** → inline in chat ("> ↳ file.js")
3. **User clicks feedback** → 👍 Worked / 👎 Failed / ⚠️ Partial (UI TODO)
4. **Record feedback** → `recordFeedback` writes to `agent_feedback` table
5. **Future turns** → agent sees success rates for each action type

---

## What's Missing (Phase 2)

### 1. Feedback UI
- Add 👍👎⚠️ buttons after every tool result in chat
- Wire to `POST /api/agent/feedback` endpoint (TODO)
- Show feedback inline so user sees what they rated

### 2. Embeddings
- Generate embeddings for `user_request` field on incident creation
- Use OpenAI `text-embedding-3-small` (1536 dims)
- Enable pgvector extension in Supabase
- Switch from keyword matching to vector similarity search

### 3. User Preferences
- New table: `user_preferences` (verbosity, css_framework, autonomy_level, etc.)
- Extract preferences from conversation ("I hate when you explain how the code works")
- Inject into system prompt: "User preferences: {JSON}"
- Agent can ASK to record a preference: "Should I always X when you ask for Y?"

### 4. Cross-Chat Context
- New table: `user_activity_log` (summary of last 5 activities across all chats)
- Show in system prompt: "I see you were just debugging the Mangia Mama load screen in the project chat"
- Helps agent understand context when user switches between chats

### 5. Platform Knowledge Base
- New table: `platform_knowledge` (Q&A entries written by the agent)
- Agent discovers capability boundaries and writes knowledge entries
- High-confidence entries (upvotes > 5) auto-merge into `core-system-awareness.js`
- Example: "Can the project agent analyze video?" → "No. Video extraction requires ffmpeg in Core System chat."

---

## Testing

### Manual Test Cases

**Test 1: Capability Limit Detection**
1. Open Core System chat
2. Say: "I need help with my Mangia Mama project. Can you extract video frames?"
3. Agent should say: "I can't access user projects from this chat. Open the Mangia Mama chat."
4. Check Vercel logs: `[StreamV2] incident detected: capability_limit`
5. Check Supabase: `agent_incidents` table should have 1 row

**Test 2: False Confidence Detection**
1. Open project chat
2. Agent makes a code change, says "Fixed X"
3. You reply: "Still broken"
4. Check logs: `[StreamV2] incident detected: false_confidence`
5. Next turn: agent should see incident summary in system prompt

**Test 3: Loop Detection**
1. Agent calls `read_file('foo.js')` 3 times in 5 turns
2. Check logs: `[StreamV2] incident detected: loop_detected`
3. Incident should record tool_counts in metadata

**Test 4: Incident Injection**
1. Create an incident manually in Supabase:
   ```sql
   INSERT INTO agent_incidents (chat_id, user_id, incident_type, user_request, what_failed, resolution)
   VALUES ('...', '...', 'capability_limit', 'extract video frames', 'project agent cannot analyze video', 'use Core System chat with ffmpeg');
   ```
2. Open a new chat, say something with "video" in it
3. Check logs: `[StreamV2] injecting incident summary: { count: 1 }`
4. Agent response should reference the past failure

---

## Deployment Checklist

- [x] Migration file created (`010_agent_learning.sql`)
- [x] Run migration in Supabase SQL editor
- [x] Verify tables exist: `agent_incidents`, `agent_feedback`
- [x] Detection logic implemented (`lib/ai/agent-learning.js`)
- [x] Integration in stream handler (`lib/api/stream-handler-v2.js`)
- [x] Database adapter methods (`lib/supabase/db.js`)
- [ ] Enable pgvector extension in Supabase (Phase 2)
- [ ] Create feedback UI component (Phase 2)
- [ ] Create `/api/agent/feedback` endpoint (Phase 2)
- [ ] Add embeddings generation (Phase 2)

---

## Known Issues

1. **Embedding search not implemented**: Phase 1 uses keyword matching as fallback. Phase 2 will add OpenAI embeddings + pgvector.
2. **No feedback UI**: Users can't rate tool results yet. Phase 2 will add 👍👎⚠️ buttons.
3. **Cross-chat contamination risk**: Incident search is per-user, not per-project. A Core System incident could leak into a project chat. Phase 2 will add project_id filtering.

---

## Success Metrics

**Phase 1 (current)**:
- Incidents recorded per day
- Incident types distribution (which patterns are most common?)
- Incident injection rate (% of turns that see past failures)

**Phase 2 (future)**:
- Feedback capture rate (% of tool calls that get rated)
- Success rate per action type (file_edit, command_run, etc.)
- Repeat failure rate (same incident type within 7 days)
- User preference extraction rate (% of chats that learn a preference)

---

## Migration Instructions

**Run in Supabase SQL Editor**:
```sql
-- Copy contents of supabase/migrations/010_agent_learning.sql
-- Paste and execute
```

**Verify**:
```sql
SELECT COUNT(*) FROM agent_incidents;
SELECT COUNT(*) FROM agent_feedback;
```

**Enable pgvector (Phase 2)**:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Create embedding index (Phase 2)**:
```sql
CREATE INDEX idx_agent_incidents_embedding ON agent_incidents 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## Next Steps

1. **Deploy Phase 1** (current PR)
2. **Monitor incident logs** for 1 week — see which patterns fire most
3. **Build feedback UI** (Phase 2a)
4. **Add embeddings** (Phase 2b)
5. **User preferences** (Phase 2c)
6. **Platform knowledge base** (Phase 2d)

---

**Questions? Ask in Core System chat.**
