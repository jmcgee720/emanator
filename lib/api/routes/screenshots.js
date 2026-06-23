/**
 * Screenshot service — captures a PNG of any project's live Fly preview
 * URL and returns it as base64. The captured image is the actual rendered
 * pixels the user is seeing — gives the agent vision into its own work.
 *
 * Architecture:
 *   • Agent invokes the `screenshot_preview` tool with a project-relative
 *     intent (current screen, after-an-edit, before-an-edit).
 *   • Tool calls `POST /screenshots/capture` on this same backend with
 *     { projectId, waitFor?, viewportWidth?, viewportHeight? }.
 *   • Server resolves the project's public Fly preview URL via
 *     `previewAppPublicUrl(projectId)`, forwards to ScreenshotOne with
 *     the access key from env. Returns the PNG as base64.
 *   • Tool's execute() packages the base64 into a vision content block
 *     that Claude reads on the next turn — same shape as a user-uploaded
 *     image attachment.
 *
 * Why ScreenshotOne and not self-hosted Playwright:
 *   • Playwright on Vercel needs @sparticuz/chromium-min (~50MB package)
 *     plus careful Lambda-layer config — known to break under Fluid
 *     Compute startup budgets. We've already burned a session debugging
 *     stream timeouts; not introducing a new vector.
 *   • ScreenshotOne: $0/month free tier (100 shots), $19/mo Pro (5000),
 *     stable API, zero infra to maintain. Migrate later if we hit the
 *     cap or want to self-host.
 *
 * Env var required:
 *   SCREENSHOTONE_ACCESS_KEY — sign up at https://screenshotone.com
 *
 * If the env var is missing the endpoint returns a clear 503 with
 * instructions instead of crashing — the agent surfaces this verbatim
 * to the user so they know how to enable visual verification.
 */

import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { previewAppPublicUrl } from '@/lib/fly/apps'

const SCREENSHOTONE_BASE = 'https://api.screenshotone.com/take'

export async function handle(route, method, path, request) {
  // POST /screenshots/capture
  if (route === '/screenshots/capture' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const key = process.env.SCREENSHOTONE_ACCESS_KEY
    if (!key) {
      // Helpful error — surface configuration step to the agent (and
      // through it, to the user) instead of failing opaquely. Agents
      // are notorious for swallowing config errors and pretending the
      // task succeeded.
      return handleCORS(NextResponse.json({
        error: 'Screenshot service not configured',
        action_required: 'Add SCREENSHOTONE_ACCESS_KEY to Vercel env vars. Free tier (100/month) at https://screenshotone.com — sign up, copy access key from dashboard, paste into Vercel project settings → Environment Variables, redeploy.',
      }, { status: 503 }))
    }

    try {
      const body = await request.json()
      const { projectId, waitFor, viewportWidth, viewportHeight, fullPage, deviceScaleFactor } = body
      if (!projectId) {
        return handleCORS(NextResponse.json({ error: 'projectId required' }, { status: 400 }))
      }

      // Verify the caller actually owns the project — without this any
      // logged-in user could screenshot any project's preview.
      const project = await db.projects.findById(projectId)
      if (!project) {
        return handleCORS(NextResponse.json({ error: 'Project not found' }, { status: 404 }))
      }
      if (project.user_id !== dbUser.id) {
        return handleCORS(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
      }

      const targetUrl = previewAppPublicUrl(projectId)

      // ScreenshotOne query params. Defaults mirror the Auroraly preview
      // iframe (400×700, ~2x DPR for retina-quality vision input).
      const params = new URLSearchParams({
        access_key: key,
        url: targetUrl,
        format: 'png',
        viewport_width: String(viewportWidth || 400),
        viewport_height: String(viewportHeight || 700),
        device_scale_factor: String(deviceScaleFactor || 2),
        full_page: String(Boolean(fullPage)),
        // Cache for 60s on their side — repeated screenshot_preview calls
        // within the same agent turn return instantly + don't burn quota.
        cache: 'true',
        cache_ttl: '60',
        // Block ad-frames so a posthog or analytics network call doesn't
        // delay the capture. Sites with analytics overlays still get
        // captured correctly — only blocking known trackers.
        block_ads: 'true',
        block_trackers: 'true',
        // Wait until the network is idle. Phaser games take ~1-2s to
        // boot — without this we'd capture the React loading overlay
        // instead of the actual rendered scene.
        wait_until: 'networkidle0',
        // Hard ceiling so a runaway preview can't hang the agent.
        timeout: '20',
      })
      // Optional: wait for a specific CSS selector before capturing.
      // Useful for game canvases that mount asynchronously.
      if (waitFor) {
        params.set('selector', String(waitFor))
        params.set('selector_scroll_into_view', 'false')
      }

      const upstream = await fetch(`${SCREENSHOTONE_BASE}?${params.toString()}`, {
        method: 'GET',
        // Don't follow redirects — ScreenshotOne returns the image directly.
        redirect: 'manual',
      })

      if (!upstream.ok) {
        const errBody = await upstream.text().catch(() => '')
        console.error('[screenshots] ScreenshotOne returned non-OK:', upstream.status, errBody.slice(0, 200))
        return handleCORS(NextResponse.json({
          error: `Screenshot service returned ${upstream.status}`,
          detail: errBody.slice(0, 400),
        }, { status: 502 }))
      }

      const buf = await upstream.arrayBuffer()
      const base64 = Buffer.from(buf).toString('base64')

      // Light usage logging — helps the operator (you) see how often the
      // agent screenshots vs how often it should. Not a metric system,
      // just enough to spot abuse / a stuck loop.
      console.log(`[screenshots] captured ${buf.byteLength} bytes for project ${projectId} → ${targetUrl}`)

      return handleCORS(NextResponse.json({
        url: targetUrl,
        captured_at: new Date().toISOString(),
        mime_type: 'image/png',
        bytes: buf.byteLength,
        base64,
      }))
    } catch (err) {
      console.error('[screenshots] capture failed:', err)
      return handleCORS(NextResponse.json({ error: err.message || 'Capture failed' }, { status: 500 }))
    }
  }

  return null
}
