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
                logger.info(f"[Stripe Webhook] Skipped — already paid or not found")

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
            return JSONResponse(
                content=response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text,
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
