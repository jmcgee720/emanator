# Preview Context Enhancement — 2026-05-23

## Problem
Project chats didn't know:
- What the preview window is (live iframe)
- What framework/type the project uses
- How to diagnose blank previews or errors
- That they should ask for console output

This caused chats to be "dumb" when users reported preview issues — they'd guess instead of investigating.

## Solution

### 1. Framework Auto-Detection (`detectProjectFramework`)
**Location**: `lib/api/stream-handler-v2.js` (new function before `buildProjectSystemPrompt`)

Inspects project files to identify:
- **React** (Next.js, Vite, CRA, custom)
- **Vue** (Nuxt, vanilla)
- **Svelte**
- **Angular**
- **Node.js** (Express, Fastify, generic)
- **Vanilla HTML/JS**
- **Unknown** (with fallback guidance)

Detection strategy:
1. Read `package.json` → parse dependencies
2. If no package.json, read `index.html` → check for ES modules
3. If neither, list files → infer from extensions (.jsx, .vue, .svelte)
4. Always returns something useful (never null/crash)

### 2. Enhanced System Prompt (`buildProjectSystemPrompt`)
**Location**: `lib/api/stream-handler-v2.js` (lines ~290-350)

**New sections added:**

#### A. PROJECT CONTEXT block
```
Framework/Type: React + Vite
Entry point: src/main.jsx or src/App.jsx
Architecture: Vite dev server with React. index.html loads the entry script.
```

#### B. WHAT YOU ARE BUILDING
Explains:
- The preview is a **live browser iframe**
- Changes hot-reload in 2-5 seconds
- The user is watching the preview while chatting
- **The preview IS the product** — changes must produce visible, working UI

#### C. Blank Preview Diagnostic Protocol
When user says "the preview is blank":
1. **ASK for console errors** (exact phrasing: "Open DevTools (F12) → Console tab. What errors do you see?")
2. **READ the entry file** (index.html, App.jsx, main.jsx) to verify structure
3. **CHECK common causes**: missing imports, typos, incorrect paths, missing deps
4. **NEVER guess** — always read actual file content first

#### D. Screenshot Protocol Integration
- Execute mandatory INVENTORY → COMPARISON → TRUTH-CHECK
- If console errors visible in screenshot, **read those exact error messages**
- If blank screen, **ask for console output** — never assume "it works"

### 3. Runtime Integration
**Location**: `lib/api/stream-handler-v2.js` (lines ~618-645, project mode branch)

Before building the system prompt:
```javascript
let projectContext = null
try {
  projectContext = await detectProjectFramework(projectFs)
} catch (e) {
  console.warn('[StreamV2] framework detection failed:', e?.message)
}

systemPrompt = buildProjectSystemPrompt({
  projectId: chat.project_id,
  projectName: project?.name,
  projectContext,  // ← NEW: passes detected framework info
})
```

Status event now includes framework:
```
Mode: project "My App" · React + Vite detected · all reads/writes go to project files
```

## Impact

**Before:**
- User: "The preview is blank"
- Agent: "I've updated the code, try refreshing" (no investigation)
- User: *sends screenshot showing console error*
- Agent: "Looks good!" (fabrication — didn't read the error)

**After:**
- User: "The preview is blank"
- Agent: "Open DevTools (F12) → Console tab. What errors do you see?"
- User: "Uncaught ReferenceError: React is not defined"
- Agent: *reads package.json, sees React is missing* → "React isn't in your dependencies. Adding it now…"

## Testing Checklist

- [ ] Create a new React + Vite project → verify prompt shows "React + Vite"
- [ ] Create a vanilla HTML project → verify prompt shows "Static HTML site"
- [ ] Create a project with no package.json or index.html → verify prompt shows "Unknown" with guidance
- [ ] Ask "the preview is blank" → verify agent asks for console errors (exact phrasing)
- [ ] Send a screenshot with console errors visible → verify agent reads the error text in the inventory
- [ ] Project with Next.js → verify prompt shows "Next.js (React)" and mentions file-based routing

## Files Changed
- `lib/api/stream-handler-v2.js` (+150 lines)
  - New: `detectProjectFramework()` function
  - Enhanced: `buildProjectSystemPrompt()` with preview context
  - Enhanced: Project mode initialization to call detection

## Rollout
- ✅ Committed to `main` (commits: 232058c, 356782a, b93640d)
- ⏳ Vercel auto-deploy in progress (~2 minutes)
- Next project chat will receive the enhanced prompt immediately
