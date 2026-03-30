from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse, Response
from starlette.middleware.cors import CORSMiddleware
import httpx
import os
import logging
import jwt
import shutil
import socket
import subprocess
import threading
import json as json_module
from collections import deque
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


async def _crawl_single_page(raw_url, user_id, db, parent_seed_url=None, crawl_mode='single'):
    """Crawl a single URL and store result. Returns dict with page_id/extracted_data or error."""
    from bs4 import BeautifulSoup
    from urllib.parse import urlparse, urljoin

    try:
        parsed = urlparse(raw_url)
        if not parsed.netloc:
            return {'error': 'Invalid URL: missing domain', 'status': 400}

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(raw_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; EmanatorBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            })

        if resp.status_code >= 400:
            return {'error': f'URL returned HTTP {resp.status_code}', 'status': 422}

        content_type = resp.headers.get('content-type', '')
        if 'text/html' not in content_type and 'application/xhtml' not in content_type:
            return {'error': f'Not an HTML page (content-type: {content_type})', 'status': 422}

        html = resp.text
        soup = BeautifulSoup(html, 'lxml')

        title_tag = soup.find('title')
        title = title_tag.get_text(strip=True) if title_tag else None

        meta_desc_tag = soup.find('meta', attrs={'name': 'description'})
        meta_description = meta_desc_tag.get('content', '').strip() if meta_desc_tag else None

        canonical_tag = soup.find('link', attrs={'rel': 'canonical'})
        canonical = canonical_tag.get('href', '').strip() if canonical_tag else None

        og_tags = {}
        for og in soup.find_all('meta', attrs={'property': lambda v: v and v.startswith('og:')}):
            og_tags[og.get('property')] = og.get('content', '')

        headings = {}
        for level in range(1, 7):
            tag_name = f'h{level}'
            found = soup.find_all(tag_name)
            if found:
                headings[tag_name] = [h.get_text(strip=True)[:200] for h in found[:10]]

        # Collect internal link URLs BEFORE decomposing nav/footer
        base_domain = parsed.netloc.lower()
        internal_link_urls = []
        internal_links = 0
        external_links = 0
        for a in soup.find_all('a', href=True):
            href = a['href']
            abs_url = urljoin(raw_url, href)
            link_parsed = urlparse(abs_url)
            if link_parsed.netloc.lower() == base_domain:
                internal_links += 1
                clean_link = f"{link_parsed.scheme}://{link_parsed.netloc}{link_parsed.path}".rstrip('/')
                if clean_link and clean_link not in internal_link_urls:
                    internal_link_urls.append(clean_link)
            elif link_parsed.scheme in ('http', 'https'):
                external_links += 1

        images = soup.find_all('img')
        total_images = len(images)
        images_with_alt = sum(1 for img in images if img.get('alt', '').strip())

        robots_tag = soup.find('meta', attrs={'name': 'robots'})
        meta_robots = robots_tag.get('content', '').strip() if robots_tag else None

        for tag in soup(['script', 'style', 'noscript', 'header', 'footer', 'nav']):
            tag.decompose()
        visible_text = soup.get_text(separator=' ', strip=True)
        word_count = len(visible_text.split())

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

        doc = {
            'user_id': user_id,
            'url': raw_url,
            'extracted_data': extracted_data,
            'opportunities': None,
            'crawl_mode': crawl_mode,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        if parent_seed_url:
            doc['parent_seed_url'] = parent_seed_url

        result = db['growth_pages'].insert_one(doc)
        page_id = str(result.inserted_id)
        logger.info(f"[Growth] Crawled {raw_url} for user {user_id}, page_id={page_id}")

        return {'page_id': page_id, 'extracted_data': extracted_data, 'internal_link_urls': internal_link_urls}

    except httpx.TimeoutException:
        return {'error': f'Timeout: {raw_url} did not respond within 10 seconds', 'status': 504}
    except httpx.RequestError as e:
        return {'error': f'Request failed: {str(e)}', 'status': 502}
    except Exception as e:
        logger.error(f"[Growth] Crawl error for {raw_url}: {e}")
        return {'error': f'Crawl failed: {str(e)}', 'status': 500}

@app.post("/api/internal/growth/crawl")
async def growth_crawl(request: Request):
    """Crawl a URL (single or batch mode) and extract SEO-relevant data."""
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

    mode = (body.get('mode') or 'single').strip().lower()
    if mode not in ('single', 'batch'):
        return JSONResponse({"error": "mode must be 'single' or 'batch'"}, status_code=400)

    max_pages = min(max(int(body.get('max_pages', 10)), 1), 25)

    # Normalize URL
    if not raw_url.startswith(('http://', 'https://')):
        raw_url = 'https://' + raw_url
    raw_url = raw_url.rstrip('/')

    db = get_db()

    if mode == 'single':
        result = await _crawl_single_page(raw_url, user_id, db, crawl_mode='single')
        if result.get('error'):
            return JSONResponse({"error": result['error']}, status_code=result.get('status', 500))

        seeded_personas = []
        try:
            if db['persona_profiles'].count_documents({'user_id': user_id}) == 0:
                seeded_personas = _auto_seed_personas(db, user_id, result['extracted_data'])
        except Exception as e:
            logger.warning(f"[Growth] Persona auto-seed failed: {e}")

        return JSONResponse({
            "success": True,
            "page_id": result['page_id'],
            "url": raw_url,
            "extracted_data": result['extracted_data'],
            "seeded_personas": seeded_personas,
        }, status_code=201)

    # ── Batch mode: BFS crawl ──
    from urllib.parse import urlparse
    from collections import deque

    parsed_seed = urlparse(raw_url)
    seed_hostname = parsed_seed.netloc.lower()

    skip_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.pdf',
                       '.zip', '.tar', '.gz', '.mp3', '.mp4', '.avi', '.mov', '.wmv',
                       '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.xml', '.json',
                       '.csv', '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx'}

    visited = set()
    queue = deque([raw_url])
    page_ids = []
    pages_attempted = 0
    pages_failed = 0
    first_extracted = None

    while queue and len(page_ids) < max_pages:
        current_url = queue.popleft()
        norm = current_url.rstrip('/').split('#')[0].split('?')[0].lower()
        if norm in visited:
            continue
        visited.add(norm)

        pages_attempted += 1
        result = await _crawl_single_page(current_url, user_id, db, parent_seed_url=raw_url, crawl_mode='batch')

        if result.get('error'):
            pages_failed += 1
            logger.info(f"[Growth][Batch] Failed {current_url}: {result['error']}")
            continue

        page_ids.append(result['page_id'])
        if first_extracted is None:
            first_extracted = result['extracted_data']

        for link_url in result.get('internal_link_urls', []):
            link_parsed = urlparse(link_url)
            if link_parsed.netloc.lower() != seed_hostname:
                continue
            path_lower = link_parsed.path.lower()
            if any(path_lower.endswith(ext) for ext in skip_extensions):
                continue
            link_norm = link_url.rstrip('/').split('#')[0].split('?')[0].lower()
            if link_norm not in visited:
                queue.append(link_url)

    seeded_personas = []
    if first_extracted:
        try:
            if db['persona_profiles'].count_documents({'user_id': user_id}) == 0:
                seeded_personas = _auto_seed_personas(db, user_id, first_extracted)
        except Exception as e:
            logger.warning(f"[Growth] Persona auto-seed failed: {e}")

    logger.info(f"[Growth][Batch] {raw_url}: {len(page_ids)} saved, {pages_failed} failed, {pages_attempted} attempted")

    return JSONResponse({
        "success": True,
        "seed_url": raw_url,
        "mode": "batch",
        "pages_attempted": pages_attempted,
        "pages_saved": len(page_ids),
        "pages_failed": pages_failed,
        "page_ids": page_ids,
        "seeded_personas": seeded_personas,
    }, status_code=201)


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


