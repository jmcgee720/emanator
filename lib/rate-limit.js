/**
 * Rate limiting — MongoDB-backed sliding window counter.
 *
 * Usage:
 *   const { allowed, retryAfterMs } = await checkRateLimit('signup:ip:1.2.3.4', 5, 60*60*1000)
 *   if (!allowed) return 429 with Retry-After header
 *
 * How it works:
 *   - Each call appends an attempt doc to `rate_limit_attempts` with a TTL.
 *   - Counts attempts for the given `key` within the last `windowMs`.
 *   - If count >= limit, returns {allowed: false, retryAfterMs}.
 *   - If count < limit, inserts a new attempt and returns {allowed: true}.
 *
 * Index `{key: 1, created_at: 1}` keeps lookups O(log n).
 * TTL index on `created_at` with `expireAfterSeconds` matching windowMs
 * cleans up stale rows automatically.
 */

import { getDb } from '@/lib/mongodb'

let _indexEnsured = false

async function ensureIndexes(db) {
  if (_indexEnsured) return
  try {
    await db.collection('rate_limit_attempts').createIndex(
      { key: 1, created_at: 1 },
      { name: 'rl_key_created' },
    )
    // TTL: auto-delete rows older than 2 hours (covers any reasonable window).
    await db.collection('rate_limit_attempts').createIndex(
      { created_at: 1 },
      { expireAfterSeconds: 7200, name: 'rl_ttl' },
    )
    _indexEnsured = true
  } catch (e) {
    // Index already exists with different spec → ignore.
    if (!/already exists/i.test(e.message)) {
      console.warn('[RateLimit] Index creation failed:', e.message)
    }
    _indexEnsured = true
  }
}

/**
 * Check whether a rate-limited key is allowed to proceed.
 * @param {string} key e.g. `signup:ip:1.2.3.4`
 * @param {number} limit Max attempts within `windowMs`.
 * @param {number} windowMs Window size in milliseconds.
 * @param {object} [opts]
 * @param {boolean} [opts.record=true] When true (default), a new attempt is
 *   inserted if allowed. Set false for read-only checks.
 * @returns {Promise<{allowed:boolean, retryAfterMs:number, count:number}>}
 */
export async function checkRateLimit(key, limit, windowMs, opts = {}) {
  const record = opts.record !== false
  const db = await getDb()
  await ensureIndexes(db)

  const now = Date.now()
  const windowStart = new Date(now - windowMs)
  const coll = db.collection('rate_limit_attempts')

  // Count existing attempts in window.
  const count = await coll.countDocuments({
    key,
    created_at: { $gte: windowStart },
  })

  if (count >= limit) {
    // Find the oldest attempt in the window to compute accurate retryAfter.
    const oldest = await coll
      .find({ key, created_at: { $gte: windowStart } }, { projection: { created_at: 1 } })
      .sort({ created_at: 1 })
      .limit(1)
      .toArray()
    const oldestTs = oldest[0]?.created_at?.getTime() || now
    const retryAfterMs = Math.max(0, oldestTs + windowMs - now)
    return { allowed: false, retryAfterMs, count }
  }

  if (record) {
    await coll.insertOne({
      key,
      created_at: new Date(now),
    })
  }

  return { allowed: true, retryAfterMs: 0, count: count + (record ? 1 : 0) }
}

/**
 * Format a retry-after window as a human-readable "X minutes" / "X seconds" string.
 */
export function formatRetryAfter(retryAfterMs) {
  const s = Math.ceil(retryAfterMs / 1000)
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.ceil(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.ceil(m / 60)
  return `${h} hour${h === 1 ? '' : 's'}`
}

/**
 * Extract the caller IP from a Next.js request, with reasonable fallbacks.
 * Prefers `X-Forwarded-For` (Vercel / most reverse proxies set this).
 */
export function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}
