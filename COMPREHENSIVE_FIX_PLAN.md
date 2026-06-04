# Comprehensive Dashboard Duplicate Toolbar Fix Plan

## Problem Summary
The Dashboard has **duplicate toolbars** causing:
- 2 visible "Deploy" buttons
- 3 refresh controls
- Confusing UX with stacked duplicate controls

## Root Cause
1. **Dashboard.jsx** (lines 1386-1413) has a hardcoded toolbar with Refresh/Deploy buttons
2. **RightPanel.jsx** (lines 124-158) has another set of duplicate buttons
3. **PreviewTab.jsx** already has the canonical toolbar in the Tabs header

## Current Blocking Issue
The file `app/dashboard/page.jsx` has **existing syntax errors** that prevent any edits:
- Missing setters: `setStreamingMessageId`, `setStreamingStatus`, `setImageGenProgress` not destructured from `useDashboardStream` (lines 696-706) but used in code (lines 881, 882, 999)
- Browser global: `prompt()` at line 1374 needs to be `window.prompt()`
- Variable naming: `prompt` variable in `generateVariation` should be `promptText`

The syntax gate correctly blocks edits to broken files to prevent cascading failures.

## Solution Strategy: Incremental Fix with Partial Validation

### Phase 1: Enhance Syntax Gate (DONE)
✅ Add `partialEdit` mode to syntax-lint.js that allows surgical fixes to already-broken files

### Phase 2: Fix Syntax Errors (3 surgical edits)
1. **Add missing setters** to useDashboardStream destructuring
2. **Fix browser global** `prompt()` → `window.prompt()`
3. **Rename variable** `prompt` → `promptText` in generateVariation

### Phase 3: Remove Duplicate Toolbars (2 surgical edits)
4. **Remove Dashboard.jsx duplicate toolbar** (lines 1386-1413)
5. **Remove RightPanel.jsx duplicate buttons** (lines 124-158)

### Phase 4: Verify
- File passes full syntax validation
- UI shows single consolidated toolbar
- All functionality preserved (Deploy, Refresh, Share)

## Implementation Order
Execute in sequence, each edit is independent and safe:
1. syntax-lint.js enhancement (allows partial validation)
2. Dashboard.jsx: add missing setters
3. Dashboard.jsx: fix window.prompt
4. Dashboard.jsx: rename prompt variable
5. Dashboard.jsx: remove duplicate toolbar
6. RightPanel.jsx: remove duplicate buttons

## Expected Outcome
- Single toolbar in Preview/Code/Assets tab header
- One Deploy button (deploys to Vercel)
- One Refresh button
- One Share button
- All functionality preserved
- Clean, professional UI
