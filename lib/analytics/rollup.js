// ══════════════════════════════════════════════════════════════════════
// ── ANALYTICS AGGREGATOR ──
// Pure rollup of generation_runs rows into dashboard metrics. Extracted
// into its own module so the API route stays thin and the math is
// independently unit-testable.
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} RunRow
 * @property {string} id
 * @property {string} project_id
 * @property {string} tool_mode
 * @property {number} files_generated
 * @property {number|null} duration - ms
 * @property {boolean} success
 * @property {string} provider
 * @property {string} model
 * @property {string} created_at - ISO
 */

/**
 * @typedef {Object} AnalyticsSummary
 * @property {number} totalBuilds
 * @property {number} totalFiles
 * @property {number} successRate  0..1
 * @property {number} avgDurationMs
 * @property {number} p95DurationMs
 * @property {Object.<string, number>} byProvider
 * @property {Object.<string, number>} byModel
 * @property {Object.<string, number>} byArchetype
 * @property {Array<{date: string, builds: number, success: number}>} timeline
 * @property {Array<RunRow>} recent - last 10 rows
 */

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.floor((p / 100) * sorted.length)
  return sorted[Math.min(idx, sorted.length - 1)]
}

/**
 * Parse archetype identifier out of a tool_mode string.
 * Formats: `new_pipeline:landing`, `new_pipeline_aborted`, `tool_loop`, etc.
 * @private
 */
function parseArchetype(toolMode) {
  if (typeof toolMode !== 'string') return 'other'
  if (toolMode.startsWith('new_pipeline:')) return toolMode.split(':')[1] || 'unknown'
  if (toolMode === 'new_pipeline_aborted') return 'aborted'
  if (toolMode.includes('tool_loop')) return 'tool_loop'
  return toolMode.slice(0, 24) || 'other'
}

/**
 * Group YYYY-MM-DD → count + success-count.
 * @private
 */
function buildTimeline(runs) {
  const byDay = {}
  for (const r of runs) {
    const day = String(r.created_at || '').slice(0, 10)
    if (!day) continue
    if (!byDay[day]) byDay[day] = { date: day, builds: 0, success: 0 }
    byDay[day].builds++
    if (r.success) byDay[day].success++
  }
  return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * @param {Array<RunRow>} runs
 * @returns {AnalyticsSummary}
 */
export function rollupAnalytics(runs = []) {
  const list = Array.isArray(runs) ? runs : []

  const totalBuilds = list.length
  const totalFiles = list.reduce((sum, r) => sum + (Number(r.files_generated) || 0), 0)
  const successCount = list.filter((r) => r.success !== false).length
  const successRate = totalBuilds > 0 ? successCount / totalBuilds : 0

  const durations = list
    .map((r) => Number(r.duration))
    .filter((n) => Number.isFinite(n) && n > 0)
  const avgDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0
  const sorted = [...durations].sort((a, b) => a - b)
  const p95DurationMs = Math.round(percentile(sorted, 95))

  const byProvider = {}
  const byModel = {}
  const byArchetype = {}
  for (const r of list) {
    const p = r.provider || 'unknown'
    const m = r.model || 'unknown'
    const a = parseArchetype(r.tool_mode)
    byProvider[p] = (byProvider[p] || 0) + 1
    byModel[m] = (byModel[m] || 0) + 1
    byArchetype[a] = (byArchetype[a] || 0) + 1
  }

  const timeline = buildTimeline(list)
  const recent = list.slice(0, 10)

  return {
    totalBuilds,
    totalFiles,
    successRate,
    avgDurationMs,
    p95DurationMs,
    byProvider,
    byModel,
    byArchetype,
    timeline,
    recent,
  }
}
