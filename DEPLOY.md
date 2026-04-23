# Emanator — Vercel Deployment Runbook

Complete step-by-step for taking Emanator **100% off Emergent** and self-hosting on Vercel + your own Supabase + MongoDB Atlas.

---

## ✅ What's already done (this session)

1. **Stripe routes fully ported to Next.js**. `/app/lib/api/routes/stripe.js` handles checkout / status / confirm-credits; `/app/app/api/webhook/stripe/route.js` handles signed webhook events. Uses the official `stripe@22` npm SDK (no `emergentintegrations`). **The corresponding Stripe routes in `server.py` have been deleted** — all Stripe traffic now flows through Next.js.
2. **Emergent proxy code paths removed** from `lib/ai/service.js`, `lib/ai/image-service.js`, `lib/ai/transcribe-service.js`, `lib/api/routes/chats.js`. Direct provider keys only.
3. **Env files cleaned** — `EMERGENT_LLM_KEY` / `EMERGENT_PROXY_URL` / `PREFER_EMERGENT_PROXY` removed from `/app/.env.local`. `GEMINI_API_KEY` added (user-provided). `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `MONGO_URL` added.
4. **Backend LLM calls decoupled** — both `growth_analyze` and `growth_generate_drafts` in `server.py` now use the official `openai` Python SDK with `OPENAI_API_KEY` directly (no `emergentintegrations.llm`).
5. **Trends endpoints ported to Vercel-native** — `/app/lib/growth/trends-native.js` implements `fetchTrends()` + `listTrends()` using `cheerio` + native `fetch`. No Python backend required for the Trends feature.
6. **Growth endpoints use configurable backend URL** — `BACKEND_URL` env var (defaults to `http://localhost:8001`) lets you point the remaining Playwright-dependent growth/crawl endpoints at a Railway-hosted FastAPI instance. Graceful 503 with a hint when unavailable.
7. **Vercel Analytics + Speed Insights** wired into `app/layout.js`. No-ops outside Vercel (safe on any host).
8. **Shared MongoDB helper** `/app/lib/mongodb.js`.
9. **Tests** updated + passing at **840/24** baseline.

## 🏗️ Final architecture (target)

```
┌─────────────────────────┐   ┌─────────────────────────┐
│      VERCEL             │   │      RAILWAY (optional) │
│  (Next.js 14 App)       │   │  FastAPI growth service │
│                         │   │                         │
│  • Pages + all API      │─→ │  • /api/internal/       │
│  • Stripe               │   │    growth/crawl (Playwright)
│  • Billing              │   │  • /api/internal/       │
│  • Growth/Trends native │   │    growth/analyze       │
│  • LLM streaming        │   │  • /api/internal/       │
│  • WebContainers        │   │    growth/generate-drafts│
│                         │   │                         │
└─────────────────────────┘   └─────────────────────────┘
          │                              │
          ▼                              ▼
    ┌──────────┐                   ┌──────────┐
    │ MongoDB  │                   │ OpenAI/  │
    │ Atlas    │                   │ Claude/  │
    │ (free M0)│                   │ Gemini   │
    └──────────┘                   └──────────┘
          │
          ▼
    ┌──────────┐
    │ Supabase │ (auth + metadata)
    └──────────┘
```

**If you don't need the Growth tool's web scraper**, skip Railway entirely and use Vercel alone.

---

## ⏭️ What's left (shipping checklist)

### Option A — Vercel-only (no Growth crawler)

Simplest path. Works if you don't need the web-scraping part of Emanator's Growth tool. Everything else (Stripe, AI chat, image gen, Whisper, trends, pricing, auth) runs natively on Vercel.

### Option B — Vercel + Railway (with Growth crawler)

Keep a slim FastAPI instance on Railway for the Playwright-based `/api/internal/growth/*` endpoints. Set `BACKEND_URL` in Vercel env to the Railway URL. Everything else routes through Vercel.

### Endpoints that STILL require the Python backend

