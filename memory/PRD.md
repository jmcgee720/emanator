# Emanator AI Builder — PRD

## Product Overview
Conversational AI builder allowing users to generate, preview, and deploy React-based web applications through natural language conversation.

## Core Architecture
- **Framework**: Next.js 14 App Router
- **Frontend**: Custom dashboard with glassmorphism UI (`.em-glass`)
- **Backend**: AI orchestrator with modular architecture (service.js → 5 extracted modules)
- **Database**: Supabase (PostgreSQL)
- **Integrations**: OpenAI/Anthropic (via Emergent LLM Key), Stripe, Unsplash

## Completed Features
- Live streaming preview with postMessage incremental updates
- Dark Aurora skeleton loading state during builds
- 6 regression guardrails (blank preview, tool call enforcement, etc.)
- AI Art Director pipeline for curated imagery
- Creative Brief Cards & Enhancement Suggestion Chips
- Growth Panel: SEO analysis, CSV/JSON export, One-Click SEO Fixes, Build Better Version, Persona analysis, Batch crawl, Site Map view
- Site Monitor: Auto-crawl tracking, change detection (baseline comparison), counter-move suggestions, Check All Monitors bulk action, Batch check-all endpoint
- Visual Quality Prompt Overhaul (Tailwind, glass-morphism, Unsplash in prompts)
- Glassmorphism UI redesign for workspace
- Dashboard UI: pill-style navigation tabs (Projects | Core System | + New Project)
- service.js Refactoring: 2627 → 318 lines
- Deploy Tab: Download ZIP (JSZip) + Vercel deploy + **Netlify deploy** + Deployment history
- Share Public Preview Link: /share/:token with iframe rendering, code view, view counter
- **Project Templates**: 5 pre-built starters (Landing Page, Portfolio, SaaS Dashboard, Blog, E-Commerce) with one-click clone
- **OOM Memory Fix**: Increased heap from 512MB → 2048MB, enabled filesystem cache, optimized watch options

## Tech Stack
- Next.js 14, React, Tailwind CSS, Supabase, JSZip, file-saver
- AI: OpenAI/Anthropic via Emergent LLM Key
- Payments: Stripe via Emergent Test Key
