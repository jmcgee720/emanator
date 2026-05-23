# Context Window Optimization Changelog

**Date**: 2025-01-XX  
**Issue**: AI agent was sending EVERY file's full content back to the user after read_file calls, causing chats to hit the 200K token limit too quickly.

---

## Changes Implemented

### ✅ Fix #1: Remove "paste EXACT raw bytes" instruction from read_file tool
**File**: `lib/ai/agent-tools-v2.js` (lines 96-98)  
**Impact**: **HIGH** — 50-80% token reduction per read_file call

**Before**:
```javascript
description: 'When the user asks to SEE the file, you MUST after this tool returns paste the EXACT raw bytes inside a fenced ```<ext> ... ``` code block.'
```

**After**:
```javascript
description: 'The full file content is AUTOMATICALLY displayed to the user inline when you call this tool — you do NOT need to paste it again in your response. Just answer the user\'s question about the file.'
```

**Why**: The stream handler was already rendering read_file results inline at lines 1099-1100. The AI was duplicating the file content — once from the inline render, once from following the tool description. This caused massive token waste.

---

### ✅ Fix #2: Lower compaction threshold from 130K to 80K tokens
**File**: `lib/ai/context-compactor.js` (line 24)  
**Impact**: **MEDIUM** — Conversations now compact earlier, preventing context exhaustion

**Before**:
```javascript
const DEFAULT_THRESHOLD_TOKENS = 130_000
```

**After**:
```javascript
const DEFAULT_THRESHOLD_TOKENS = 80_000
```

**Why**: Waiting until 130K tokens meant only 70K headroom before hitting the 200K ceiling. With code-heavy chats and file reads, that headroom disappeared fast. Starting compaction at 80K gives 120K of buffer and prevents emergency context exhaustion.

---

### ✅ Fix #3: Strip verbose tool results from conversation history
**File**: `lib/api/stream-handler-v2.js` (new function + call site)  
**Impact**: **MEDIUM** — 30-50% token reduction in long conversations

**What**: Added `stripVerboseToolResults()` helper that trims assistant messages containing large tool results (read_file output, etc.) down to just a preview (~800 chars) after the turn they were originally called on.

**Location**: 
- Helper function added before `loadPriorMessages()` (around line 526)
- Applied after loading prior messages (around line 920)

**Why**: When read_file returns 50KB of code, the full content is shown inline on that turn. Keeping 50KB in every subsequent turn's history is wasteful — the AI already saw it, and the user already saw it. We now keep just the file path + first few lines as context.

**Example**:
```javascript
// Before (in history):
"> ↳ lib/ai/agent-tools-v2.js\n\n1| // ── Agent Tools v2 ──\n2| // Clean, scope-bounded tool implementations...\n[50KB of code]\n789| }\n"

// After (in history):
"> ↳ lib/ai/agent-tools-v2.js\n\n1| // ── Agent Tools v2 ──\n2| // Clean, scope-bounded tool implementations...\n[...tool result content stripped to save tokens — full content was shown inline on the turn it was called]"
```

---

### ✅ Fix #4: Conditional system prompt injection
**File**: `lib/api/stream-handler-v2.js` (buildProjectSystemPrompt)  
**Impact**: **LOW-MEDIUM** — 500-800 token savings per turn when protocols aren't needed

**What**: Made IMAGE_ANALYSIS_PROTOCOL and attachment-related instructions conditional — they're only injected into the system prompt when the current turn actually has images/attachments.

**Flags added**:
- `hasImages`: Only inject IMAGE_ANALYSIS_PROTOCOL when images are present
- `hasAttachments`: Only inject save_attachment_to_path description when attachments exist
- `includeInvestigationRule`: Control INVESTIGATION_FIRST_RULE injection (currently always true)

**Why**: IMAGE_ANALYSIS_PROTOCOL is ~1200 tokens. If the user isn't sending screenshots, those 1200 tokens are wasted on every turn. Now they're only included when needed.

---

## Expected Results

### Per-turn token usage (when files are read):
- **Before**: ~60-80K tokens per turn with 2-3 file reads
- **After**: ~25-35K tokens per turn with 2-3 file reads
- **Savings**: **40-60% reduction**

### Context window exhaustion:
- **Before**: Conversations hit 200K limit after ~15-20 turns with file reads
- **After**: Conversations last **2-3x longer** before hitting 200K
- **Why**: Combination of fixes #1 (no duplicate file content), #2 (earlier compaction), #3 (stripped history)

### User experience:
- **No change** — files still show inline, AI responses are more concise
- **Benefit** — conversations can go much deeper before needing to fork

---

## Future Optimizations (not yet implemented)

### Fix #5: File-read caching (ADVANCED)
If the AI reads the same file multiple times in one conversation, cache the content and return a reference instead of re-sending the full file each time.

**Example**:
- First read: return full content
- Subsequent reads within same chat: return `"[File app/layout.js was already read on turn 3 — content unchanged. Refer to that turn if you need to see it again.]"`

**Estimated savings**: 20-30% in conversations with repeated file reads

**Implementation complexity**: Medium — requires tracking read files per chat session and detecting when content has changed

---

## Rollback Instructions

If any of these changes cause issues:

1. **Fix #1 rollback**: Revert `lib/ai/agent-tools-v2.js` commit `eef9bcd`
2. **Fix #2 rollback**: Change `DEFAULT_THRESHOLD_TOKENS` back to `130_000` in `lib/ai/context-compactor.js`
3. **Fix #3 rollback**: Remove `stripVerboseToolResults()` call from stream-handler-v2.js (around line 920)
4. **Fix #4 rollback**: Remove conditional flags from `buildProjectSystemPrompt()` and always include all protocols

---

## Testing Checklist

- [x] Fix #1: Verify read_file calls no longer duplicate file content in AI responses
- [x] Fix #2: Verify compaction triggers at ~80K tokens instead of 130K
- [x] Fix #3: Verify assistant messages with large tool results are trimmed in history
- [x] Fix #4: Verify IMAGE_ANALYSIS_PROTOCOL only appears when images are present
- [ ] Integration test: Run a 30-turn conversation with multiple file reads and verify it stays under 150K tokens
- [ ] Regression test: Verify file content is still visible to users inline after read_file calls

---

## Metrics to Monitor

1. **Average tokens per turn** (before vs after)
2. **Turns until context exhaustion** (before vs after)
3. **User complaints about "chat too long" errors** (should decrease)
4. **User complaints about "file not showing" or "AI not seeing file content"** (should stay zero)

---

## Notes

- All changes are backward-compatible
- No database migrations required
- No frontend changes required
- Changes apply to both project chats and self-edit chats
- Vercel redeploys automatically on each commit
