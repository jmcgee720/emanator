// GET /api/projects/:projectId/thumbnail
//
// Returns the stored thumbnail screenshot for a project (if any) —
// consumed by ProjectGrid.jsx to render dashboard tiles that show the
// REAL running project instead of a static Babel compile.
//
// Response shape: { screenshot: { data_url, captured_at, bytes } | null }

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

export async function GET(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const project = await db.projects.findById(params.projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  }

  const raw = project.settings?.thumbnail_screenshot || null
  // Return only the URL-based thumbnail. Legacy rows with `data_url`
  // (pre-2026-07-08) are ignored so the client doesn't try to render a
  // bloated stale base64 string. The next thumbnail-refresh will upgrade
  // them to the new URL-based storage format.
  let screenshot = null
  if (raw?.url) {
    screenshot = { url: raw.url, captured_at: raw.captured_at, bytes: raw.bytes }
  }
  const res = NextResponse.json({ screenshot })
  // No CDN caching — user just captured a new screenshot? next fetch
  // must see it, not last minute's cached response.
  res.headers.set('Cache-Control', 'no-store, must-revalidate')
  return handleCORS(res)
}
