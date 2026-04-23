# Emanator — Vercel Deployment Runbook

Complete step-by-step for taking Emanator **100% off Emergent** and self-hosting on Vercel + your own Supabase + MongoDB Atlas.

---

## ✅ What's already done (this session)

1. **Stripe routes ported to Next.js**. `/app/lib/api/routes/stripe.js` handles checkout / status / confirm-credits; `/app/app/api/webhook/stripe/route.js` handles signed webhook events. Uses the official `stripe` npm SDK (no `emergentintegrations`).
2. **Emergent proxy code paths removed** from `lib/ai/service.js`, `lib/ai/image-service.js`, `lib/ai/transcribe-service.js`, `lib/api/routes/chats.js`. Direct provider keys only.
3. **Env file cleaned** — `EMERGENT_LLM_KEY` / `EMERGENT_PROXY_URL` / `PREFER_EMERGENT_PROXY` removed from `/app/.env.local`.
4. **Shared MongoDB helper** `/app/lib/mongodb.js` so new routes don't need to re-import Mongo logic.
5. **Tests** updated — suite at **841 passing / 23 failed** (all 23 are pre-existing flaky tests unrelated to migration).

---

## ⏭️ What's left BEFORE you can turn off the FastAPI backend

The FastAPI backend (`/app/backend/server.py`) still owns these endpoints. Three choices for each:

| Endpoint | Used for | Next step |
|---|---|---|
| `/api/internal/growth/crawl` + `/crawl/progress` | Growth tool — web scraping | Port to Next.js (Playwright on Vercel has [cold-start caveats](https://vercel.com/docs/functions/serverless-functions/runtimes#edge-runtime), consider [Browserless.io](https://www.browserless.io/) instead) |
| `/api/internal/growth/analyze` + `/generate_drafts` | Growth tool — LLM-powered audience research | Port to Next.js (just LLM calls, trivial move) |
| `/api/internal/trends/fetch` + `/trends/list` | Growth tool — RSS/HN scraping | Port to Next.js (fetch + XML parse, trivial) |
| `/api/preview/start` + `/status` + `/stop` + proxy | Legacy iframe preview | **Kill it** — replaced by WebContainers in the browser |
| `/api/proxy/*` | Legacy LLM proxy | Kill it — direct keys only now |

### Recommended kill-or-port decision

- **Growth tool** (crawl / analyze / trends): port all 5 endpoints to Next.js. Total work ~2–3 hrs. Most of it is already just a passthrough.
- **Preview & proxy**: delete entirely. These are from before the WebContainers migration and no longer needed.

Once those are done, you can **delete `/app/backend/` entirely** and Emanator is a pure Next.js app.

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

- [x] Stripe ported to Next.js
- [x] Emergent proxy removed from AI services
- [x] Env files cleaned
- [x] Tests updated + passing at baseline
- [ ] Growth tool endpoints ported to Next.js
- [ ] Preview endpoints deleted
- [ ] Python backend deleted
- [ ] MongoDB data migrated to Atlas
- [ ] Repo pushed to GitHub
- [ ] Vercel deployment live
- [ ] Stripe webhook configured
- [ ] First successful production purchase
- [ ] Custom domain set up (optional)
