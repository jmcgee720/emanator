/**
 * Trend signals — native Next.js implementation (ported from server.py).
 *
 * Fetches from:
 *   1. Google Trends RSS (https://trends.google.com/trending/rss?geo=US)
 *   2. Hacker News top stories (via Firebase public API)
 *
 * Stores results in MongoDB collection `trend_signals`.
 *
 * No external service dependency — runs on Vercel serverless out of the box.
 */

import { getDb } from '@/lib/mongodb'
import * as cheerio from 'cheerio'

const USER_AGENT = 'Mozilla/5.0 (compatible; EmanatorBot/1.0)'
const HN_TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json'
const HN_ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`
const GOOGLE_RSS = 'https://trends.google.com/trending/rss?geo=US'

async function fetchGoogleTrends() {
  const signals = []
  try {
    const resp = await fetch(GOOGLE_RSS, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return signals
    const xml = await resp.text()
    // Parse RSS with cheerio in XML mode.
    const $ = cheerio.load(xml, { xmlMode: true })
    $('item').slice(0, 20).each((_, el) => {
      const $el = $(el)
      const title = $el.find('title').first().text().trim()
      const trafficRaw = $el.find('ht\\:approx_traffic, approx_traffic').first().text() || '0'
      const trafficClean = trafficRaw.replace(/[+,]/g, '').trim()
      const score = /^\d+$/.test(trafficClean) ? parseInt(trafficClean, 10) : 100
      if (title) {
        signals.push({
          keyword: title.toLowerCase(),
          source: 'google_trends',
          score,
          created_at: new Date().toISOString(),
        })
      }
    })
  } catch (e) {
    console.warn('[Trends] Google Trends fetch failed:', e.message)
  }
  return signals
}

async function fetchHackerNews() {
  const signals = []
  try {
    const idsResp = await fetch(HN_TOP, { signal: AbortSignal.timeout(10000) })
    if (!idsResp.ok) return signals
    const ids = (await idsResp.json()).slice(0, 15)

    const stories = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(HN_ITEM(id), { signal: AbortSignal.timeout(10000) })
          return r.ok ? await r.json() : null
        } catch {
          return null
        }
      }),
    )

    for (const story of stories) {
      if (!story?.title) continue
      signals.push({
        keyword: story.title.trim().toLowerCase(),
        source: 'hackernews',
        score: story.score || 0,
        created_at: new Date().toISOString(),
      })
    }
  } catch (e) {
    console.warn('[Trends] HN fetch failed:', e.message)
  }
  return signals
}

/**
 * Fetch latest trending signals from Google Trends + HN and store in MongoDB.
 * Returns the count of signals inserted.
 */
export async function fetchTrends() {
  const db = await getDb()
  const [google, hn] = await Promise.all([fetchGoogleTrends(), fetchHackerNews()])
  const signals = [...google, ...hn]

  if (signals.length > 0) {
    await db.collection('trend_signals').insertMany(signals)
  }

  const googleCount = signals.filter((s) => s.source === 'google_trends').length
  const hnCount = signals.filter((s) => s.source === 'hackernews').length
  console.log(`[Trends] Fetched ${signals.length} signals (Google: ${googleCount}, HN: ${hnCount})`)

  return { count: signals.length, google: googleCount, hackernews: hnCount }
}

/**
 * Return the 50 most recent trend signals.
 */
export async function listTrends(limit = 50) {
  const db = await getDb()
  const trends = await db
    .collection('trend_signals')
    .find({}, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray()
  return { trends }
}
