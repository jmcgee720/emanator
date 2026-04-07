# Emanator AI Builder — PRD

## Product Overview
Conversational AI builder allowing users to generate, preview, and deploy React-based web applications through natural language conversation.

## Core Architecture
- **Framework**: Next.js 14 App Router
- **Frontend**: Custom dashboard with glassmorphism UI (`.em-glass`)
- **Backend**: AI orchestrator with modular architecture (service.js → message-stream.js, plan-executor.js, message-processor.js, prompt-builder.js, image-generation.js, canvas-ops.js, file-operations.js, context-loader.js)
- **Database**: Supabase (PostgreSQL)
- **Integrations**: OpenAI/Anthropic (via Emergent LLM Key), Stripe, Unsplash

## Completed Features
- Live streaming preview with postMessage incremental updates
- Dark Aurora skeleton loading state during builds
- 6 regression guardrails (blank preview, tool call enforcement, etc.)
- AI Art Director pipeline for curated imagery
- Creative Brief Cards & Enhancement Suggestion Chips
- Growth Panel: SEO analysis, CSV/JSON export, One-Click SEO Fixes, Build Better Version, Persona analysis, Batch crawl, Site Map view
- Site Monitor: Auto-crawl tracking, change detection (baseline comparison), counter-move suggestions, Check All Monitors bulk action
- Visual Quality Prompt Overhaul (Tailwind, glass-morphism, Unsplash in prompts)
- Glassmorphism UI redesign for workspace
- Dashboard UI: pill-style navigation tabs (Projects | Core System | + New Project)
- service.js Refactoring: 2627 → 318 lines (extracted 3 major methods into modules)
- Deploy Tab: Real Download ZIP (JSZip) + Vercel deploy with user-provided token + Deployment history
- **Share Public Preview Link**: Snapshot project files into a shareable URL, public preview page at /share/:token with iframe rendering, code view toggle, view counter, copy-to-clipboard. Share button in project workspace toolbar.

## Pending / Backlog
- P2: Netlify deploy integration
- P2: Scheduled weekly auto-crawl for monitors (cron)
- Known: Next.js OOM memory thrashing (mitigated via supervisor restart)
