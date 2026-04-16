# Emanator PRD — Self-Sufficient Agent Platform

## Architecture
```
/app/lib/ai/
├── message-stream.js    # Core Agent Loop (~3720 lines, reduced from 3815)
├── tool-handlers.js     # Extracted handlers: read_files, verify_build, exec_command, 
│                        # screenshot_verify, update_memory, update_canvas, delete_files,
│                        # plan_project, summarize_project (227 lines)
├── intents.js           # Intent classification + task mode detection
├── tools.js             # AI tool definitions
├── prompt-builder.js    # System prompt templates
├── plan-validator.js    # Plan validation
├── message-helpers.js   # Extracted helpers
├── tool-executor.js     # Tool utility functions
/app/lib/e2b/
├── agent-tools.js       # search_replace (3-level fallback), edit_lines, read_files
/app/components/dashboard/
├── Dashboard.jsx        # Main workspace (~1690 lines, from 3333)
├── useDashboardProject.js
├── useDashboardStream.js
├── useSandboxOps.js     # Extracted sandbox operations
├── useMediaBin.js       # Extracted media bin operations
├── InlineBrief.jsx      # Creative Brief form (overhauled)
├── tabs/PreviewTab.jsx  # Preview renderer
```

## Creative Brief Pipeline
- Fast path: bypass all plan/validate/intent machinery
- Single file architecture (`app/page.jsx`)
- Form: all text inputs (no dropdowns), Art Direction for brand assets
- System prompt with mandatory design patterns

## search_replace Robustness (3-level fallback)
1. Exact match (primary)
2. Trailing whitespace normalized
3. Indentation-tolerant (strip leading whitespace per line)

## All Completed Work (2026-04-16)
1. canvasUpdated scoping crash fix
2. resolveTaskMode → 'build' default
3. Tightened INSPECT_MODE + READ_ONLY patterns
4. Rewrote self-edit system prompt (clear tool hierarchy)
5. Fixed read_files outputs → search_replace
6. Preview: lazy wrapper pre-registration + null fallback
7. Preview: SVG/CSS/asset import handling
8. Preview: disabled stale snapshot cache
9. Force tool_choice for build-question messages
10. Expanded broken promise detector
11. Creative Brief fast-path pipeline (complete rewrite)
12. Creative Brief form overhaul (dropdowns→text, Art Direction)
13. Tool handler extraction (9 handlers → tool-handlers.js)
14. search_replace indentation-tolerant fallback
15. Dashboard.jsx hooks extraction (useSandboxOps + useMediaBin)
