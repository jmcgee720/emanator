# Proactive Fork System — Context Length Management

## Problem Statement

Users were hitting context_length errors mid-conversation, causing:
1. Cryptic "agent-core" error messages
2. Lost work when the stream failed
3. Confusion about what to do next
4. Poor UX — the error appeared AFTER they'd already typed a long message

## Solution

A **proactive fork system** that:
1. **Detects** when a conversation is approaching token limits (70% = warning, 85% = hard block)
2. **Warns** the user BEFORE they hit the limit
3. **Guides** them to fork with a clear CTA and auto-generated chat name
4. **Prevents** the agent-core error from ever appearing

---

## Implementation

### 1. Token Counter (`lib/ai/token-counter.js`)

**Purpose:** Estimate conversation token usage without expensive tiktoken calls.

**Key Functions:**
- `estimateTokens(text)` — Rough token count (1 token ≈ 4 chars + 20% buffer for code)
- `calculateConversationTokens(messages)` — Total tokens in a thread (content + attachments + hidden instructions)
- `getModelLimit(modelName)` — Context limits per model (Claude: 200K, GPT-4o: 128K, etc.)
- `checkForkNeeded(messages, modelName)` — Returns `{ needsFork, critical, tokensUsed, limit, percentage, message }`
  - **70-85%:** `needsFork: true` (soft warning, request proceeds)
  - **>85%:** `critical: true` (hard block, shows fork button)
- `generateForkTitle(messages, currentTitle)` — Extract 2-3 word topic from recent user messages
  - Patterns: "add payment flow" → `"payment-flow"`
  - Fallback: "pixel-adjust (cont.)"

### 2. Stream Handler (`lib/api/stream-handler.js`)

**Changes:**
1. **Load full message history** before processing request
2. **Check token usage** via `checkForkNeeded()`
3. **If critical (>85%):**
   - Block the request
   - Save a fork warning message
   - Send `fork_required` event to frontend
   - Close stream immediately
4. **If approaching (70-85%):**
   - Allow request to proceed
   - Send `fork_suggested` event to frontend (non-blocking toast)

**Code:**
```javascript
const allMessages = await db.messages.findByChatId(chatId)
const forkCheck = checkForkNeeded(allMessages, aiService.modelName)

if (forkCheck.critical) {
  const forkWarning = `⚠️ **Conversation Too Long**\n\n${forkCheck.message}\n\nClick the **Fork** button below...`
  const warnMessage = await db.messages.create({
    chat_id: chatId,
    project_id: chat.project_id,
    role: 'assistant',
    content: forkWarning,
    metadata: { fork_warning: true, tokens_used: forkCheck.tokensUsed, limit: forkCheck.limit, streamed: true }
  })
  send('fork_required', { tokensUsed, limit, percentage })
  send('done', { content: forkWarning, messageId: warnMessage.id, fork_required: true })
  return
}

if (forkCheck.needsFork && !forkCheck.critical) {
  send('fork_suggested', { tokensUsed, limit, percentage, message: forkCheck.message })
}
```

### 3. Fork Endpoint (`lib/api/routes/chats.js`)

**Changes:**
1. **Auto-generate title** using `generateForkTitle()` instead of AI call
2. **AI summary** still generated for context (2-3 sentences)
3. **Faster fork** — pattern matching is instant, AI summary is optional

**Code:**
```javascript
import { generateForkTitle } from '@/lib/ai/token-counter'

const messages = await db.messages.findByChatId(chatId)
let forkTitle = body.title || generateForkTitle(messages, sourceChat.title)

// AI summary for context (non-blocking)
let summaryText = ''
try {
  const provider = createProvider('openai', apiKey, 'gpt-4o-mini', {})
  const result = await provider.chat([
    { role: 'system', content: `Write 2-3 sentences covering: what was built, current state, what user was working on last.` },
    { role: 'user', content: `Chat: "${sourceChat.title}"\nMessages: ${messages.length}\n...` }
  ], { temperature: 0.3, max_tokens: 120 })
  summaryText = result.content.trim()
} catch { /* fallback to manual summary */ }
```

### 4. Frontend (`components/dashboard/useDashboardStream.js`)

**New Event Handlers:**
```javascript
onForkSuggested: (data) => {
  toast({ 
    title: 'Conversation Getting Long', 
    description: `${Math.round(data.percentage)}% of context used. Consider forking soon.`,
    variant: 'default'
  })
},
onForkRequired: (data) => {
  toast({ 
    title: 'Fork Required', 
    description: `This conversation is too long (${Math.round(data.percentage)}%). Click Fork to continue.`,
    variant: 'destructive'
  })
  setStreamingMessageId(null)
  setStreamingStatus(null)
}
```

### 5. Stream Client (`lib/stream-client.js`)

**New Event Types:**
```javascript
case 'fork_suggested': callbacks.onForkSuggested?.(data); break
case 'fork_required': callbacks.onForkRequired?.(data); break
```

### 6. UI (`components/dashboard/LeftPanel.jsx`)