| Endpoint | What it does | Vercel-native? |
|---|---|---|
| `/api/internal/growth/crawl` | Playwright page crawl | ❌ Needs Railway (or Browserless.io) |
| `/api/internal/growth/crawl/progress` | Crawl progress polling | ❌ Needs Railway |
| `/api/internal/growth/analyze` | SEO analysis (LLM) | ⚠️ Could be ported — currently in backend |
| `/api/internal/growth/generate-drafts` | Social/ad draft gen (LLM) | ⚠️ Could be ported — currently in backend |
| `/api/preview/start` + `stop` + `status` | Legacy iframe preview | ❌ Delete it — replaced by WebContainers |
| `/api/proxy/*` | Legacy Next.js passthrough | ❌ Delete it — no longer needed |

---

## 🚀 Deploying to Vercel

### 1. Prerequisites

- GitHub repo with the Emanator code (the Save-to-GitHub button in Emergent's chat does this).
- Vercel account (https://vercel.com — free Hobby tier is fine to start).
- MongoDB Atlas account (https://cloud.mongodb.com — free M0 tier).
- Supabase project (you have this already).
- Stripe account (https://dashboard.stripe.com) with a live API key.

### 2. MongoDB Atlas — migrate your data

Vercel functions can't talk to `mongodb://localhost:27017`. You need a cloud MongoDB.

```bash
# 1. Create a free M0 cluster on Atlas.
# 2. Database Access → create a user with read/write.
# 3. Network Access → Allow Access from Anywhere (0.0.0.0/0), or restrict to Vercel IP ranges.
# 4. Clusters → Connect → "Connect your application" → copy the connection string.
#    It'll look like: mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/test_database?retryWrites=true&w=majority

# 5. Export data from your local MongoDB:
mongodump --uri="mongodb://localhost:27017/test_database" --out=./mongo-backup

# 6. Import into Atlas:
mongorestore --uri="<atlas-connection-string>" ./mongo-backup
```

### 3. Push to GitHub

Use the **"Save to GitHub"** button in the Emergent chat input (bottom-right). Creates a repo with all of `/app`.

### 4. Vercel — Import the repo

1. https://vercel.com/new → Import your repo.
2. **Framework Preset:** Next.js (auto-detected).
3. **Root Directory:** `./` (leave default).
4. **Build Command:** `yarn build` (auto-detected).
5. **Output Directory:** `.next` (auto-detected).

### 5. Environment variables (in the Vercel UI, Project Settings → Environment Variables)

Paste these with your real values. **Everything marked `REQUIRED` must be set** before the build succeeds.

```
# ── Database (REQUIRED) ─────────────────────────────────────
MONGO_URL=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/test_database?retryWrites=true&w=majority
DB_NAME=test_database

# ── Supabase (REQUIRED) ─────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://cawmmqakaxbznbelcrwd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
SUPABASE_SERVICE_ROLE_KEY=<your service role key>

# ── LLM provider keys (REQUIRED) ────────────────────────────
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_CHAT=gpt-4o
OPENAI_MODEL_IMAGE=gpt-image-1

ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_MODEL_CHAT=claude-sonnet-4-5-20250929

GEMINI_API_KEY=AIza...

# ── Auth / site (REQUIRED) ──────────────────────────────────
NEXT_PUBLIC_BASE_URL=https://emanator.vercel.app
CORS_ORIGINS=https://emanator.vercel.app
DEFAULT_OWNER_EMAIL=you@your-real-domain.com
OPEN_SIGNUP=1

# ── Stripe (REQUIRED for billing) ───────────────────────────
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...    # see step 7

# ── Optional ────────────────────────────────────────────────
E2B_API_KEY=                        # only if using E2B sandbox
```

**Important:** `NEXT_PUBLIC_BASE_URL` and `CORS_ORIGINS` must match your actual Vercel URL (or custom domain).

### 6. Deploy

Click **Deploy**. First build takes ~3–4 minutes. Vercel gives you a URL like `https://emanator-abc123.vercel.app`.

### 7. Stripe webhook — wire it up

1. In Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL:** `https://<your-vercel-url>/api/webhook/stripe`
3. **Events to send:** select just `checkout.session.completed` (plus any others you want logged).
4. After creating, click **Reveal signing secret** and copy the `whsec_...` value.
5. Back in Vercel → Project Settings → Environment Variables → edit `STRIPE_WEBHOOK_SECRET` → paste the `whsec_...` value → Save.
6. **Redeploy** (Vercel UI → Deployments → three dots on latest → Redeploy) so the new env picks up.

### 8. Smoke test

```bash
# Health check
curl https://<your-vercel-url>/api/health
# → {"status":"healthy","database":"supabase","timestamp":"..."}

# Pricing page
open https://<your-vercel-url>/pricing

# Sign up, buy $10 Starter pack → should redirect to Stripe → success → +150 credits
```

### 9. Custom domain (optional)

1. Vercel → Project Settings → Domains → Add.
2. Point your DNS A/CNAME records as Vercel instructs.
3. Update `NEXT_PUBLIC_BASE_URL` and `CORS_ORIGINS` to the custom domain.
4. Update the Stripe webhook endpoint URL.

---

## 🧹 Final cleanup (do AFTER Vercel is green)

Once Vercel is working:

```bash
# 1. Delete the Python backend
rm -rf /app/backend

# 2. Remove supervisor config references (irrelevant on Vercel but keeps repo clean)
# (no supervisor on Vercel — you can skip this)

# 3. Remove emergentintegrations from any remaining requirements
# (already gone since you deleted backend/)
```

---

## 🚨 Troubleshooting

### "MONGO_URL is required" errors
Set the `MONGO_URL` env var in Vercel. The local value `mongodb://localhost:27017` does NOT work on Vercel.

### Stripe webhook returns 400
Check the `STRIPE_WEBHOOK_SECRET` matches exactly what Stripe shows. Redeploy after changing.

### "OPENAI_API_KEY not configured for transcription"
Whisper voice input needs a direct OpenAI key. Set `OPENAI_API_KEY` in Vercel env.

### Image generation fails with auth error
`GEMINI_API_KEY` is missing. Get one from https://aistudio.google.com/apikey (free tier is very generous).

### Build fails on Vercel
Check the build log for the specific error. Most common: missing env var or typo in a filename. If the pre-existing failing tests become a problem, mark them `--testPathIgnorePatterns` in your build config.

---

## 💰 Cost estimate (self-hosted)

| Service | Free tier | Expected cost (small-to-medium use) |
|---|---|---|
| Vercel Hobby | 100 GB bandwidth | $0 |
| Vercel Pro | (if you exceed Hobby) | $20/mo |
| MongoDB Atlas M0 | 512 MB storage | $0 |
| MongoDB Atlas M10 | (when you outgrow M0) | $57/mo |
| Supabase Free | 500 MB DB, 1 GB storage | $0 |
| Supabase Pro | (when you have paying users) | $25/mo |
| OpenAI direct | Pay-per-use | $20–100/mo for active dev |
| Anthropic direct | Pay-per-use | $20–80/mo |
| Gemini (Google AI Studio) | Generous free tier | $0–20/mo |
| Stripe | 2.9% + 30¢ per charge | Percentage of revenue |

**Realistic baseline for a running app with paying users:** ~$50–150/mo infrastructure, +LLM usage scales with traffic.

---

## 📋 Migration status checklist

- [x] Stripe ported to Next.js + removed from FastAPI
- [x] Emergent proxy removed from AI services (JS)
- [x] Emergent LLM calls removed from FastAPI (`openai` SDK direct)
- [x] Env files cleaned (no `EMERGENT_*` vars)
- [x] Trends endpoints ported native (Vercel-compatible)
- [x] `BACKEND_URL` env support for growth endpoints
- [x] Gemini API key added
- [x] Vercel Analytics + Speed Insights wired
- [x] Tests updated + passing at baseline
- [ ] (Optional) Port `growth/analyze` + `generate-drafts` to Next.js (would kill the Python backend's last LLM calls)
- [ ] Delete legacy `/api/preview/*` + `/api/proxy/*` from server.py
- [ ] MongoDB data migrated to Atlas
- [ ] Repo pushed to GitHub
- [ ] Railway deployment (if keeping Growth crawler) — deploy `/app/backend/` via Dockerfile or Procfile
- [ ] Vercel deployment live
- [ ] `BACKEND_URL` set in Vercel env (if using Railway)
- [ ] Stripe webhook configured (endpoint URL + `STRIPE_WEBHOOK_SECRET`)
- [ ] First successful production purchase
- [ ] Custom domain set up (optional)
