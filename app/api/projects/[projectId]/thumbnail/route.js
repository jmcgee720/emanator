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

  const screenshot = project.settings?.thumbnail_screenshot || null
  const res = NextResponse.json({ screenshot })
  // No CDN caching — user just captured a new screenshot? next fetch
  // must see it, not last minute's cached response.
  res.headers.set('Cache-Control', 'no-store, must-revalidate')
  return handleCORS(res)
}