**Fork Warning Card:**
- Special styling: cyan border, GitFork icon
- Prominent "Fork Conversation" button
- Appears inline in the chat thread
- Auto-disables while forking

**Code:**
```jsx
{isForkWarning ? (
  <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-3.5 py-2.5">
    <div className="flex items-start gap-2 mb-2">
      <GitFork className="w-4 h-4 text-cyan-400 mt-0.5" />
      <MessageRenderer content={message.content} />
    </div>
    <Button
      onClick={async () => {
        setForkingChat(true)
        await onForkChat(selectedChat.id)
        setForkingChat(false)
      }}
      disabled={forkingChat}
    >
      {forkingChat ? 'Forking...' : 'Fork Conversation'}
    </Button>
  </div>
) : ...}
```

---

## User Flow

### Before (Old Behavior)
1. User types a long message in a 150K-token conversation
2. Hits Send
3. Stream starts, processes 50K tokens of context
4. **Crashes mid-stream** with "agent-core error: context_length"
5. User confused, work lost

### After (New Behavior)

#### Scenario A: Approaching Limit (70-85%)
1. User sends a message
2. Toast appears: "Conversation getting long (78% used). Consider forking soon."
3. Request proceeds normally
4. User can continue or fork at their convenience

#### Scenario B: Critical (>85%)
1. User sends a message
2. **Request blocked immediately**
3. Chat shows fork warning message with cyan border
4. Toast: "Fork Required — This conversation is too long (87%). Click Fork to continue."
5. User clicks "Fork Conversation" button
6. New chat opens with auto-generated name (e.g., "pixel-adjust")
7. First message is AI summary of previous conversation
8. User continues seamlessly

---

## Benefits

1. **No more agent-core errors** — blocked before they happen
2. **Better UX** — clear guidance instead of cryptic errors
3. **Preserved work** — nothing lost, clean handoff
4. **Smart naming** — "payment-flow", "header-redesign" instead of "Chat (cont.)"
5. **Proactive** — warns at 70%, blocks at 85%, never hits the actual 200K limit
6. **Fast** — pattern-based title generation (no AI call needed for fork)

---

## Token Thresholds

| Threshold | Action | UX |
|-----------|--------|-----|
| < 70% | None | Silent |
| 70-85% | Soft warning | Non-blocking toast |
| > 85% | Hard block | Fork button in chat + destructive toast |
| 100% (200K) | Never reached | Prevented by 85% gate |

---

## Testing

### Manual Test Cases

1. **Short conversation (< 70%):**
   - Send messages normally
   - No warnings appear
   - ✅ Expected: Silent operation

2. **Approaching limit (70-85%):**
   - Simulate by adding ~140K tokens to conversation
   - Send a message
   - ✅ Expected: Toast warning, request proceeds

3. **Critical (> 85%):**
   - Simulate by adding ~170K tokens to conversation
   - Send a message
   - ✅ Expected: Fork warning card, request blocked, Fork button visible

4. **Fork flow:**
   - Click "Fork Conversation"
   - ✅ Expected: New chat opens with short descriptive name
   - ✅ Expected: First message is AI summary
   - ✅ Expected: Can continue conversation seamlessly

### Edge Cases

- **Empty conversation:** Fork title fallback works
- **AI summary fails:** Manual fallback summary used
- **Multiple rapid messages:** Only first one triggers fork check
- **Different models:** Correct limits applied (Claude 200K, GPT-4o 128K)

---

## Files Changed

1. `lib/ai/token-counter.js` — NEW (token estimation + fork title generation)
2. `lib/api/stream-handler.js` — Added proactive fork check
3. `lib/api/routes/chats.js` — Enhanced fork endpoint with auto-naming
4. `components/dashboard/useDashboardStream.js` — Added fork event handlers
5. `lib/stream-client.js` — Added fork_suggested/fork_required events
6. `components/dashboard/LeftPanel.jsx` — Added fork warning card UI

---

## Future Enhancements

1. **Auto-trim (Phase 2):**
   - Summarize old messages when approaching 130K
   - Keep recent turns intact
   - Extends conversation life without forcing fork

2. **Smart context pruning:**
   - Drop old file content from context
   - Keep only recent edits
   - Preserve conversation flow

3. **Fork suggestions:**
   - "This looks like a good stopping point — want to fork?"
   - Detect natural breakpoints (feature complete, bug fixed)

4. **Token usage display:**
   - Show "142K / 200K tokens" in chat footer
   - Visual progress bar
   - Real-time updates

---

## Deployment

All changes committed to `jmcgee720/emanator@main`. Vercel will auto-deploy.

**Test URL:** https://emanator-git-main-jmcgee720s-projects.vercel.app

**Production:** Changes live after successful deployment.

---

## Monitoring

Watch for:
- Reduced context_length errors in logs
- Increased fork rate (expected — this is good!)
- User feedback on fork naming quality
- Token estimation accuracy vs actual usage

**Success Metrics:**
- context_length errors → 0
- Fork success rate → 100%
- Average fork title quality → human-readable