@app.post("/api/internal/growth/generate-drafts")
async def growth_generate_drafts(request: Request):
    """Generate marketing channel drafts from a stored page. Called internally by Next.js route.js."""
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
    opportunities = page.get('opportunities', {})
    fixes = page.get('fixes', {})

    # Headings
    headings = extracted.get('headings', {})
    current_h1 = ''
    if 'h1' in headings and headings['h1']:
        current_h1 = headings['h1'][0]

    # Build persona context
    persona_context = ""
    persona_id_param = (body.get('persona_id') or '').strip()
    try:
        if persona_id_param:
            from bson import ObjectId as BsonOidP
            try:
                p_oid = BsonOidP(persona_id_param)
            except Exception:
                return JSONResponse({"error": "Invalid persona_id"}, status_code=400)
            p_doc = db["persona_profiles"].find_one(
                {"_id": p_oid, "user_id": user_id},
                {"_id": 0, "name": 1, "description": 1, "interests": 1, "platforms": 1, "content_types": 1}
            )
            if not p_doc:
                return JSONResponse({"error": "Persona not found"}, status_code=404)
            personas = [p_doc]
        else:
            personas = list(
                db["persona_profiles"]
                .find({"user_id": user_id}, {"_id": 0, "name": 1, "description": 1, "interests": 1, "platforms": 1, "content_types": 1})
                .sort("performance_score", -1)
                .limit(1)
            )
        if personas:
            p = personas[0]
            interests_str = ', '.join(p.get('interests', []))
            platforms_str = ', '.join(p.get('platforms', []))
            content_str = ', '.join(p.get('content_types', []))
            persona_context = f"Target audience: {p['name']} — {p.get('description', '')}. Interests: {interests_str}. Platforms: {platforms_str}. Preferred content: {content_str}."
    except Exception as e:
        logger.warning(f"[Growth] Drafts persona fetch failed: {e}")

    # Build trend context
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
            trend_lines = [f"- \"{t['keyword']}\" (score: {t['score']})" for _, t in top_trends]
            trend_context = "Trending topics to reference if relevant:\n" + "\n".join(trend_lines)
    except Exception as e:
        logger.warning(f"[Growth] Drafts trend fetch failed: {e}")

    # Build fixes context
    fixes_context = ""
    if fixes:
        parts = []
        if fixes.get('improved_title'):
            parts.append(f"Improved title: {fixes['improved_title']}")
        if fixes.get('improved_meta_description'):
            parts.append(f"Improved meta description: {fixes['improved_meta_description']}")
        if fixes.get('improved_h1'):
            parts.append(f"Improved H1: {fixes['improved_h1']}")
        if parts:
            fixes_context = "SEO-optimized copy to draw from:\n" + "\n".join(parts)

    # Build key issues summary
    issues_summary = ""
    if opportunities:
        recs = opportunities.get('recommendations', [])
        if recs:
            issues_summary = "Top recommendations:\n" + "\n".join(f"- {r}" for r in recs[:3])

    prompt = f"""You are a marketing copywriter. Generate marketing channel drafts for the webpage below.

Return ONLY a JSON object with exactly this structure:
{{
  "social_post": {{
    "headline": "short punchy headline (max 80 chars)",
    "body": "engaging post body (max 280 chars, suitable for Twitter/LinkedIn)",
    "cta": "call to action (max 40 chars)"
  }},
  "search_ad": {{
    "headline_1": "Google Ads headline 1 (max 30 chars)",
    "headline_2": "Google Ads headline 2 (max 30 chars)",
    "description": "Google Ads description (max 90 chars)"
  }},
  "email": {{
    "subject": "email subject line (max 60 chars)",
    "preview_text": "email preview text (max 90 chars)",
    "body_intro": "opening paragraph of the email (2-3 sentences)"
  }}
}}

Page data:
- URL: {page.get('url', 'unknown')}
- Title: {extracted.get('title', 'MISSING')}
- Meta Description: {extracted.get('meta_description', 'MISSING')}
- H1: {current_h1 or 'MISSING'}
- Word Count: {extracted.get('word_count', 0)}
{persona_context}
{trend_context}
{fixes_context}
{issues_summary}

Rules:
- Make drafts specific to the page content, not generic
- Match tone to the audience persona if provided
- Keep within character limits
- Return ONLY the JSON object, no markdown, no explanation."""

    try:
        from emergentintegrations.llm.openai import LlmChat, UserMessage
        import uuid

        api_key = os.environ.get('EMERGENT_LLM_KEY')
        if not api_key:
            return JSONResponse({"error": "LLM key not configured"}, status_code=500)

        chat = LlmChat(
            api_key=api_key,
            session_id=str(uuid.uuid4()),
            system_message="You are a marketing copywriter. Return only valid JSON, no markdown fences.",
        )
        chat = chat.with_model("openai", "gpt-4o")
        chat = chat.with_params(temperature=0.7)

        raw_text = await chat.send_message(UserMessage(text=prompt))
        if raw_text.startswith('```'):
            raw_text = raw_text.split('\n', 1)[-1]
            if raw_text.endswith('```'):
                raw_text = raw_text[:-3].strip()

        drafts = json_module.loads(raw_text)

        # Ensure expected shape
        for key in ('social_post', 'search_ad', 'email'):
            if key not in drafts:
                drafts[key] = {}

        # Store drafts on the page
        db['growth_pages'].update_one(
            {'_id': oid, 'user_id': user_id},
            {'$set': {'drafts': drafts, 'drafts_generated_at': datetime.now(timezone.utc).isoformat(), 'updated_at': datetime.now(timezone.utc).isoformat()}}
        )

        logger.info(f"[Growth] Generated drafts for page {page_id}, user {user_id}")

        return JSONResponse({
            "success": True,
            "page_id": page_id,
            "drafts": drafts,
        })

    except json_module.JSONDecodeError as e:
        logger.error(f"[Growth] Drafts AI returned invalid JSON: {e}")
        return JSONResponse({"error": "AI returned invalid JSON, please retry"}, status_code=502)
    except Exception as e:
        logger.error(f"[Growth] Drafts generation error: {e}")
        return JSONResponse({"error": f"Draft generation failed: {str(e)}"}, status_code=500)


