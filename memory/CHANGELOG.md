# Changelog

## 2026-02 (Previous Sessions)
- Dashboard UI anomalies fixed
- `service.js` Phase 2 refactoring
- Site Monitor feature
- Deploy Tab (ZIP, Vercel, Netlify)
- Share Public Preview Link
- Project Templates Gallery
- Next.js OOM Memory Fix
- Testing: iterations 57-60, all passed

## 2026-04-07 - Final Feature Batch
### Template Marketplace
- New `/api/marketplace` routes: list, publish, clone, delete
- Uses Supabase snapshots table with `__marketplace__` prefix
- NewProjectModal component with Templates/Marketplace/Publish tabs
- Community templates with clone count tracking

### Share Link Expiry Settings
- Added `expires_in` parameter to share creation (1h/24h/7d/30d/never)
- Expiry validation in public GET endpoint (returns 410 for expired links)
- Expiry picker dropdown in RightPanel share flow
- `is_expired` field in shares list endpoint

### Deployment Status Polling
- New `GET /api/projects/:id/deployments/:id/status` endpoint
- Proxies to Vercel/Netlify APIs for live build state
- Auto-polls every 5s in DeployTab until terminal state
- Status badges: QUEUED/BUILDING/READY/ERROR

### Cron-based Scheduled Auto-Crawl
- `scripts/cron-worker.js` background worker (5-min polling)
- `GET/POST /api/growth/monitors/schedule` config endpoints
- Schedule stored in MongoDB `monitor_schedules` collection
- GrowthPanel UI: toggle + frequency selector (6h/12h/24h/48h/7d)
- Auto-updates baseline and detects degradations

### Testing: iteration 61 - 8/8 backend tests passed, all frontend components verified
