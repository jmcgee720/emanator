from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
import httpx
import os
import logging
import jwt
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

NEXTJS_URL = "http://localhost:3000"

# ── MongoDB connection (shared with credits service) ──
from pymongo import MongoClient
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')
_mongo_client = None
_mongo_db = None

def get_db():
    global _mongo_client, _mongo_db
    if _mongo_db is None:
        _mongo_client = MongoClient(MONGO_URL)
        _mongo_db = _mongo_client[DB_NAME]
        _mongo_db['payment_transactions'].create_index('session_id', unique=True)
        _mongo_db['persona_profiles'].create_index([('user_id', 1), ('created_at', -1)])
    return _mongo_db

# ── Stripe packages (server-side only — never accept amounts from frontend) ──
STRIPE_PACKAGES = {
    'starter': {'amount': 10.00, 'credits': 100, 'label': '$10 → 100 credits'},
    'pro':     {'amount': 45.00, 'credits': 500, 'label': '$45 → 500 credits'},
    'ultra':   {'amount': 80.00, 'credits': 1000, 'label': '$80 → 1,000 credits'},
}

def _extract_user_from_token(request: Request):
    """Extract user info from Supabase JWT (Authorization: Bearer ...)"""
    auth = request.headers.get('authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[7:]
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        email = payload.get('email')
        user_id = payload.get('sub')  # Supabase user UUID — used as user_id everywhere
        if email and user_id:
            return {'email': email, 'user_id': user_id}
    except Exception:
        pass
    return None

# ── Stripe routes (BEFORE the catch-all proxy) ──

@app.post("/api/stripe/checkout")
async def stripe_checkout(request: Request):
    """Create a Stripe Checkout session for a credit package"""
    user = _extract_user_from_token(request)
    if not user:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    user_id = user['user_id']

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    package_id = body.get('package_id')
    origin_url = body.get('origin_url', '')

    if package_id not in STRIPE_PACKAGES:
        return JSONResponse({"error": f"Invalid package. Valid: {list(STRIPE_PACKAGES.keys())}"}, status_code=400)

    if not origin_url:
        return JSONResponse({"error": "origin_url required"}, status_code=400)

    pkg = STRIPE_PACKAGES[package_id]

    try:
        from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

        api_key = os.environ.get('STRIPE_API_KEY')
        if not api_key:
            return JSONResponse({"error": "Stripe not configured"}, status_code=500)

        host_url = str(request.base_url).rstrip('/')
        webhook_url = f"{host_url}/api/webhook/stripe"
        stripe_checkout_client = StripeCheckout(api_key=api_key, webhook_url=webhook_url)

        success_url = f"{origin_url}?stripe_status=success&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{origin_url}?stripe_status=cancelled"

        checkout_req = CheckoutSessionRequest(
            amount=pkg['amount'],
            currency='usd',
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                'user_id': user_id,
                'user_email': user['email'],
                'package_id': package_id,
                'credits': str(pkg['credits']),
            }
        )

        session = await stripe_checkout_client.create_checkout_session(checkout_req)

        # Save pending transaction (idempotency key = session_id)
        db = get_db()
        db['payment_transactions'].insert_one({
            'session_id': session.session_id,
            'user_id': user_id,
            'user_email': user['email'],
            'package_id': package_id,
            'amount': pkg['amount'],
            'credits': pkg['credits'],
            'currency': 'usd',
            'payment_status': 'pending',
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat(),
        })

        logger.info(f"[Stripe] Checkout session created: {session.session_id} for user {user_id} ({package_id})")

        return JSONResponse({
            "url": session.url,
            "session_id": session.session_id,
        })

    except Exception as e:
        logger.error(f"[Stripe] Checkout error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/stripe/status/{session_id}")