# ── Preview Runner ──────────────────────────────────────────────────

_preview_processes = {}  # project_id -> {process, port, type, logs, status_ref, dir, thread}
_preview_lock = threading.Lock()


def _find_available_port(start=9000, end=9100):
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return None


def _stop_preview(project_id):
    info = _preview_processes.pop(project_id, None)
    if not info:
        return
    proc = info.get('process')
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    preview_dir = info.get('dir', '')
    if preview_dir and os.path.exists(preview_dir):
        try:
            shutil.rmtree(preview_dir)
        except Exception:
            pass


def _capture_output(process, log_buffer, status_ref):
    try:
        for line in iter(process.stdout.readline, ''):
            if not line:
                break
            log_buffer.append(line.rstrip('\n'))
            lower = line.lower()
            if any(kw in lower for kw in [
                'listening on', 'started server', 'ready on', 'compiled',
                'available on', 'server running', 'local:', 'http://localhost',
            ]):
                status_ref['status'] = 'running'
        rc = process.wait()
        if status_ref['status'] not in ('running', 'stopped'):
            status_ref['status'] = 'failed' if rc != 0 else 'stopped'
    except Exception as exc:
        log_buffer.append(f'[emanator] Output capture error: {exc}')
        status_ref['status'] = 'failed'


@app.post("/api/preview/start")
async def preview_start(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    project_id = (body.get('project_id') or '').strip()
    files = body.get('files', [])

    if not project_id:
        return JSONResponse({"error": "project_id required"}, status_code=400)
    if not files:
        return JSONResponse({"error": "files required"}, status_code=400)

    with _preview_lock:
        # Enforce 1 concurrent preview
        for old_id in list(_preview_processes.keys()):
            _stop_preview(old_id)
        if project_id in _preview_processes:
            _stop_preview(project_id)

    preview_dir = f"/tmp/preview_{project_id}"
    if os.path.exists(preview_dir):
        shutil.rmtree(preview_dir)
        logger.info(f"[Preview] Deleted old preview dir: {preview_dir}")
    os.makedirs(preview_dir, exist_ok=True)
    logger.info(f"[Preview] Fresh preview session for {project_id}")

    # Normalize paths: strip common directory prefix so package.json lands at root
    raw_paths = [os.path.normpath(f.get('path', '')).lstrip('/') for f in files if f.get('path')]
    valid_paths = [p for p in raw_paths if p and not p.startswith('..')]
    common_prefix = ''
    if valid_paths:
        parts_list = [p.split('/') for p in valid_paths]
        if all(len(pp) > 1 for pp in parts_list):
            candidate = parts_list[0][0]
            if all(pp[0] == candidate for pp in parts_list):
                common_prefix = candidate + '/'

    written = 0
    for f in files:
        fpath = f.get('path', '')
        content = f.get('content')
        if not fpath or content is None:
            continue
        safe = os.path.normpath(fpath).lstrip('/')
        if safe.startswith('..'):
            continue
        if common_prefix and safe.startswith(common_prefix):
            safe = safe[len(common_prefix):]
        if not safe:
            continue
        full = os.path.join(preview_dir, safe)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8') as fh:
            fh.write(content)
        written += 1

    if written == 0:
        shutil.rmtree(preview_dir, ignore_errors=True)
        return JSONResponse({"error": "No files written"}, status_code=400)

    pkg_path = os.path.join(preview_dir, 'package.json')
    idx_path = os.path.join(preview_dir, 'index.html')
    has_pkg = os.path.exists(pkg_path)
    has_idx = os.path.exists(idx_path)

    port = _find_available_port()
    if not port:
        shutil.rmtree(preview_dir, ignore_errors=True)
        return JSONResponse({"error": "No available port (9000-9100)"}, status_code=503)

    log_buffer = deque(maxlen=500)
    status_ref = {'status': 'starting'}

    if has_pkg:
        project_type = 'node'
        try:
            with open(pkg_path, 'r') as pf:
                pkg = json_module.loads(pf.read())
        except Exception:
            pkg = {}

        # ── Detect package manager from lockfiles ──
        has_pnpm_lock = os.path.exists(os.path.join(preview_dir, 'pnpm-lock.yaml'))
        has_yarn_lock = os.path.exists(os.path.join(preview_dir, 'yarn.lock'))
        pkg_manager_field = pkg.get('packageManager', '')  # e.g. "pnpm@8.6.0"

        if has_pnpm_lock or pkg_manager_field.startswith('pnpm'):
            pm = 'pnpm'
        elif has_yarn_lock or pkg_manager_field.startswith('yarn'):
            pm = 'yarn'
        else:
            pm = 'npm'

        # ── Build install command ──
        if pm == 'pnpm':
            install_cmd = 'pnpm install --no-frozen-lockfile'
        elif pm == 'yarn':
            install_cmd = 'yarn install --no-immutable'
        else:
            install_cmd = 'npm install --no-audit --no-fund'

        # ── Build run command ──
        scripts = pkg.get('scripts', {})
        # Identify which script was selected
        selected_script = None
        for candidate in ('dev', 'start', 'preview', 'serve'):
            if candidate in scripts:
                selected_script = candidate
                break

        if not selected_script:
            shutil.rmtree(preview_dir, ignore_errors=True)
            return JSONResponse(
                {"error": "No supported start script found in package.json (need dev, start, preview, or serve)"},
                status_code=400,
            )

        run_cmd = f'{pm} run {selected_script}'

        # ── Ensure package manager is available ──
        ensure_pm = ''
        if pm == 'pnpm':
            ensure_pm = 'command -v pnpm >/dev/null 2>&1 || npm install -g pnpm 2>&1 && '
        elif pm == 'yarn':
            ensure_pm = 'command -v yarn >/dev/null 2>&1 || npm install -g yarn 2>&1 && '

        log_buffer.append(f'[emanator] Node.js project detected')
        log_buffer.append(f'[emanator] Package manager: {pm}')
        log_buffer.append(f'[emanator] Selected script: {selected_script}')
        log_buffer.append(f'[emanator] Install: {install_cmd}')
        log_buffer.append(f'[emanator] Run: {run_cmd}')
        log_buffer.append(f'[emanator] Port: {port}')
        status_ref['status'] = 'installing'

        # ── Environment: suppress husky, git hooks, and lifecycle side-effects ──
        preview_env = {
            **os.environ,
            'PORT': str(port),
            'NODE_ENV': 'development',
            'HUSKY': '0',                    # husky v9+ skips install when HUSKY=0
            'HUSKY_SKIP_INSTALL': '1',       # husky v4 compat
            'CI': 'true',                    # many tools skip interactive/hooks in CI
            'GIT_DIR': '',                   # prevent git lookups
            'DISABLE_OPENCOLLECTIVE': 'true',
            'ADBLOCK': 'true',
        }

        cmd = f"cd {preview_dir} && {ensure_pm}{install_cmd} --ignore-scripts 2>&1 && PORT={port} {run_cmd} 2>&1"
        try:
            process = subprocess.Popen(
                cmd, shell=True,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, cwd=preview_dir,
                env=preview_env,
            )
        except Exception as e:
            shutil.rmtree(preview_dir, ignore_errors=True)
            return JSONResponse({"error": f"Failed to start: {e}"}, status_code=500)

    elif has_idx:
        project_type = 'static'
        log_buffer.append(f'[emanator] Static HTML project detected')
        log_buffer.append(f'[emanator] Serving on port {port}')
        status_ref['status'] = 'running'

        try:
            process = subprocess.Popen(
                ['python3', '-m', 'http.server', str(port), '--directory', preview_dir],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
        except Exception as e:
            shutil.rmtree(preview_dir, ignore_errors=True)
            return JSONResponse({"error": f"Failed to start: {e}"}, status_code=500)
    else:
        shutil.rmtree(preview_dir, ignore_errors=True)
        return JSONResponse({"error": "No package.json or index.html found in project files"}, status_code=400)

    thread = threading.Thread(target=_capture_output, args=(process, log_buffer, status_ref), daemon=True)
    thread.start()

    with _preview_lock:
        _preview_processes[project_id] = {
            'process': process, 'port': port, 'type': project_type,
            'logs': log_buffer, 'status_ref': status_ref,
            'dir': preview_dir, 'thread': thread,
        }

    logger.info(f"[Preview] Started {project_type} for project {project_id} on port {port}")
    return JSONResponse({"status": status_ref['status'], "type": project_type, "port": port, "project_id": project_id})


@app.get("/api/preview/status/{project_id}")
async def preview_status(project_id: str):
    info = _preview_processes.get(project_id)
    if not info:
        return JSONResponse({"status": "none", "logs": []})

    status = info['status_ref']['status']
    proc = info.get('process')

    if proc and proc.poll() is not None and status not in ('failed', 'stopped'):
        info['status_ref']['status'] = 'failed' if proc.returncode != 0 else 'stopped'
        status = info['status_ref']['status']

    if status in ('installing', 'starting'):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', info['port'])) == 0:
                info['status_ref']['status'] = 'running'
                status = 'running'

    return JSONResponse({
        "status": status,
        "type": info['type'],
        "port": info['port'],
        "logs": list(info['logs'])[-100:],
    })


@app.post("/api/preview/stop/{project_id}")
async def preview_stop(project_id: str):
    with _preview_lock:
        if project_id not in _preview_processes:
            return JSONResponse({"status": "not_running"})
        _stop_preview(project_id)
    logger.info(f"[Preview] Stopped preview for {project_id}")
    return JSONResponse({"status": "stopped"})


@app.get("/api/preview/serve/{project_id}")
async def preview_serve_root(request: Request, project_id: str):
    return await _proxy_to_preview(request, project_id, "")


@app.api_route("/api/preview/serve/{project_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def preview_serve(request: Request, project_id: str, path: str = ""):
    return await _proxy_to_preview(request, project_id, path)


async def _proxy_to_preview(request: Request, project_id: str, path: str):
    info = _preview_processes.get(project_id)
    if not info:
        return JSONResponse({"error": "No preview running for this project"}, status_code=404)

    port = info['port']
    target = f"http://127.0.0.1:{port}/{path}"
    if str(request.query_params):
        target += f"?{request.query_params}"

    headers = dict(request.headers)
    headers.pop('host', None)
    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method=request.method, url=target,
                headers=headers, content=body,
            )
        resp_headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() not in ('content-length', 'content-encoding', 'transfer-encoding')
        }
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=resp_headers,
            media_type=resp.headers.get('content-type', 'application/octet-stream'),
        )
    except httpx.RequestError as e:
        return JSONResponse({"error": f"Preview not responding: {e}"}, status_code=502)


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
