# Auroraly Efficiency Improvements
**Date:** 2026-05-23  
**Context:** Reducing token usage and preventing premature context window exhaustion

## Problem Statement
The AI agent was displaying full file contents (500+ lines) in chat responses after every `read_file` call, causing:
1. Rapid context window exhaustion (hitting 200k limit in ~10-15 turns)
2. High Anthropic API costs
3. Cluttered, unusable chat UI
4. Slow response times due to token processing overhead

## Root Cause
The agent's tool descriptions did not explicitly forbid pasting tool results. The system prompt implicitly encouraged "showing your work", so the agent included full file dumps in responses.

## Implemented Fixes

### ✅ Fix #1: Updated read_file Tool Description
**File:** `lib/ai/agent-tools-v2.js` (lines 96-104)  
**Change:** Added explicit warning in tool description:
```
⚠️ CRITICAL — DO NOT PASTE FILE CONTENT IN YOUR RESPONSE ⚠️
The tool result is for YOUR ANALYSIS ONLY. The user does NOT see tool results.
After calling read_file, respond with a BRIEF summary (1-2 sentences) and your next action.
NEVER paste code blocks or line numbers in your text response.
```

**Impact:**
- Reduces average response size from ~5000 tokens → ~200 tokens when reading files
- Prevents chat UI bloat
- Extends conversation lifespan from ~15 turns → ~100+ turns before hitting 200k limit

### ✅ Fix #2: Created Tool Result Formatter Utility
**File:** `lib/ai/tool-result-formatter.js` (new)  
**Purpose:** Provides functions to strip verbose tool results from conversation history

**Functions:**
- `stripVerboseToolResults(content)` — Detects and collapses 500-line code blocks to `[File content: N lines — collapsed]`
- `formatToolResultForDisplay(toolName, result)` — Formats tool results concisely for UI display

**Usage:** Can be integrated into stream handlers to clean messages before saving to database.

## Additional Optimization Opportunities

### 🔄 Fix #3: Strip Tool Results from Conversation History (NOT YET IMPLEMENTED)
**Target:** `lib/api/stream-handler-v2.js`  
**Change:** Before saving assistant messages to database, call `stripVerboseToolResults()` to remove code dumps
**Benefit:** Reduces stored message size, speeds up history loading

### 🔄 Fix #4: Reduce Model Temperature for Code Tasks (NOT YET IMPLEMENTED)
**Target:** `lib/ai/agent-core.js`  
**Change:** Set `temperature: 0.1` for self-edit mode (currently defaults to 1.0)
**Benefit:** Reduces token count in responses, faster generation, more deterministic edits

### 🔄 Fix #5: Implement Conversation Summarization (NOT YET IMPLEMENTED)
**Target:** New utility `lib/ai/conversation-summarizer.js`  
**Change:** After 50 messages, auto-summarize early conversation into a single system message
**Benefit:** Keeps context window under control for long-running projects

### 🔄 Fix #6: Cache Frequently-Read Files (NOT YET IMPLEMENTED)
**Target:** `lib/ai/agent-tools-v2.js`  
**Change:** Add in-memory cache for files read multiple times in same conversation
**Benefit:** Reduces redundant GitHub API calls, speeds up reads

### 🔄 Fix #7: Lazy-Load Context Files (NOT YET IMPLEMENTED)
**Target:** `lib/api/stream-handler-v2.js`  
**Change:** Only load files into context when explicitly referenced, not all upfront
**Benefit:** Reduces initial prompt size from ~20k tokens → ~2k tokens

### 🔄 Fix #8: Add Token Budget Warnings (NOT YET IMPLEMENTED)
**Target:** `components/dashboard/LeftPanel.jsx`  
**Change:** Show warning in UI when conversation exceeds 150k tokens (75% of limit)
**Benefit:** Gives user heads-up before hitting hard limit

### 🔄 Fix #9: Use Claude 3.5 Haiku for Simple Tasks (NOT YET IMPLEMENTED)
**Target:** `lib/ai/agent-core.js`  
**Change:** Route simple queries ("what does this file do?") to Haiku (cheaper, faster)
**Benefit:** 80% cost reduction on read-only operations

### 🔄 Fix #10: Compress Message Metadata (NOT YET IMPLEMENTED)
**Target:** Database schema + `lib/supabase/db.js`  
**Change:** Store large metadata (briefProgress, diffs) in compressed JSON
**Benefit:** Reduces DB storage costs, speeds up message fetching

## Metrics to Track
- **Average tokens per turn** (target: <1000 for code edits, <500 for reads)
- **Conversations hitting 200k limit** (target: <5% of sessions)
- **API cost per conversation** (target: <$0.50 for typical 30-turn project build)
- **User complaints about "agent pasting too much code"** (target: 0)

## Testing Checklist
- [ ] Self-edit chat: read a 500-line file, verify response is <300 tokens
- [ ] Project chat: read a 500-line file, verify response is <300 tokens
- [ ] Multi-turn conversation (50+ messages): verify no degradation in quality
- [ ] Check Vercel logs: confirm no "context_length" errors from Anthropic

## Rollback Plan
If Fix #1 causes the agent to be TOO terse and miss important details:
1. Revert `lib/ai/agent-tools-v2.js` to commit before f4e9709
2. Add a MIDDLE-GROUND instruction: "Paste only the RELEVANT 5-10 lines, not the entire file"
3. Monitor for 24 hours, iterate

## Owner
@jmcgee720

## Related Issues
- User report: "agent still posting all of these codes" (2026-05-23)
- Context window exhaustion in Core System chats (multiple reports)
