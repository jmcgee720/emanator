import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'

export async function handle(route, method, path, request) {
  if (route === '/growth/crawl' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const isBatch = body.mode === 'batch'
      const controller = new AbortController()
      const timeoutMs = isBatch ? 180000 : 30000
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      const res = await fetch('http://localhost:8001/api/internal/growth/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, user_id: dbUser.id }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const data = await res.json()
      return handleCORS(NextResponse.json(data, { status: res.status }))
    } catch (err) {
      console.error('[Growth] Crawl proxy error:', err)
      if (err.name === 'AbortError') {
        return handleCORS(NextResponse.json({ error: 'Batch crawl timed out' }, { status: 504 }))
      }
      return handleCORS(NextResponse.json({ error: 'Crawl failed' }, { status: 500 }))
    }
  }

  if (route === '/growth/crawl/progress' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    try {
      const res = await fetch(`http://localhost:8001/api/internal/growth/crawl/progress?user_id=${dbUser.id}`)
      const data = await res.json()
      return handleCORS(NextResponse.json(data))
    } catch {
      return handleCORS(NextResponse.json({ active: false }))
    }
  }

  if (route === '/growth/analyze' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()

      // Validate persona ownership if persona_id provided
      if (body.persona_id) {
        const { personaDb } = await import('@/lib/growth/service')
        const personas = await personaDb.getPersonas(dbUser.id)
        const owned = personas.some(p => p.id === body.persona_id)
        if (!owned) {
          return handleCORS(NextResponse.json({ error: 'Persona not found' }, { status: 404 }))
        }
      }

      const res = await fetch('http://localhost:8001/api/internal/growth/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, user_id: dbUser.id }),
      })
      const data = await res.json()
      return handleCORS(NextResponse.json(data, { status: res.status }))
    } catch (err) {
      console.error('[Growth] Analyze proxy error:', err)
      return handleCORS(NextResponse.json({ error: 'Analysis failed' }, { status: 500 }))
    }
  }

  if (route === '/growth/generate-drafts' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()

      if (body.persona_id) {
        const { personaDb } = await import('@/lib/growth/service')
        const personas = await personaDb.getPersonas(dbUser.id)
        const owned = personas.some(p => p.id === body.persona_id)
        if (!owned) {
          return handleCORS(NextResponse.json({ error: 'Persona not found' }, { status: 404 }))
        }
      }

      const res = await fetch('http://localhost:8001/api/internal/growth/generate-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, user_id: dbUser.id }),
      })
      const data = await res.json()
      return handleCORS(NextResponse.json(data, { status: res.status }))
    } catch (err) {
      console.error('[Growth] Generate drafts proxy error:', err)
      return handleCORS(NextResponse.json({ error: 'Draft generation failed' }, { status: 500 }))
    }
  }

  if (route === '/growth/pages' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const { growthDb } = await import('@/lib/growth/service')
      const pages = await growthDb.getPages(dbUser.id)
      return handleCORS(NextResponse.json({ pages }))
    } catch (err) {
      console.error('[Growth] List pages error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to list pages' }, { status: 500 }))
    }
  }

  if (route === '/growth/pages/export' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    try {
      const { growthDb } = await import('@/lib/growth/service')
      const pages = await growthDb.getAllPagesFull(dbUser.id)
      return handleCORS(NextResponse.json({ exported_at: new Date().toISOString(), total_pages: pages.length, pages }))
    } catch (err) {
      console.error('[Growth] Export error:', err)
      return handleCORS(NextResponse.json({ error: 'Export failed' }, { status: 500 }))
    }
  }

  if (route.match(/^\/growth\/pages\/[^/]+$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const pageId = route.split('/').pop()
    try {
      const { growthDb } = await import('@/lib/growth/service')
      const page = await growthDb.getPage(pageId, dbUser.id)
      if (!page) {
        return handleCORS(NextResponse.json({ error: 'Page not found' }, { status: 404 }))
      }
      return handleCORS(NextResponse.json({ page }))
    } catch (err) {
      console.error('[Growth] Get page error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to get page' }, { status: 500 }))
    }
  }

  if (route.match(/^\/growth\/pages\/[^/]+$/) && method === 'DELETE') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    const pageId = route.split('/').pop()
    try {
      const { growthDb } = await import('@/lib/growth/service')
      const deleted = await growthDb.deletePage(pageId, dbUser.id)
      if (!deleted) {
        return handleCORS(NextResponse.json({ error: 'Page not found' }, { status: 404 }))
      }
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      console.error('[Growth] Delete page error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to delete page' }, { status: 500 }))
    }
  }

  // ============ GROWTH FEEDBACK ============

  if (route === '/growth/feedback' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    try {
      const body = await request.json()
      if (!body.page_id || !body.content_type || body.rating === undefined) {
        return handleCORS(NextResponse.json({ error: 'page_id, content_type, and rating are required' }, { status: 400 }))
      }
      const validTypes = ['seo_analysis', 'fixes', 'social_post', 'search_ad', 'email']
      if (!validTypes.includes(body.content_type)) {
        return handleCORS(NextResponse.json({ error: `content_type must be one of: ${validTypes.join(', ')}` }, { status: 400 }))
      }
      if (![1, -1].includes(body.rating)) {
        return handleCORS(NextResponse.json({ error: 'rating must be 1 (thumbs up) or -1 (thumbs down)' }, { status: 400 }))
      }

      const { feedbackDb, personaDb } = await import('@/lib/growth/service')
      const result = await feedbackDb.submitFeedback(dbUser.id, body)

      // Update persona score if persona_id provided
      if (body.persona_id) {
        const scoreDelta = body.rating - (result.old_rating || 0)
        if (scoreDelta !== 0) {
          await personaDb.updatePersonaScore(body.persona_id, dbUser.id, scoreDelta)
        }
      }

      return handleCORS(NextResponse.json({ success: true, rating: body.rating }, { status: 201 }))
    } catch (err) {
      console.error('[Feedback] Submit error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 }))
    }
  }

  if (route.match(/^\/growth\/feedback\/[^/]+$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    const pageId = route.split('/').pop()
    try {
      const { feedbackDb } = await import('@/lib/growth/service')
      const feedback = await feedbackDb.getFeedback(dbUser.id, pageId)
      return handleCORS(NextResponse.json({ feedback }))
    } catch (err) {
      console.error('[Feedback] Get error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to get feedback' }, { status: 500 }))
    }
  }

  // ============ TRENDS ============

  if (route === '/trends/fetch' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    try {
      const res = await fetch('http://localhost:8001/api/internal/trends/fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      return handleCORS(NextResponse.json(data, { status: res.status }))
    } catch (err) {
      console.error('[Trends] Fetch proxy error:', err)
      return handleCORS(NextResponse.json({ error: 'Trend fetch failed' }, { status: 500 }))
    }
  }

  if (route === '/trends' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))

    try {
      const res = await fetch('http://localhost:8001/api/internal/trends/list')
      const data = await res.json()
      return handleCORS(NextResponse.json(data))
    } catch (err) {
      console.error('[Trends] List proxy error:', err)
      return handleCORS(NextResponse.json({ error: 'Trend list failed' }, { status: 500 }))
    }
  }

  return null
}
