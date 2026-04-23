/**
 * Growth analyze + generate-drafts — native Next.js implementation.
 *
 * Ported 1:1 from `/app/backend/server.py` growth_analyze + growth_generate_drafts.
 * Uses the direct OpenAI SDK with OPENAI_API_KEY (no Emergent dependency).
 *
 * Called by `/app/lib/api/routes/growth.js` when running on Vercel (no Python
 * backend available). On hybrid Vercel+Railway deployments, you can route
 * these to Railway instead by setting `PREFER_NATIVE_GROWTH_LLM=0` in env.
 */

import { getDb } from '@/lib/mongodb'
import { ObjectId } from 'mongodb'
import OpenAI from 'openai'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
  return new OpenAI({ apiKey })
}

function stripFences(raw) {
  let text = (raw || '').trim()
  if (text.startsWith('```')) {
    text = text.split('\n').slice(1).join('\n')
    if (text.endsWith('```')) text = text.slice(0, -3).trim()
  }
  return text
}

/**
 * Pull the 3 most-relevant recent trend signals for a page based on keyword
 * overlap with its title/headings/meta. Same algorithm as the Python impl.
 */
async function buildTrendContext(db, extracted, headings, prefix) {
  try {
    const pageText = (
      (extracted.title || '') + ' ' +
      (extracted.meta_description || '') + ' ' +
      Object.values(headings).flat().join(' ')
    ).toLowerCase()
    const pageWords = new Set(pageText.split(/\s+/).filter(Boolean))

    const recentTrends = await db
      .collection('trend_signals')
      .find({}, { projection: { _id: 0, keyword: 1, source: 1, score: 1 } })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()

    const scored = []
    for (const t of recentTrends) {
      const kwWords = new Set(String(t.keyword || '').toLowerCase().split(/\s+/).filter(Boolean))
      let overlap = 0
      for (const w of kwWords) if (pageWords.has(w)) overlap++
      if (overlap > 0) scored.push([overlap * (t.score || 1), t])
    }
    scored.sort((a, b) => b[0] - a[0])
    const top = scored.slice(0, 3)
    if (!top.length) return ''

    const lines = top.map(([, t]) =>
      prefix === 'full'
        ? `- "${t.keyword}" (source: ${t.source}, score: ${t.score})`
        : `- "${t.keyword}" (score: ${t.score})`
    )
    const header =
      prefix === 'full'
        ? '\n\nCurrently trending topics that may be relevant:\n'
        : 'Trending topics to reference if relevant:\n'
    const suffix =
      prefix === 'full'
        ? '\nIncorporate relevant trending angles into your recommendations if appropriate.'
        : ''
    return header + lines.join('\n') + suffix
  } catch (e) {
    console.warn('[Growth] Trend matching failed:', e.message)
    return ''
  }
}

/**
 * Build persona context. If `personaId` is given, fetch that specific persona.
 * Otherwise use the highest-performance-score persona for the user.
 * Returns {persona, context, error?}.
 */
async function buildPersonaContext(db, userId, personaId, variant) {
  try {
    let persona = null
    if (personaId) {
      let pOid
      try {
        pOid = new ObjectId(personaId)
      } catch {
        return { error: { body: { error: 'Invalid persona_id' }, status: 400 } }
      }
      persona = await db.collection('persona_profiles').findOne(
        { _id: pOid, user_id: userId },
        {
          projection: {
            _id: 0,
            name: 1,
            description: 1,
            interests: 1,
            platforms: 1,
            content_types: 1,
          },
        },
      )
      if (!persona) return { error: { body: { error: 'Persona not found' }, status: 404 } }
    } else {
      const [doc] = await db
        .collection('persona_profiles')
        .find(
          { user_id: userId },
          {
            projection: {
              _id: 0,
              name: 1,
              description: 1,
              interests: 1,
              platforms: 1,
              content_types: 1,
            },
          },
        )
        .sort({ performance_score: -1 })
        .limit(1)
        .toArray()
      persona = doc || null
    }

    if (!persona) return { persona: null, context: '' }

    const interests = (persona.interests || []).join(', ')
    const platforms = (persona.platforms || []).join(', ')
    const content = (persona.content_types || []).join(', ')

    const context =
      variant === 'analyze'
        ? `\n\nTarget audience: ${persona.name} — ${persona.description || ''}. Interests: ${interests}. Platforms: ${platforms}.\nTailor your recommendations to resonate with this audience.`
        : `Target audience: ${persona.name} — ${persona.description || ''}. Interests: ${interests}. Platforms: ${platforms}. Preferred content: ${content}.`

    return { persona, context }
  } catch (e) {
    console.warn('[Growth] Persona injection failed:', e.message)
    return { persona: null, context: '' }
  }
}

