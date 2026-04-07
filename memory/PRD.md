# Emanator AI Builder — PRD

## Product Overview
Conversational AI builder allowing users to generate, preview, and deploy React-based web applications through natural language conversation.

## Core Architecture
- **Framework**: Next.js 14 App Router
- **Frontend**: Custom dashboard with glassmorphism UI (`.em-glass`)
- **Backend**: AI orchestrator with modular architecture (service.js refactored into message-stream.js, plan-executor.js, message-processor.js, prompt-builder.js, image-generation.js, canvas-ops.js, file-operations.js, context-loader.js)
- **Database**: MongoDB/Supabase
- **Integrations**: OpenAI/Anthropic (via Emergent LLM Key), Stripe, Unsplash

## Completed Features
- Live streaming preview with postMessage incremental updates
- Dark Aurora skeleton loading state during builds
- 6 regression guardrails (blank preview detection, tool call enforcement, etc.)
- AI Art Director pipeline for curated imagery
- Creative Brief Cards & Enhancement Suggestion Chips
- Growth Panel: SEO analysis, CSV/JSON export, One-Click SEO Fixes, Build Better Version, Persona-based analysis, Batch crawl, Site Map view
- **Site Monitor**: Auto-crawl tracking, change detection (baseline comparison), counter-move suggestions (P1 Growth feature)
- Visual Quality Prompt Overhaul (Tailwind, glass-morphism, Unsplash in prompts)
- Glassmorphism UI redesign for workspace
- Dashboard UI cleanup: removed Self-Builder badge, removed broken tab bar, pill-style navigation tabs
- service.js Phase 2 refactoring: 2627 → 318 lines (extracted processMessageStream, executePlanStream, applyDiffs, processMessage)

## Pending / Backlog
- P2: Deploy integration (Vercel/Netlify) — currently mocked
- P2: Further service.js cleanup (remaining delegated helpers)
- Known: Next.js OOM memory thrashing (mitigated via supervisor restart)
