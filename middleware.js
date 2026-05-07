// ──────────────────────────────────────────────────────────────────────
// /app/middleware.js
//
// Single source of truth for CORS headers across the entire app.
//
// Why: env var `CORS_ORIGINS` is comma-separated (e.g.
// "https://www.auroraly.co,https://auroraly.co") and was being shoved
// directly into Access-Control-Allow-Origin, which violates CORS spec
// (must be exactly ONE origin or `*`). Browsers rejected every API
// response → users got stuck in retry loops on the auth gate.
//
// This middleware reads the incoming Origin header, picks the matching
// allowed origin, and emits a single value. Falls back to the first
// listed allowed origin if no match (better than emitting nothing).
// ──────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

function pickOrigin(allowedRaw, incomingOrigin) {
  if (!allowedRaw || allowedRaw === '*') return '*'
  const allowed = allowedRaw.split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length === 0) return '*'
  if (incomingOrigin && allowed.includes(incomingOrigin)) return incomingOrigin
  return allowed[0]
}

function setCorsHeaders(headers, request) {
  const originHeader = pickOrigin(process.env.CORS_ORIGINS, request.headers.get('origin'))
  headers.set('Access-Control-Allow-Origin', originHeader)
  headers.append('Vary', 'Origin')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  headers.set('Access-Control-Allow-Credentials', 'true')
}

export function middleware(request) {
  // Preflight: short-circuit without hitting the route handler.
  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    setCorsHeaders(res.headers, request)
    return res
  }

  // Pass-through; route handlers run, then we attach CORS headers.
  const res = NextResponse.next()
  setCorsHeaders(res.headers, request)
  return res
}

export const config = {
  // Match every API route — leaving the rest alone (Next handles
  // static asset CORS via headers() in next.config.js).
  matcher: ['/api/:path*'],
}