/**
 * POST /api/internal/growth/analyze → native implementation.
 * Mirrors the FastAPI contract: body={user_id, page_id, persona_id?}.
 */
export async function analyzeNative({ userId, pageId, personaId }) {
  if (!userId) return { body: { error: 'user_id is required' }, status: 400 }
  if (!pageId) return { body: { error: 'page_id is required' }, status: 400 }

  let oid
  try {
    oid = new ObjectId(pageId)
  } catch {
    return { body: { error: 'Invalid page_id' }, status: 400 }
  }

  const db = await getDb()
  const page = await db.collection('growth_pages').findOne({ _id: oid, user_id: userId })
  if (!page) return { body: { error: 'Page not found' }, status: 404 }

  const extracted = page.extracted_data || {}
  const headings = extracted.headings || {}
  const currentH1 = (headings.h1 && headings.h1[0]) || ''

  const trendContext = await buildTrendContext(db, extracted, headings, 'full')
  const personaRes = await buildPersonaContext(db, userId, personaId, 'analyze')
  if (personaRes.error) return personaRes.error
  const { persona, context: personaContext } = personaRes

  const prompt = `Analyze this webpage's SEO and return ONLY a JSON object with exactly these keys:

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
- URL: ${page.url || 'unknown'}
- Title: ${extracted.title || 'MISSING'} (${extracted.title_length || 0} chars)
- Meta Description: ${extracted.meta_description || 'MISSING'} (${extracted.meta_description_length || 0} chars)
- H1: ${currentH1 || 'MISSING'}
- Canonical: ${extracted.canonical || 'MISSING'}
- OG Tags: ${JSON.stringify(extracted.og_tags || {})}
- Headings: ${JSON.stringify(headings)}
- Word Count: ${extracted.word_count || 0}
- Internal Links: ${extracted.internal_links || 0}
- External Links: ${extracted.external_links || 0}
- Images: ${extracted.total_images || 0} total, ${extracted.images_with_alt || 0} with alt text
- Meta Robots: ${extracted.meta_robots || 'not set'}
${trendContext}
${personaContext}

Return ONLY the JSON object, no markdown, no explanation.`

  let client
  try {
    client = getOpenAIClient()
  } catch (e) {
    return { body: { error: e.message }, status: 500 }
  }

  let raw
  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are an SEO analyst. Return only valid JSON, no markdown fences.' },
        { role: 'user', content: prompt },
      ],
    })
    raw = stripFences(completion.choices[0]?.message?.content || '')
  } catch (e) {
    console.error('[Growth] Analyze LLM error:', e.message)
    return { body: { error: `Analysis failed: ${e.message}` }, status: 500 }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error('[Growth] AI returned invalid JSON:', e.message)
    return { body: { error: 'AI returned invalid JSON, please retry' }, status: 502 }
  }

  // Normalise shape: LLM may return nested {ANALYSIS:{...},FIXES:{...}} or flat keys.
  let opportunities = parsed
  let fixesRaw = {}
  if (opportunities.ANALYSIS && typeof opportunities.ANALYSIS === 'object') {
    fixesRaw = opportunities.FIXES || {}
    opportunities = opportunities.ANALYSIS
  }

  const fixes = {}
  for (const key of ['improved_title', 'improved_meta_description', 'improved_h1']) {
    if (key in opportunities) {
      fixes[key] = opportunities[key]
      delete opportunities[key]
    } else if (key in fixesRaw) {
      fixes[key] = fixesRaw[key]
    }
  }

  const expectedKeys = ['title_issues', 'meta_issues', 'content_issues', 'structure_issues', 'recommendations']
  for (const key of expectedKeys) {
    if (!(key in opportunities)) opportunities[key] = []
  }

  await db.collection('growth_pages').updateOne(
    { _id: oid, user_id: userId },
    {
      $set: {
        opportunities,
        fixes,
        updated_at: new Date().toISOString(),
      },
    },
  )

  console.log(`[Growth] Analyzed page ${pageId} for user ${userId}`)

  return {
    body: {
      success: true,
      page_id: pageId,
      opportunities,
      fixes,
      persona_name: persona ? persona.name : null,
    },
    status: 200,
  }
}

/**
 * POST /api/internal/growth/generate-drafts → native implementation.
 */
