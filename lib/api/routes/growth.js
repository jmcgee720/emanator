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

  // ── Scheduled Check All Monitors (batch) ──
  if (route === '/growth/monitors/check-all' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    try {
      const { monitorDb } = await import('@/lib/growth/service')
      const monitors = await monitorDb.getMonitors(dbUser.id)
      const enabledMonitors = monitors.filter(m => m.enabled !== false)
      if (enabledMonitors.length === 0) {
        return handleCORS(NextResponse.json({ checked: 0, message: 'No enabled monitors' }))
      }

      const results = []
      for (const monitor of enabledMonitors) {
        try {
          const crawlRes = await fetch('http://localhost:8001/api/internal/growth/crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: monitor.url, user_id: dbUser.id, mode: 'single' }),
          })
          const crawlData = await crawlRes.json()
          if (!crawlRes.ok) { results.push({ id: monitor.id, status: 'failed' }); continue }

          const extracted = crawlData.page?.extracted_data || crawlData.extracted_data || {}
          const latestSnapshot = {
            title: extracted.title || '',
            meta_description: extracted.meta_description || '',
            word_count: extracted.word_count || 0,
            h1_count: extracted.headings?.h1?.length || 0,
            h2_count: extracted.headings?.h2?.length || 0,
            image_count: extracted.images?.length || 0,
            link_count: (extracted.internal_links?.length || 0) + (extracted.external_links?.length || 0),
            score: extracted.seo_score || null,
            checked_at: new Date().toISOString(),
          }

          const fullMonitor = await monitorDb.getMonitor(monitor.id, dbUser.id)
          const baseline = fullMonitor?.baseline
          let changes = []
          if (baseline) {
            if (baseline.word_count !== latestSnapshot.word_count) {
              const delta = latestSnapshot.word_count - baseline.word_count
              changes.push({ field: 'Word Count', old: baseline.word_count, new: latestSnapshot.word_count, delta, type: delta > 0 ? 'improved' : 'degraded' })
            }
            if (baseline.h1_count !== latestSnapshot.h1_count) changes.push({ field: 'H1 Tags', old: baseline.h1_count, new: latestSnapshot.h1_count, type: latestSnapshot.h1_count > baseline.h1_count ? 'improved' : 'degraded' })
            if (baseline.image_count !== latestSnapshot.image_count) changes.push({ field: 'Images', old: baseline.image_count, new: latestSnapshot.image_count, type: latestSnapshot.image_count > baseline.image_count ? 'improved' : 'degraded' })
          }

          const counterMoves = changes.filter(c => c.type === 'degraded').map(c => ({
            field: c.field,
            suggestion: `${c.field} decreased from ${c.old} to ${c.new}. Review and optimize.`,
            priority: 'medium',
          }))

          await monitorDb.updateMonitorCheck(monitor.id, dbUser.id, { latest: latestSnapshot, changes, counter_moves: counterMoves })
          results.push({ id: monitor.id, status: 'checked', changes_count: changes.length })
        } catch (monErr) {
          results.push({ id: monitor.id, status: 'error', error: monErr.message })
        }
      }

      return handleCORS(NextResponse.json({ checked: results.length, results }))
    } catch (err) {
      console.error('[Growth] Batch check error:', err)
      return handleCORS(NextResponse.json({ error: 'Batch check failed' }, { status: 500 }))
    }
  }

  // ============ SITE MONITORS ============

  if (route === '/growth/monitors' && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    try {
      const { monitorDb } = await import('@/lib/growth/service')
      const monitors = await monitorDb.getMonitors(dbUser.id)
      return handleCORS(NextResponse.json({ monitors }))
    } catch (err) {
      console.error('[Growth] List monitors error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to list monitors' }, { status: 500 }))
    }
  }

  if (route === '/growth/monitors' && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    try {
      const body = await request.json()
      if (!body.url) return handleCORS(NextResponse.json({ error: 'url is required' }, { status: 400 }))
      const { monitorDb } = await import('@/lib/growth/service')
      const monitor = await monitorDb.addMonitor(dbUser.id, body)
      return handleCORS(NextResponse.json({ monitor }, { status: monitor.already_exists ? 200 : 201 }))
    } catch (err) {
      console.error('[Growth] Add monitor error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to add monitor' }, { status: 500 }))
    }
  }

  if (route.match(/^\/growth\/monitors\/[^/]+\/check$/) && method === 'POST') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const monitorId = route.split('/')[3]
    try {
      const { monitorDb } = await import('@/lib/growth/service')
      const monitor = await monitorDb.getMonitor(monitorId, dbUser.id)
      if (!monitor) return handleCORS(NextResponse.json({ error: 'Monitor not found' }, { status: 404 }))

      // Re-crawl the URL
      const crawlRes = await fetch('http://localhost:8001/api/internal/growth/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: monitor.url, user_id: dbUser.id, mode: 'single' }),
      })
      const crawlData = await crawlRes.json()
      if (!crawlRes.ok) return handleCORS(NextResponse.json({ error: 'Re-crawl failed' }, { status: 500 }))

      const extracted = crawlData.page?.extracted_data || crawlData.extracted_data || {}
      const latestSnapshot = {
        title: extracted.title || '',
        meta_description: extracted.meta_description || '',
        word_count: extracted.word_count || 0,
        h1_count: extracted.headings?.h1?.length || 0,
        h2_count: extracted.headings?.h2?.length || 0,
        image_count: extracted.images?.length || 0,
        link_count: (extracted.internal_links?.length || 0) + (extracted.external_links?.length || 0),
        score: extracted.seo_score || null,
        checked_at: new Date().toISOString(),
      }

      // Compare with baseline
      let changes = null
      const baseline = monitor.baseline
      if (baseline) {
        changes = []
        if (baseline.title !== latestSnapshot.title) changes.push({ field: 'Title', old: baseline.title, new: latestSnapshot.title, type: 'changed' })
        if (baseline.meta_description !== latestSnapshot.meta_description) changes.push({ field: 'Meta Description', old: baseline.meta_description?.slice(0, 80), new: latestSnapshot.meta_description?.slice(0, 80), type: 'changed' })
        if (baseline.word_count !== latestSnapshot.word_count) {
          const delta = latestSnapshot.word_count - baseline.word_count
          changes.push({ field: 'Word Count', old: baseline.word_count, new: latestSnapshot.word_count, delta, type: delta > 0 ? 'improved' : 'degraded' })
        }
        if (baseline.h1_count !== latestSnapshot.h1_count) changes.push({ field: 'H1 Tags', old: baseline.h1_count, new: latestSnapshot.h1_count, type: latestSnapshot.h1_count > baseline.h1_count ? 'improved' : 'degraded' })
        if (baseline.h2_count !== latestSnapshot.h2_count) changes.push({ field: 'H2 Tags', old: baseline.h2_count, new: latestSnapshot.h2_count, type: latestSnapshot.h2_count > baseline.h2_count ? 'improved' : 'degraded' })
        if (baseline.image_count !== latestSnapshot.image_count) changes.push({ field: 'Images', old: baseline.image_count, new: latestSnapshot.image_count, type: latestSnapshot.image_count > baseline.image_count ? 'improved' : 'degraded' })
        if (baseline.link_count !== latestSnapshot.link_count) changes.push({ field: 'Links', old: baseline.link_count, new: latestSnapshot.link_count, type: latestSnapshot.link_count > baseline.link_count ? 'improved' : 'degraded' })
        if (baseline.score !== null && latestSnapshot.score !== null && baseline.score !== latestSnapshot.score) {
          changes.push({ field: 'SEO Score', old: baseline.score, new: latestSnapshot.score, delta: latestSnapshot.score - baseline.score, type: latestSnapshot.score > baseline.score ? 'improved' : 'degraded' })
        }
      }

      // Generate counter-move suggestions if there are changes
      let counterMoves = null
      if (changes && changes.length > 0) {
        counterMoves = changes.filter(c => c.type === 'degraded').map(c => ({
          field: c.field,
          suggestion: `${c.field} decreased from ${c.old} to ${c.new}. Consider reviewing and optimizing this area.`,
          priority: c.field === 'SEO Score' ? 'high' : 'medium',
        }))
        // Add positive reinforcement for improvements
        changes.filter(c => c.type === 'improved').forEach(c => {
          counterMoves.push({ field: c.field, suggestion: `${c.field} improved from ${c.old} to ${c.new}. Keep this momentum.`, priority: 'info' })
        })
      }

      const updated = await monitorDb.updateMonitorCheck(monitorId, dbUser.id, {
        latest: latestSnapshot,
        changes: changes || [],
        counter_moves: counterMoves || [],
      })
      return handleCORS(NextResponse.json({ monitor: updated, changes: changes || [], counter_moves: counterMoves || [] }))
    } catch (err) {
      console.error('[Growth] Monitor check error:', err)
      return handleCORS(NextResponse.json({ error: 'Monitor check failed' }, { status: 500 }))
    }
  }

  if (route.match(/^\/growth\/monitors\/[^/]+$/) && method === 'DELETE') {
    const authUser = await getAuthUser(request)
    if (!authUser) return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    const monitorId = route.split('/').pop()
    try {
      const { monitorDb } = await import('@/lib/growth/service')
      const deleted = await monitorDb.deleteMonitor(monitorId, dbUser.id)
      if (!deleted) return handleCORS(NextResponse.json({ error: 'Monitor not found' }, { status: 404 }))
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      console.error('[Growth] Delete monitor error:', err)
      return handleCORS(NextResponse.json({ error: 'Failed to delete monitor' }, { status: 500 }))
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
