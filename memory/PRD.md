# Emanator PRD — Self-Sufficient Agent Platform

## Creative Brief Pipeline (Overhauled 2026-04-16)
### Fast Path Architecture
- `isBriefBuild` detected → skip ALL plan validators, task mode gates, intent classifiers
- Focused system prompt → `chatWithToolsStream` with `tool_choice: create_files` → save → done
- Single file: `app/page.jsx` with all components inline
- No cross-file imports, no react-router, no React imports

### Creative Brief Form (Overhauled)
- Primary Goal: free-text input (was dropdown)
- Tone of Voice: free-text input (was dropdown)
- Budget/Scope: free-text input (was dropdown)
- Most Important Page: free-text input (was dropdown)
- Media Bin → renamed "Art Direction" with design guidance description
- Button: "Build Project" (was "New Project")
- `buildPromptFromBrief()` passes ALL details with explicit labels

### System Prompt
- Enforces brand name throughout UI
- Mandatory design patterns: SVG logo, glassmorphism navbar, gradient headline, pill badge, glass cards, CTA glow buttons, glow orbs, grid layouts
- 800-1200 lines target, dark base, Tailwind only

## E2E Test Result (Aurora Growth)
- Brand: "Aurora Growth" ✓
- Nav: Dashboard, Features, Pricing, Login ✓
- Headline: "Scale your growth" in violet gradient ✓
- Messaging from brief reflected in UI ✓
- Dark theme, glassmorphism, glow effects ✓
- Single file, renders immediately in preview ✓

## All Fixes This Session
1. canvasUpdated scoping crash
2. resolveTaskMode → 'build' default
3. Tightened INSPECT_MODE + READ_ONLY patterns
4. Rewrote self-edit system prompt
5. Fixed read_files outputs → search_replace
6. Preview: lazy wrapper pre-registration + null fallback
7. Preview: SVG/CSS/asset import handling
8. Preview: disabled stale snapshot cache
9. Force tool_choice for build-question messages
10. Expanded broken promise detector
11. Creative Brief fast-path pipeline (complete rewrite)
12. Creative Brief form overhaul (dropdowns → text inputs)
13. buildPromptFromBrief → comprehensive with all fields
14. Dashboard.jsx hooks extraction (1911→1690 lines)

## P1 Backlog
- message-stream.js: extract tool dispatch handlers (~1200 lines)

## P2 Backlog
- search_replace robustness, snapshot cache with versioning
