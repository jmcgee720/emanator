// POST /api/projects/:projectId/thumbnail-refresh
//
// Captures a live screenshot of the project's Fly preview and stores it
// in Supabase Storage. This is Workstream 4 — makes dashboard tiles show
// the REAL running app instead of a best-guess in-browser Babel compile.
//
// v2 (2026-07-08): moved image storage OUT of project.settings and INTO
// Supabase Storage. Previous version stuffed a 60-150 KB base64 data
// URL inside settings.thumbnail_screenshot.data_url. Every subsequent
// PUT to `settings` (preview_snapshot, aurora_config, gallery, domain,
// deployments) then had to include the whole bloated blob, and any
// combined update easily blew past Vercel's 4.5 MB serverless body
// limit → HTTP 413 Request Entity Too Large → cascading write failures.
//
// Now: PNG goes to Supabase Storage bucket `project-thumbnails`.
// Settings only stores the public URL + a captured_at timestamp.

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db, getSupabaseAdmin } from '@/lib/supabase/db'
import { previewAppPublicUrl } from '@/lib/fly/apps'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SCREENSHOTONE_BASE = 'https://api.screenshotone.com/take'
const THUMBNAIL_BUCKET = 'project-thumbnails'

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
      timeout: '25',
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
    const capturedAt = new Date().toISOString()

    // Upload PNG to Supabase Storage. Filename includes a timestamp so
    // the URL changes every capture (busts browser cache without needing
    // Cache-Control headers). Old thumbnails are cleaned up below.
    const supabase = getSupabaseAdmin()
    // Ensure the bucket exists (idempotent — createBucket returns
    // "already exists" error on subsequent calls which we ignore).
    try {
      await supabase.storage.createBucket(THUMBNAIL_BUCKET, {
        public: true,
        fileSizeLimit: '2MB',
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      })
    } catch { /* bucket already exists — expected */ }

    const filename = `${projectId}/${Date.now()}.png`
    const { error: uploadErr } = await supabase.storage
      .from(THUMBNAIL_BUCKET)
      .upload(filename, buf, {
        contentType: 'image/png',
        cacheControl: '31536000', // 1yr — filename has timestamp so it's safe
        upsert: false,
      })
    if (uploadErr) {
      return handleCORS(NextResponse.json({
        error: 'Failed to upload screenshot to storage',
        detail: uploadErr.message,
      }, { status: 500 }))
    }

    const { data: pub } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(filename)
    const publicUrl = pub?.publicUrl
    if (!publicUrl) {
      return handleCORS(NextResponse.json({
        error: 'Failed to resolve public URL for uploaded screenshot',
      }, { status: 500 }))
    }

    // Save ONLY the URL + metadata into settings — never the image data.
    // Also strips any legacy base64 data_url from settings so old bloated
    // rows self-heal on next capture.
    const cleanSettings = { ...(project.settings || {}) }
    if (cleanSettings.thumbnail_screenshot?.data_url) {
      delete cleanSettings.thumbnail_screenshot.data_url
    }
    cleanSettings.thumbnail_screenshot = {
      url: publicUrl,
      captured_at: capturedAt,
      bytes: buf.byteLength,
      source: 'screenshotone',
    }
    await db.projects.update(projectId, { settings: cleanSettings })

    // Best-effort cleanup: keep only the 3 most recent thumbnails per
    // project so the bucket doesn't grow forever. Errors here are
    // logged but not surfaced — the current capture succeeded.
    try {
      const { data: existing } = await supabase.storage.from(THUMBNAIL_BUCKET).list(projectId)
      if (existing && existing.length > 3) {
        const stale = existing
          .sort((a, b) => (a.name < b.name ? 1 : -1)) // newest first
          .slice(3)
          .map(f => `${projectId}/${f.name}`)
        await supabase.storage.from(THUMBNAIL_BUCKET).remove(stale)
      }
    } catch (err) {
      console.warn('[thumbnail-refresh] cleanup failed:', err?.message)
    }

    return handleCORS(NextResponse.json({
      ok: true,
      url: publicUrl,
      captured_at: capturedAt,
      bytes: buf.byteLength,
    }))
  } catch (err) {
    console.error('[thumbnail-refresh] failed:', err)
    return handleCORS(NextResponse.json({ error: err?.message || 'capture failed' }, { status: 500 }))
  }
}
