/**
 * Cron Worker for Scheduled Monitor Auto-Crawl
 * Runs as a background process, checking for due schedules every 5 minutes
 * and triggering the check-all monitors endpoint for users whose schedule is due.
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

async function runScheduledCrawls() {
  try {
    // Import MongoDB client directly since this runs outside Next.js
    const { MongoClient, ObjectId } = await import('mongodb')
    const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017'

    const client = new MongoClient(mongoUrl)
    await client.connect()
    const dbName = process.env.DB_NAME || 'test_database'
    const db = client.db(dbName)

    const now = new Date().toISOString()
    const dueSchedules = await db.collection('monitor_schedules')
      .find({ enabled: true, next_run: { $lte: now } })
      .toArray()

    if (dueSchedules.length === 0) {
      await client.close()
      return
    }

    console.log(`[CronWorker] Found ${dueSchedules.length} due schedule(s)`)

    for (const schedule of dueSchedules) {
      const userId = schedule.user_id
      console.log(`[CronWorker] Running auto-crawl for user ${userId}`)

      try {
        // Get enabled monitors for this user
        const monitors = await db.collection('growth_monitors')
          .find({ user_id: userId, enabled: true })
          .toArray()

        if (monitors.length === 0) {
          console.log(`[CronWorker] No enabled monitors for user ${userId}, skipping`)
        } else {
          console.log(`[CronWorker] Checking ${monitors.length} monitor(s) for user ${userId}`)

          for (const monitor of monitors) {
            try {
              // Call the internal crawl endpoint directly
              const crawlRes = await fetch('http://localhost:8001/api/internal/growth/crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: monitor.url, user_id: userId, mode: 'single' }),
                signal: AbortSignal.timeout(30000),
              })

              if (crawlRes.ok) {
                const crawlData = await crawlRes.json()
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

                const baseline = monitor.baseline
                let changes = []
                if (baseline) {
                  if (baseline.word_count !== latestSnapshot.word_count) {
                    const delta = latestSnapshot.word_count - baseline.word_count
                    changes.push({ field: 'Word Count', old: baseline.word_count, new: latestSnapshot.word_count, delta, type: delta > 0 ? 'improved' : 'degraded' })
                  }
                  if (baseline.h1_count !== latestSnapshot.h1_count) changes.push({ field: 'H1 Tags', old: baseline.h1_count, new: latestSnapshot.h1_count, type: latestSnapshot.h1_count > baseline.h1_count ? 'improved' : 'degraded' })
                  if (baseline.image_count !== latestSnapshot.image_count) changes.push({ field: 'Images', old: baseline.image_count, new: latestSnapshot.image_count, type: latestSnapshot.image_count > baseline.image_count ? 'improved' : 'degraded' })
                }

                const update = {
                  $set: {
                    latest: latestSnapshot,
                    changes,
                    counter_moves: changes.filter(c => c.type === 'degraded').map(c => ({
                      field: c.field,
                      suggestion: `${c.field} decreased from ${c.old} to ${c.new}. Review and optimize.`,
                      priority: 'medium',
                    })),
                    last_checked_at: new Date().toISOString(),
                  },
                  $inc: { checks: 1 },
                }

                if (!monitor.baseline) {
                  update.$set.baseline = latestSnapshot
                }

                await db.collection('growth_monitors').updateOne(
                  { _id: monitor._id },
                  update
                )
                console.log(`[CronWorker] Checked monitor ${monitor.url}`)
              }
            } catch (monErr) {
              console.warn(`[CronWorker] Failed to check monitor ${monitor.url}:`, monErr.message)
            }
          }
        }

        // Compute next run time
        const freqMs = { '6h': 21600000, '12h': 43200000, '24h': 86400000, '48h': 172800000, '7d': 604800000 }
        const nextRun = new Date(Date.now() + (freqMs[schedule.frequency] || 86400000)).toISOString()

        await db.collection('monitor_schedules').updateOne(
          { _id: schedule._id },
          { $set: { last_run: new Date().toISOString(), next_run: nextRun } }
        )
        console.log(`[CronWorker] Updated schedule for user ${userId}, next run: ${nextRun}`)
      } catch (userErr) {
        console.error(`[CronWorker] Error processing user ${userId}:`, userErr.message)
      }
    }

    await client.close()
  } catch (err) {
    console.error('[CronWorker] Fatal error:', err.message)
  }
}

// Main loop
console.log('[CronWorker] Starting scheduled auto-crawl worker')
console.log(`[CronWorker] Polling every ${POLL_INTERVAL_MS / 1000}s`)

// Run immediately on start, then on interval
runScheduledCrawls()
setInterval(runScheduledCrawls, POLL_INTERVAL_MS)
