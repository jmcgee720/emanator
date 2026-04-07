# Emanator AI Builder - PRD

## Original Problem Statement
Build a conversational AI builder platform (Emanator) with a full-featured dashboard for creating, managing, and deploying AI-powered projects. Includes live preview, growth analytics, deployment integration, project templates, community marketplace with ratings, and scheduled auto-crawl.

## Core Architecture
- **Frontend**: Next.js 14 App Router on port 3000
- **Backend**: Custom API dispatcher in `app/api/[[...path]]/route.js`
- **Database**: Supabase (primary), MongoDB (growth/monitors)
- **Auth**: Supabase auth (cookie-based)
- **Integrations**: OpenAI/Anthropic (Emergent LLM Key), Stripe, Vercel, Netlify

## Feature Status

### Completed Features
- [x] Dashboard UI with glassmorphism Aurora theme
- [x] Conversational AI builder with streaming
- [x] Live preview with Babel inline transpilation
- [x] Preview skeleton loading state + regression guardrails
- [x] Service.js modular refactoring
- [x] Site Monitor (Growth Panel auto-crawl)
- [x] Deploy Tab (ZIP, Vercel, Netlify)
- [x] Share Public Preview Link
- [x] Next.js OOM Memory Fix
- [x] **Template Marketplace** (publish/clone/delete)
- [x] **Marketplace Ratings & Reviews** (1-5 stars, text comments, avg rating display)
- [x] **25 Project Templates** (5 per category: Marketing, Business, Personal, Content, Commerce)
- [x] **Template Category Filter** (filter by all/Marketing/Business/Personal/Content/Commerce)
- [x] **Template Flow Fix** (creating from template now populates files correctly)
- [x] **Share Link Expiry Settings** (1h/24h/7d/30d/never)
- [x] **Deployment Status Polling** (live Vercel/Netlify build progress)
- [x] **Cron-based Scheduled Auto-Crawl** (6h/12h/24h/48h/7d)

### Template Categories (25 total)
**Marketing** (5): SaaS Landing, Product Launch, Agency Site, Newsletter Landing, App Download
**Business** (5): Admin Dashboard, CRM Lite, Invoice Generator, Project Tracker, Analytics Dashboard
**Personal** (5): Dev Portfolio, Creative Portfolio, Resume/CV, Link-in-Bio, Personal Blog
**Content** (5): Blog Platform, Docs Site, Recipe Collection, Podcast Landing, Course Platform
**Commerce** (5): Storefront, Digital Products, Restaurant Menu, Booking System, Marketplace

### Key API Endpoints
- `POST /api/chat/stream` - AI streaming
- `GET/POST /api/projects` - Project CRUD
- `GET/POST /api/marketplace` - Community templates
- `POST /api/marketplace/publish` - Publish template
- `POST /api/marketplace/:id/clone` - Clone template
- `POST /api/marketplace/:id/reviews` - Add review
- `GET /api/marketplace/:id/reviews` - Get reviews
- `GET/POST /api/share` - Share links with expiry
- `GET /api/shared/:token` - Public preview (with expiry check, returns 410 if expired)
- `POST /api/deployments` - Deploy to Vercel/Netlify
- `GET /api/projects/:id/deployments/:id/status` - Poll deploy status
- `GET/POST /api/growth/monitors/schedule` - Auto-crawl config

### Key DB Schema
- `projects` - User projects
- `snapshots` - Shared previews (`__share__`), marketplace templates (`__marketplace__`)
- `chats`, `messages` - Conversation history
- `project_files` - Project code files
- `deployments` - Deploy records with `findById`, `updateStatus` methods
- `growth_monitors` (MongoDB) - Site monitors
- `monitor_schedules` (MongoDB) - Auto-crawl config

## Backlog
- App is feature-complete for current roadmap. No remaining tasks.
