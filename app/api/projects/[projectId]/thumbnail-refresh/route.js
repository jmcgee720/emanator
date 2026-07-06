// POST /api/projects/:projectId/thumbnail-refresh
//
// Captures a live screenshot of the project's Fly preview and stores it
// as the project's dashboard thumbnail. This is Workstream 4 in the
// preview-pipeline overhaul — makes dashboard tiles show the REAL
// running app instead of a best-guess in-browser Babel compile.
//
// Flow:
//   1. Auth + ownership checks
//   2. Resolve the project's public Fly preview URL
//   3. Call ScreenshotOne (SCREENSHOTONE_ACCESS_KEY required)
//   4. Save the base64 data URL to project.settings.thumbnail_screenshot
//   5. Return { url, captured_at }
//
// If SCREENSHOTONE_ACCESS_KEY is missing, return 503 with a clear
// action_required hint so the UI can surface it to the operator.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { previewAppPublicUrl } from '@/lib/fly/apps'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SCREENSHOTONE_BASE = 'https://api.screenshotone.com/take'

export async function OPTIONS() {
  return handleCORS(NextResponse.json({}, { status: 200 }))
}

export async function POST(request, { params }) {
  const authUser = await getAuthUser(request)
  if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  const dbUser = await checkAllowlist(authUser.email)
  if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

  const projectId = params.projectId
  const project = await db.projects.findById(projectId)
  if (!project) return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
  if (project.user_id !== dbUser.id) {
    return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  }

  const key = process.env.SCREENSHOTONE_ACCESS_KEY
  if (!key) {
    return handleCORS(NextResponse.json({
      error: 'Thumbnail service not configured',
      action_required: 'Add SCREENSHOTONE_ACCESS_KEY to Vercel env vars. Free tier at https://screenshotone.com (100/month).',
    }, { status: 503 }))
  }

  try {
    const targetUrl = previewAppPublicUrl(projectId)
    // Thumbnail-optimised capture params: 1280×960 matches the ProjectGrid
    // iframe aspect ratio (scaled down to fit the 4:3 tile). Full-page
    // false so users see the "above the fold" first paint — same as
    // what the tile currently shows via Babel snapshot.
    const params = new URLSearchParams({
      access_key: key,
      url: targetUrl,
      format: 'png',
      viewport_width: '1280',
      viewport_height: '960',
      device_scale_factor: '1',
      full_page: 'false',
      cache: 'true',
      cache_ttl: '60',
      block_ads: 'true',
      block_trackers: 'true',
      wait_until: 'networkidle0',
      // Bigger timeout than the agent-tool version — thumbnails need to
      // wait longer for slow-boot Node apps (Next.js compiles on first
      // request, needs ~5-10s before the DOM is stable).
      timeout: '25',
      // Small extra delay so React streaming/suspense fallbacks resolve.
      delay: '1',
    })

    const upstream = await fetch(`${SCREENSHOTONE_BASE}?${params.toString()}`, {
      method: 'GET',
      redirect: 'manual',
    })

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '')
      return handleCORS(NextResponse.json({
        error: `Screenshot service returned ${upstream.status}`,
        detail: errBody.slice(0, 400),
      }, { status: 502 }))
    }

    const buf = await upstream.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`
    const capturedAt = new Date().toISOString()

    // Save into project.settings.thumbnail_screenshot. Kept as a data URL
    // so it can be embedded directly in <img src> without extra storage
    // infrastructure. Typical size is 60-150 KB PNG (with our viewport
    // + block_ads settings) — well under Supabase's 1 MB JSON field cap.
    const settings = {
      ...(project.settings || {}),
      thumbnail_screenshot: {
        data_url: dataUrl,
        captured_at: capturedAt,
        bytes: buf.byteLength,
        source: 'screenshotone',
      },
    }
    await db.projects.update(projectId, { settings })

    return handleCORS(NextResponse.json({
      ok: true,
      captured_at: capturedAt,
      bytes: buf.byteLength,
    }))
  } catch (err) {
    console.error('[thumbnail-refresh] failed:', err)
    return handleCORS(NextResponse.json({ error: err?.message || 'capture failed' }, { status: 500 }))
  }
}