async def stripe_status(request: Request, session_id: str):
    """Poll Stripe checkout session status and grant credits on success"""
    user = _extract_user_from_token(request)
    if not user:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    try:
        from emergentintegrations.payments.stripe.checkout import StripeCheckout

        api_key = os.environ.get('STRIPE_API_KEY')
        host_url = str(request.base_url).rstrip('/')
        stripe_checkout_client = StripeCheckout(api_key=api_key, webhook_url=f"{host_url}/api/webhook/stripe")

        status = await stripe_checkout_client.get_checkout_status(session_id)

        db = get_db()
        txn = db['payment_transactions'].find_one({'session_id': session_id}, {'_id': 0})

        if not txn:
            return JSONResponse({"error": "Transaction not found"}, status_code=404)

        # Idempotent status update — only mark paid, do NOT write credits here (user_id mismatch)
        if status.payment_status == 'paid' and txn.get('payment_status') != 'paid':
            db['payment_transactions'].update_one(
                {'session_id': session_id, 'payment_status': {'$ne': 'paid'}},
                {'$set': {
                    'payment_status': 'paid',
                    'status': status.status,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }}
            )
            logger.info(f"[Stripe] Payment confirmed for session {session_id}, credits to grant: {txn['credits']}")
        elif status.status == 'expired':
            db['payment_transactions'].update_one(
                {'session_id': session_id},
                {'$set': {'payment_status': 'expired', 'status': 'expired', 'updated_at': datetime.now(timezone.utc).isoformat()}}
            )

        # Tell the frontend whether it needs to call /api/credits/add
        needs_grant = status.payment_status == 'paid' and not txn.get('credits_granted')

        return JSONResponse({
            "status": status.status,
            "payment_status": status.payment_status,
            "amount_total": status.amount_total,
            "currency": status.currency,
            "credits": txn['credits'],
            "granted": status.payment_status == 'paid',
            "needs_credit_grant": needs_grant,
        })

    except Exception as e:
        logger.error(f"[Stripe] Status check error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events"""
    try:
        from emergentintegrations.payments.stripe.checkout import StripeCheckout

        api_key = os.environ.get('STRIPE_API_KEY')
        host_url = str(request.base_url).rstrip('/')
        stripe_checkout_client = StripeCheckout(api_key=api_key, webhook_url=f"{host_url}/api/webhook/stripe")

        payload = await request.body()
        signature = request.headers.get('stripe-signature')

        event = await stripe_checkout_client.handle_webhook(payload, signature)

        logger.info(f"[Stripe Webhook] Event: {event.event_type}, session: {event.session_id}")

        if event.event_type == 'checkout.session.completed' and event.session_id:
            db = get_db()
            txn = db['payment_transactions'].find_one({'session_id': event.session_id}, {'_id': 0})

            if txn and txn.get('payment_status') != 'paid':
                db['payment_transactions'].update_one(
                    {'session_id': event.session_id, 'payment_status': {'$ne': 'paid'}},
                    {'$set': {
                        'payment_status': 'paid',
                        'status': 'complete',
                        'updated_at': datetime.now(timezone.utc).isoformat(),
                    }}
                )
                logger.info(f"[Stripe Webhook] Payment confirmed for session {event.session_id}, credits pending frontend grant: {txn['credits']}")
            else:
                logger.info("[Stripe Webhook] Skipped — already paid or not found")

        return JSONResponse({"received": True})

    except Exception as e:
        logger.error(f"[Stripe Webhook] Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=400)


@app.post("/api/stripe/confirm-credits/{session_id}")
async def stripe_confirm_credits(request: Request, session_id: str):
    """Mark credits as granted for a session (called by frontend after /api/credits/add succeeds)"""
    user = _extract_user_from_token(request)
    if not user:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    db = get_db()
    result = db['payment_transactions'].update_one(
        {'session_id': session_id, 'credits_granted': {'$ne': True}},
        {'$set': {'credits_granted': True, 'updated_at': datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count > 0:
        logger.info(f"[Stripe] Credits confirmed as granted for session {session_id}")
    return JSONResponse({"confirmed": True})


# ── Trend Engine routes (BEFORE the catch-all proxy) ──

@app.post("/api/internal/trends/fetch")
async def trends_fetch(request: Request):
    """Fetch trends from Google Trends RSS and Hacker News. Called by route.js."""
    from lxml import etree
    import asyncio

    db = get_db()
    signals = []

    # 1. Google Trends RSS
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            resp = await client.get(
                "https://trends.google.com/trending/rss?geo=US",
                headers={"User-Agent": "Mozilla/5.0 (compatible; EmanatorBot/1.0)"},
            )
        if resp.status_code == 200:
            root = etree.fromstring(resp.content)
            ns = {"ht": "https://trends.google.com/trending/rss"}
            for item in root.findall(".//item")[:20]:
                title_el = item.find("title")
                traffic_el = item.find("ht:approx_traffic", ns)
                if title_el is not None and title_el.text:
                    keyword = title_el.text.strip().lower()
                    traffic_str = (traffic_el.text or "0").replace("+", "").replace(",", "").strip()
                    try:
                        score = int(traffic_str) if traffic_str.isdigit() else 100
                    except Exception:
                        score = 100
                    signals.append({
                        "keyword": keyword,
                        "source": "google_trends",
                        "score": score,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
    except Exception as e:
        logger.warning(f"[Trends] Google Trends fetch failed: {e}")

    # 2. Hacker News top stories
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            ids_resp = await client.get("https://hacker-news.firebaseio.com/v0/topstories.json")
            story_ids = ids_resp.json()[:15]

            async def fetch_story(sid):
                r = await client.get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json")
                return r.json() if r.status_code == 200 else None

            stories = await asyncio.gather(*[fetch_story(sid) for sid in story_ids])

        for story in stories:
            if not story or not story.get("title"):
                continue
            signals.append({
                "keyword": story["title"].strip().lower(),
                "source": "hackernews",
                "score": story.get("score", 0),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        logger.warning(f"[Trends] HN fetch failed: {e}")

    if signals:
        db["trend_signals"].insert_many(signals)

    logger.info(f"[Trends] Fetched {len(signals)} signals (Google: {sum(1 for s in signals if s['source']=='google_trends')}, HN: {sum(1 for s in signals if s['source']=='hackernews')})")

    return JSONResponse({"success": True, "count": len(signals)}, status_code=201)


@app.get("/api/internal/trends/list")
async def trends_list(request: Request):
    """Return recent trend signals. Called by route.js."""
    db = get_db()
    docs = list(
        db["trend_signals"]
        .find({}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )
    return JSONResponse({"trends": docs})


# ── Growth Engine routes (BEFORE the catch-all proxy) ──

# Persona seed templates keyed by detected site type
_PERSONA_TEMPLATES = {
    'ecommerce': [
        {'name': 'Impulse Buyer', 'description': 'Makes quick purchase decisions based on deals and social proof. Responds to urgency, discounts, and trending products.', 'interests': ['deals', 'trending products', 'reviews'], 'platforms': ['instagram', 'tiktok', 'google shopping'], 'content_types': ['product pages', 'landing pages', 'ads']},
        {'name': 'Trend Follower', 'description': 'Stays current with latest styles and products. Influenced by social media and influencer recommendations.', 'interests': ['fashion', 'new releases', 'influencers'], 'platforms': ['instagram', 'pinterest', 'youtube'], 'content_types': ['lookbooks', 'collections', 'social posts']},
        {'name': 'Bargain Hunter', 'description': 'Compares prices across sites. Motivated by value, coupons, and clearance. Reads reviews thoroughly.', 'interests': ['price comparison', 'coupons', 'sales'], 'platforms': ['google', 'reddit', 'deal sites'], 'content_types': ['comparison pages', 'review roundups', 'deal posts']},
    ],
    'content': [
        {'name': 'Curiosity Seeker', 'description': 'Browses widely, clicks on intriguing headlines. Short attention span but high discovery intent.', 'interests': ['news', 'how-to', 'explainers'], 'platforms': ['google', 'twitter', 'reddit'], 'content_types': ['articles', 'guides', 'listicles']},
        {'name': 'Deep Researcher', 'description': 'Reads long-form content thoroughly. Values data, citations, and expert analysis. Bookmarks and shares quality pieces.', 'interests': ['analysis', 'data', 'expert opinions'], 'platforms': ['google', 'linkedin', 'newsletters'], 'content_types': ['whitepapers', 'case studies', 'long-form articles']},
        {'name': 'Social Sharer', 'description': 'Consumes content primarily to share it. Looks for quotable insights, infographics, and hot takes.', 'interests': ['viral content', 'infographics', 'opinions'], 'platforms': ['twitter', 'linkedin', 'facebook'], 'content_types': ['social snippets', 'thread starters', 'visual content']},
    ],
    'app': [
        {'name': 'Casual Player', 'description': 'Uses the app occasionally for quick tasks. Values simplicity and speed over advanced features.', 'interests': ['ease of use', 'quick results', 'mobile'], 'platforms': ['app store', 'google', 'social'], 'content_types': ['tutorials', 'quick start guides', 'feature highlights']},
        {'name': 'Power User', 'description': 'Explores every feature deeply. Wants integrations, customization, and advanced workflows.', 'interests': ['advanced features', 'integrations', 'automation'], 'platforms': ['google', 'reddit', 'forums'], 'content_types': ['docs', 'API references', 'changelog']},
        {'name': 'Decision Maker', 'description': 'Evaluates the app for team adoption. Cares about pricing, security, and ROI.', 'interests': ['pricing', 'security', 'comparison'], 'platforms': ['google', 'g2', 'linkedin'], 'content_types': ['pricing pages', 'case studies', 'comparisons']},
    ],
    'generic': [
        {'name': 'First-Time Visitor', 'description': 'Landed from search or social. Needs clear value proposition and easy navigation to stay.', 'interests': ['clarity', 'value', 'trust signals'], 'platforms': ['google', 'social media'], 'content_types': ['homepage', 'about page', 'key landing pages']},
        {'name': 'Return Visitor', 'description': 'Familiar with the site. Looking for new content, updates, or to complete a previous task.', 'interests': ['updates', 'new content', 'task completion'], 'platforms': ['direct', 'email', 'bookmarks'], 'content_types': ['blog', 'product updates', 'dashboards']},
        {'name': 'Referral Visitor', 'description': 'Arrived via recommendation. Has moderate trust but needs validation. Compares with alternatives.', 'interests': ['social proof', 'reviews', 'credibility'], 'platforms': ['referral links', 'social', 'word of mouth'], 'content_types': ['testimonials', 'case studies', 'feature pages']},
    ],
}

def _infer_site_type(extracted_data):
    """Infer site type from page data."""
    title = (extracted_data.get('title') or '').lower()
    meta = (extracted_data.get('meta_description') or '').lower()
    url = (extracted_data.get('final_url') or '').lower()
    headings_text = ' '.join(h for hlist in (extracted_data.get('headings') or {}).values() for h in hlist).lower()
    combined = f"{title} {meta} {url} {headings_text}"

    ecommerce_signals = ['shop', 'store', 'buy', 'cart', 'product', 'price', 'shipping', 'checkout', 'order', 'sale', 'discount', 'add to cart', 'ecommerce', 'shopify']
    app_signals = ['app', 'login', 'sign up', 'dashboard', 'saas', 'platform', 'tool', 'software', 'api', 'integration', 'pricing', 'free trial', 'demo']
    content_signals = ['blog', 'article', 'post', 'news', 'story', 'read', 'guide', 'how to', 'tutorial', 'learn', 'magazine', 'publish']

    scores = {
        'ecommerce': sum(1 for s in ecommerce_signals if s in combined),
        'app': sum(1 for s in app_signals if s in combined),
        'content': sum(1 for s in content_signals if s in combined),
    }
    best = max(scores, key=scores.get)
    return best if scores[best] >= 2 else 'generic'

def _auto_seed_personas(db, user_id, extracted_data):
    """Create 3 starter personas based on detected site type."""
    site_type = _infer_site_type(extracted_data)
    templates = _PERSONA_TEMPLATES.get(site_type, _PERSONA_TEMPLATES['generic'])
    docs = []
    for t in templates:
        doc = {
            'user_id': user_id,
            'project_id': None,
            'name': t['name'],
            'description': t['description'],
            'interests': t['interests'],
            'platforms': t['platforms'],
            'content_types': t['content_types'],
            'performance_score': 0,
            'created_at': datetime.now(timezone.utc).isoformat(),
        }
        docs.append(doc)
    if docs:
        db['persona_profiles'].insert_many(docs)
    return [{'name': d['name'], 'description': d['description']} for d in docs]

@app.post("/api/internal/growth/crawl")
async def growth_crawl(request: Request):
    """Crawl a URL and extract SEO-relevant data. Called internally by Next.js route.js."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    user_id = (body.get('user_id') or '').strip()
    if not user_id:
        return JSONResponse({"error": "user_id is required"}, status_code=400)

    raw_url = (body.get('url') or '').strip()
    if not raw_url:
        return JSONResponse({"error": "url is required"}, status_code=400)

    # Normalize URL
    if not raw_url.startswith(('http://', 'https://')):
        raw_url = 'https://' + raw_url
    raw_url = raw_url.rstrip('/')

    try:
        from bs4 import BeautifulSoup
        from urllib.parse import urlparse, urljoin

        parsed = urlparse(raw_url)
        if not parsed.netloc:
            return JSONResponse({"error": "Invalid URL"}, status_code=400)

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(raw_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; EmanatorBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            })

        if resp.status_code >= 400:
            return JSONResponse({"error": f"URL returned HTTP {resp.status_code}"}, status_code=422)

        content_type = resp.headers.get('content-type', '')
        if 'text/html' not in content_type and 'application/xhtml' not in content_type:
            return JSONResponse({"error": f"Not an HTML page (content-type: {content_type})"}, status_code=422)

        html = resp.text
        soup = BeautifulSoup(html, 'lxml')

        # Extract title
        title_tag = soup.find('title')
        title = title_tag.get_text(strip=True) if title_tag else None

        # Extract meta description
        meta_desc_tag = soup.find('meta', attrs={'name': 'description'})
        meta_description = meta_desc_tag.get('content', '').strip() if meta_desc_tag else None

        # Extract canonical
        canonical_tag = soup.find('link', attrs={'rel': 'canonical'})
        canonical = canonical_tag.get('href', '').strip() if canonical_tag else None

        # Extract OG tags
        og_tags = {}
        for og in soup.find_all('meta', attrs={'property': lambda v: v and v.startswith('og:')}):
            og_tags[og.get('property')] = og.get('content', '')

        # Extract headings hierarchy
        headings = {}
        for level in range(1, 7):
            tag_name = f'h{level}'
            found = soup.find_all(tag_name)
            if found:
                headings[tag_name] = [h.get_text(strip=True)[:200] for h in found[:10]]

        # Word count (visible text)
        for tag in soup(['script', 'style', 'noscript', 'header', 'footer', 'nav']):
            tag.decompose()
        visible_text = soup.get_text(separator=' ', strip=True)
        word_count = len(visible_text.split())

        # Links
        base_domain = parsed.netloc.lower()
        internal_links = 0
        external_links = 0
        for a in soup.find_all('a', href=True):
            href = a['href']
            abs_url = urljoin(raw_url, href)
            link_parsed = urlparse(abs_url)
            if link_parsed.netloc.lower() == base_domain:
                internal_links += 1
            elif link_parsed.scheme in ('http', 'https'):
                external_links += 1

        # Image alt coverage
        images = soup.find_all('img')
        total_images = len(images)
        images_with_alt = sum(1 for img in images if img.get('alt', '').strip())

        # Meta robots
        robots_tag = soup.find('meta', attrs={'name': 'robots'})
        meta_robots = robots_tag.get('content', '').strip() if robots_tag else None

        extracted_data = {
            'title': title,
            'title_length': len(title) if title else 0,
            'meta_description': meta_description,
            'meta_description_length': len(meta_description) if meta_description else 0,
            'canonical': canonical,
            'og_tags': og_tags,
            'headings': headings,
            'word_count': word_count,
            'internal_links': internal_links,
            'external_links': external_links,
            'total_images': total_images,
            'images_with_alt': images_with_alt,
            'meta_robots': meta_robots,
            'final_url': str(resp.url),
            'status_code': resp.status_code,
        }

        # Store in MongoDB
        db = get_db()
        doc = {
            'user_id': user_id,
            'url': raw_url,
            'extracted_data': extracted_data,
            'opportunities': None,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        result = db['growth_pages'].insert_one(doc)
        page_id = str(result.inserted_id)

        logger.info(f"[Growth] Crawled {raw_url} for user {user_id}, page_id={page_id}")

        # ── Auto-seed personas on first Growth usage ──
        seeded_personas = []
        try:
            existing_count = db['persona_profiles'].count_documents({'user_id': user_id})
            if existing_count == 0:
                seeded_personas = _auto_seed_personas(db, user_id, extracted_data)
                logger.info(f"[Growth] Auto-seeded {len(seeded_personas)} personas for user {user_id}")
        except Exception as e:
            logger.warning(f"[Growth] Persona auto-seed failed: {e}")

        return JSONResponse({
            "success": True,
            "page_id": page_id,
            "url": raw_url,
            "extracted_data": extracted_data,
            "seeded_personas": seeded_personas,
        }, status_code=201)

    except httpx.TimeoutException:
        return JSONResponse({"error": f"Timeout: {raw_url} did not respond within 10 seconds"}, status_code=504)
    except httpx.RequestError as e:
        return JSONResponse({"error": f"Request failed: {str(e)}"}, status_code=502)
    except Exception as e:
        logger.error(f"[Growth] Crawl error: {e}")
        return JSONResponse({"error": f"Crawl failed: {str(e)}"}, status_code=500)


@app.post("/api/internal/growth/analyze")
async def growth_analyze(request: Request):
    """Run first-pass SEO analysis on a stored page using AI. Called internally by Next.js route.js."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    user_id = (body.get('user_id') or '').strip()
    if not user_id:
        return JSONResponse({"error": "user_id is required"}, status_code=400)

    page_id = (body.get('page_id') or '').strip()
    if not page_id:
        return JSONResponse({"error": "page_id is required"}, status_code=400)

    import json as json_module
    from bson import ObjectId as BsonObjectId
    try:
        oid = BsonObjectId(page_id)
    except Exception:
        return JSONResponse({"error": "Invalid page_id"}, status_code=400)

    db = get_db()
    page = db['growth_pages'].find_one({'_id': oid, 'user_id': user_id})
    if not page:
        return JSONResponse({"error": "Page not found"}, status_code=404)

    extracted = page.get('extracted_data', {})

    # Build prompt for SEO analysis + fixes
    current_h1 = ''
    headings = extracted.get('headings', {})
    if 'h1' in headings and headings['h1']:
        current_h1 = headings['h1'][0]

    # Find relevant trends (simple keyword overlap)
    trend_context = ""
    try:
        page_text = (
            (extracted.get('title') or '') + ' ' +
            (extracted.get('meta_description') or '') + ' ' +
            ' '.join(h for hlist in headings.values() for h in hlist)
        ).lower()
        page_words = set(page_text.split())

        recent_trends = list(
            db["trend_signals"]
            .find({}, {"_id": 0, "keyword": 1, "source": 1, "score": 1})
            .sort("created_at", -1)
            .limit(50)
        )
        scored = []
        for t in recent_trends:
            kw_words = set(t["keyword"].lower().split())
            overlap = len(kw_words & page_words)
            if overlap > 0:
                scored.append((overlap * t.get("score", 1), t))
        scored.sort(key=lambda x: -x[0])
        top_trends = scored[:3]

        if top_trends:
            trend_lines = [f"- \"{t['keyword']}\" (source: {t['source']}, score: {t['score']})" for _, t in top_trends]
            trend_context = "\n\nCurrently trending topics that may be relevant:\n" + "\n".join(trend_lines) + "\nIncorporate relevant trending angles into your recommendations if appropriate."
    except Exception as e:
        logger.warning(f"[Growth] Trend matching failed: {e}")

    # Inject persona context
    persona_context = ""
    persona_name_used = None
    persona_id_param = (body.get('persona_id') or '').strip()
    try:
        if persona_id_param:
            # Specific persona requested
            from bson import ObjectId as BsonOidPersona
            try:
                p_oid = BsonOidPersona(persona_id_param)
            except Exception:
                return JSONResponse({"error": "Invalid persona_id"}, status_code=400)
            p_doc = db["persona_profiles"].find_one(
                {"_id": p_oid, "user_id": user_id},
                {"_id": 0, "name": 1, "description": 1, "interests": 1, "platforms": 1}
            )
            if not p_doc:
                return JSONResponse({"error": "Persona not found"}, status_code=404)
            personas = [p_doc]
        else:
            # Auto: pick highest performance_score
            personas = list(
                db["persona_profiles"]
                .find({"user_id": user_id}, {"_id": 0, "name": 1, "description": 1, "interests": 1, "platforms": 1})
                .sort("performance_score", -1)
                .limit(1)
            )
        if personas:
            p = personas[0]
            persona_name_used = p['name']
            interests_str = ', '.join(p.get('interests', []))
            platforms_str = ', '.join(p.get('platforms', []))
            persona_context = f"\n\nTarget audience: {p['name']} — {p.get('description', '')}. Interests: {interests_str}. Platforms: {platforms_str}.\nTailor your recommendations to resonate with this audience."
    except Exception as e:
        logger.warning(f"[Growth] Persona injection failed: {e}")

    prompt = f"""Analyze this webpage's SEO and return ONLY a JSON object with exactly these keys:

ANALYSIS (arrays of strings):
- title_issues: problems with the page title
- meta_issues: problems with meta description, robots, canonical, OG tags
- content_issues: problems with word count, content quality signals
- structure_issues: problems with heading hierarchy, links, images
- recommendations: top actionable improvements, prioritized

FIXES (strings):
- improved_title: a better page title (50-60 chars, include primary keyword if detectable, no clickbait)
- improved_meta_description: a better meta description (140-160 chars, include benefit + CTA tone)
- improved_h1: a better H1 heading (clear, human, not keyword-stuffed). Omit this key if the current H1 is already good.

Page data:
- URL: {page.get('url', 'unknown')}
- Title: {extracted.get('title', 'MISSING')} ({extracted.get('title_length', 0)} chars)
- Meta Description: {extracted.get('meta_description', 'MISSING')} ({extracted.get('meta_description_length', 0)} chars)
- H1: {current_h1 or 'MISSING'}
- Canonical: {extracted.get('canonical', 'MISSING')}
- OG Tags: {extracted.get('og_tags', {})}
- Headings: {headings}
- Word Count: {extracted.get('word_count', 0)}
- Internal Links: {extracted.get('internal_links', 0)}
- External Links: {extracted.get('external_links', 0)}
- Images: {extracted.get('total_images', 0)} total, {extracted.get('images_with_alt', 0)} with alt text
- Meta Robots: {extracted.get('meta_robots', 'not set')}
{trend_context}
{persona_context}

Return ONLY the JSON object, no markdown, no explanation."""

    try:
        from emergentintegrations.llm.openai import LlmChat, UserMessage
        import uuid

        api_key = os.environ.get('EMERGENT_LLM_KEY')
        if not api_key:
            return JSONResponse({"error": "LLM key not configured"}, status_code=500)

        chat = LlmChat(
            api_key=api_key,
            session_id=str(uuid.uuid4()),
            system_message="You are an SEO analyst. Return only valid JSON, no markdown fences.",
        )
        chat = chat.with_model("openai", "gpt-4o")
        chat = chat.with_params(temperature=0.3)

        raw_text = await chat.send_message(UserMessage(text=prompt))
        # Strip markdown fences if present
        if raw_text.startswith('```'):
            raw_text = raw_text.split('\n', 1)[-1]
            if raw_text.endswith('```'):
                raw_text = raw_text[:-3].strip()

        opportunities = json_module.loads(raw_text)

        # LLM may return nested {ANALYSIS: {...}, FIXES: {...}} or flat keys
        if 'ANALYSIS' in opportunities and isinstance(opportunities['ANALYSIS'], dict):
            analysis = opportunities['ANALYSIS']
            fixes_raw = opportunities.get('FIXES', {})
            opportunities = analysis
        else:
            fixes_raw = {}

        # Extract fixes from flat keys (if LLM used flat structure)
        fixes = {}
        for fix_key in ('improved_title', 'improved_meta_description', 'improved_h1'):
            if fix_key in opportunities:
                fixes[fix_key] = opportunities.pop(fix_key)
            elif fix_key in fixes_raw:
                fixes[fix_key] = fixes_raw[fix_key]

        # Ensure expected opportunity shape
        expected_keys = ['title_issues', 'meta_issues', 'content_issues', 'structure_issues', 'recommendations']
        for key in expected_keys:
            if key not in opportunities:
                opportunities[key] = []

        # Store opportunities + fixes
        db['growth_pages'].update_one(
            {'_id': oid, 'user_id': user_id},
            {'$set': {'opportunities': opportunities, 'fixes': fixes, 'updated_at': datetime.now(timezone.utc).isoformat()}}
        )

        logger.info(f"[Growth] Analyzed page {page_id} for user {user_id}")

        return JSONResponse({
            "success": True,
            "page_id": page_id,
            "opportunities": opportunities,
            "fixes": fixes,
            "persona_name": persona_name_used,
        })

    except json_module.JSONDecodeError as e:
        logger.error(f"[Growth] AI returned invalid JSON: {e}")
        return JSONResponse({"error": "AI returned invalid JSON, please retry"}, status_code=502)
    except Exception as e:
        logger.error(f"[Growth] Analyze error: {e}")
        return JSONResponse({"error": f"Analysis failed: {str(e)}"}, status_code=500)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_api(request: Request, path: str):
    """Proxy all /api/* requests to Next.js"""
    url = f"{NEXTJS_URL}/api/{path}"
    
    # Get headers, excluding host
    headers = dict(request.headers)
    headers.pop('host', None)
    
    # Get body if present
    body = await request.body()
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
                params=request.query_params,
            )
            
            # Check if this is a streaming response (SSE)
            content_type = response.headers.get('content-type', '')
            if 'text/event-stream' in content_type:
                async def stream_response():
                    async for chunk in response.aiter_bytes():
                        yield chunk
                return StreamingResponse(
                    stream_response(),
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=content_type
                )
            
            # Regular response
            content_type_header = response.headers.get('content-type', '')
            if content_type_header.startswith('application/json'):
                try:
                    body = response.json()
                except Exception:
                    body = {"error": response.text[:500] or "Empty response from upstream"}
            else:
                body = {"error": response.text[:500]} if response.status_code >= 400 else response.text
            return JSONResponse(
                content=body,
                status_code=response.status_code,
                headers={k: v for k, v in response.headers.items() if k.lower() not in ('content-length', 'content-encoding', 'transfer-encoding')}
            )
    except httpx.RequestError as e:
        logger.error(f"Proxy error: {e}")
        return JSONResponse({"error": f"Proxy error: {str(e)}"}, status_code=502)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/")
async def root():
    return {"message": "Proxy to Next.js API"}