export async function generateDraftsNative({ userId, pageId, personaId }) {
  if (!userId) return { body: { error: 'user_id is required' }, status: 400 }
  if (!pageId) return { body: { error: 'page_id is required' }, status: 400 }

  let oid
  try {
    oid = new ObjectId(pageId)
  } catch {
    return { body: { error: 'Invalid page_id' }, status: 400 }
  }

  const db = await getDb()
  const page = await db.collection('growth_pages').findOne({ _id: oid, user_id: userId })
  if (!page) return { body: { error: 'Page not found' }, status: 404 }

  const extracted = page.extracted_data || {}
  const opportunities = page.opportunities || {}
  const fixes = page.fixes || {}
  const headings = extracted.headings || {}
  const currentH1 = (headings.h1 && headings.h1[0]) || ''

  const personaRes = await buildPersonaContext(db, userId, personaId, 'drafts')
  if (personaRes.error) return personaRes.error
  const { context: personaContext } = personaRes

  const trendContext = await buildTrendContext(db, extracted, headings, 'short')

  let fixesContext = ''
  if (fixes) {
    const parts = []
    if (fixes.improved_title) parts.push(`Improved title: ${fixes.improved_title}`)
    if (fixes.improved_meta_description) parts.push(`Improved meta description: ${fixes.improved_meta_description}`)
    if (fixes.improved_h1) parts.push(`Improved H1: ${fixes.improved_h1}`)
    if (parts.length) fixesContext = 'SEO-optimized copy to draw from:\n' + parts.join('\n')
  }

  let issuesSummary = ''
  const recs = opportunities.recommendations || []
  if (recs.length) {
    issuesSummary = 'Top recommendations:\n' + recs.slice(0, 3).map((r) => `- ${r}`).join('\n')
  }

  const prompt = `You are a marketing copywriter. Generate marketing channel drafts for the webpage below.

Return ONLY a JSON object with exactly this structure:
{
  "social_post": {
    "headline": "short punchy headline (max 80 chars)",
    "body": "engaging post body (max 280 chars, suitable for Twitter/LinkedIn)",
    "cta": "call to action (max 40 chars)"
  },
  "search_ad": {
    "headline_1": "Google Ads headline 1 (max 30 chars)",
    "headline_2": "Google Ads headline 2 (max 30 chars)",
    "description": "Google Ads description (max 90 chars)"
  },
  "email": {
    "subject": "email subject line (max 60 chars)",
    "preview_text": "email preview text (max 90 chars)",
    "body_intro": "opening paragraph of the email (2-3 sentences)"
  }
}

Page data:
- URL: ${page.url || 'unknown'}
- Title: ${extracted.title || 'MISSING'}
- Meta Description: ${extracted.meta_description || 'MISSING'}
- H1: ${currentH1 || 'MISSING'}
- Word Count: ${extracted.word_count || 0}
${personaContext}
${trendContext}
${fixesContext}
${issuesSummary}

Rules:
- Make drafts specific to the page content, not generic
- Match tone to the audience persona if provided
- Keep within character limits
- Return ONLY the JSON object, no markdown, no explanation.`

  let client
  try {
    client = getOpenAIClient()
  } catch (e) {
    return { body: { error: e.message }, status: 500 }
  }

  let raw
  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You are a marketing copywriter. Return only valid JSON, no markdown fences.' },
        { role: 'user', content: prompt },
      ],
    })
    raw = stripFences(completion.choices[0]?.message?.content || '')
  } catch (e) {
    console.error('[Growth] Drafts LLM error:', e.message)
    return { body: { error: `Draft generation failed: ${e.message}` }, status: 500 }
  }

  let drafts
  try {
    drafts = JSON.parse(raw)
  } catch (e) {
    console.error('[Growth] Drafts AI returned invalid JSON:', e.message)
    return { body: { error: 'AI returned invalid JSON, please retry' }, status: 502 }
  }

  for (const key of ['social_post', 'search_ad', 'email']) {
    if (!(key in drafts)) drafts[key] = {}
  }

  const now = new Date().toISOString()
  await db.collection('growth_pages').updateOne(
    { _id: oid, user_id: userId },
    {
      $set: {
        drafts,
        drafts_generated_at: now,
        updated_at: now,
      },
    },
  )

  console.log(`[Growth] Generated drafts for page ${pageId}, user ${userId}`)

  return {
    body: {
      success: true,
      page_id: pageId,
      drafts,
    },
    status: 200,
  }
}
