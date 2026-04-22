// ══════════════════════════════════════════════════════════════════════
// ── BUILD QUALITY SCORE ──
// Combines every observability signal the pipeline produces into ONE
// 0-100 number a user can read at a glance. Answers:
//   "Is this build good? Should I ship it, or regenerate?"
//
// Score composition (all weighted to sum to 100):
//   • 30 pts — integrity checks  (files present, valid JSX, no bare imports)
//   • 30 pts — visual verify     (Vision MATCH + confidence %)
//   • 15 pts — visual repair     (number of rounds needed; fewer = better)
//   • 15 pts — assets completeness (logo + hero + palette + fonts)
//   • 10 pts — warnings bonus    (-1pt per warning, floored at 0)
//
// Grade mapping:
//   90-100 "excellent" · 75-89 "good" · 60-74 "ok" · <60 "needs work"
// ══════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} QualityScore
 * @property {number} total         0..100 overall score
 * @property {string} grade         'excellent' | 'good' | 'ok' | 'needs-work'
 * @property {string} gradeColor    CSS color hint for the UI chip
 * @property {string} headline      one-line verdict
 * @property {Array<{name: string, points: number, max: number, note: string}>} components - per-dimension breakdown
 */

const GRADE_THRESHOLDS = [
  { min: 90, grade: 'excellent',  color: 'emerald' },
  { min: 75, grade: 'good',       color: 'sky' },
  { min: 60, grade: 'ok',         color: 'amber' },
  { min: 0,  grade: 'needs-work', color: 'rose' },
]

function gradeFor(total) {
  for (const g of GRADE_THRESHOLDS) if (total >= g.min) return g
  return GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1]
}

/**
 * Score the integrity checks dimension (30 pts).
 * Linear by pass-rate — all passing = 30, half passing = 15, none = 0.
 * @private
 */
function scoreIntegrity(integrity = []) {
  if (!Array.isArray(integrity) || integrity.length === 0) {
    return { name: 'Integrity', points: 15, max: 30, note: 'no integrity checks ran' }
  }
  const passed = integrity.filter((c) => c?.pass).length
  const rate = passed / integrity.length
  return {
    name: 'Integrity',
    points: Math.round(rate * 30),
    max: 30,
    note: `${passed}/${integrity.length} checks passing`,
  }
}

/**
 * Score the visual verify dimension (30 pts).
 * MATCH with 95%+ confidence = 30. MATCH with lower confidence scales down.
 * Non-match: 30 × (1 - findings/6) × confidence — soft failure.
 * No verify run: return neutral 15 (not penalized for absence).
 * @private
 */
function scoreVerify(verify) {
  if (!verify) return { name: 'Visual verify', points: 15, max: 30, note: 'no Vision verify available' }
  const confidence = typeof verify.confidence === 'number' ? verify.confidence : 0.5
  const findings = Array.isArray(verify.findings) ? verify.findings.length : 0

  if (verify.matches) {
    const pts = Math.round(30 * confidence)
    return {
      name: 'Visual verify',
      points: pts,
      max: 30,
      note: `Vision MATCH (${Math.round(confidence * 100)}%)`,
    }
  }
  // Non-match: penalize by findings count, scaled by confidence
  const findingsFactor = Math.max(0, 1 - (findings / 6))
  const pts = Math.round(30 * findingsFactor * confidence)
  return {
    name: 'Visual verify',
    points: pts,
    max: 30,
    note: `${findings} finding${findings === 1 ? '' : 's'} (${Math.round(confidence * 100)}%)`,
  }
}

/**
 * Score the visual-repair loop dimension (15 pts).
 * 0 rounds (or no loop ran) = full 15. Each additional round -5 pts.
 * Final MATCH after repair is still worth points — user got to quality
 * eventually, just took more compute.
 * @private
 */
function scoreRepairEfficiency(loopSummary) {
  if (!loopSummary) return { name: 'Repair efficiency', points: 15, max: 15, note: 'no repair loop needed' }
  const rounds = Array.isArray(loopSummary.rounds) ? loopSummary.rounds.length : 0
  if (rounds === 0) return { name: 'Repair efficiency', points: 15, max: 15, note: 'no repair rounds' }
  const base = Math.max(0, 15 - (rounds - 1) * 5)
  const reachedMatch = loopSummary.finalMatches
  const pts = reachedMatch ? base : Math.max(0, base - 3)
  return {
    name: 'Repair efficiency',
    points: pts,
    max: 15,
    note: `${rounds} round${rounds === 1 ? '' : 's'}${reachedMatch ? ', reached MATCH' : ', partial'}`,
  }
}

/**
 * Score the assets completeness dimension (15 pts).
 *   6 pts — logo export present
 *   4 pts — hero / photo export present
 *   3 pts — palette primary token present (non-default)
 *   2 pts — display font set to a branded family
 * @private
 */
function scoreAssets(manifest) {
  if (!manifest?.assets && !manifest?.theme) {
    return { name: 'Brand assets', points: 7, max: 15, note: 'no asset manifest' }
  }
  const exports = Array.isArray(manifest?.assets?.exports) ? manifest.assets.exports : []
  const tokens = manifest?.theme?.tokens || null
  const hasLogo = exports.some((e) => e.role === 'logo' || e.name === 'LOGO_URL')
  const hasHero = exports.some((e) => e.role === 'hero' || e.role === 'photo' || /^HERO_URL|^PHOTO_/.test(e.name))
  let pts = 0
  const parts = []
  if (hasLogo) { pts += 6; parts.push('logo') }
  if (hasHero) { pts += 4; parts.push('hero') }
  if (tokens?.primary && !/^#?(0a0a0a|111827|0f172a|000000|ffffff)$/i.test(String(tokens.primary).replace('#', ''))) {
    pts += 3; parts.push('palette')
  }
  const fontDisplay = tokens?.fontDisplay || ''
  if (fontDisplay && !/^system|sans-serif|-apple-system/i.test(fontDisplay)) { pts += 2; parts.push('font') }
  return {
    name: 'Brand assets',
    points: pts,
    max: 15,
    note: parts.length ? parts.join(' + ') : 'defaults',
  }
}

/**
 * Score the warnings dimension (10 pts). Each warning deducts 1 point,
 * floor at 0. No warnings = full 10.
 * @private
 */
function scoreWarnings(manifest) {
  const warnings = Array.isArray(manifest?.warnings) ? manifest.warnings : []
  const pts = Math.max(0, 10 - warnings.length)
  return {
    name: 'Clean warnings',
    points: pts,
    max: 10,
    note: warnings.length === 0 ? 'zero warnings' : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
  }
}

/**
 * Combine all signals into a single quality score.
 *
 * @param {{manifest?: Object, screenshotVerify?: Object, visualLoopSummary?: Object}} signals
 * @returns {QualityScore}
 */
export function computeQualityScore({ manifest, screenshotVerify, visualLoopSummary } = {}) {
  const components = [
    scoreIntegrity(manifest?.integrity),
    scoreVerify(screenshotVerify),
    scoreRepairEfficiency(visualLoopSummary),
    scoreAssets(manifest),
    scoreWarnings(manifest),
  ]
  const total = components.reduce((sum, c) => sum + c.points, 0)
  const clamped = Math.max(0, Math.min(100, total))
  const g = gradeFor(clamped)

  let headline
  if (clamped >= 90) headline = 'Ship it.'
  else if (clamped >= 75) headline = 'Solid build with room to polish.'
  else if (clamped >= 60) headline = 'Usable, but the Vision diff has work to do.'
  else headline = 'Consider regenerating — multiple signals are weak.'

  return {
    total: clamped,
    grade: g.grade,
    gradeColor: g.color,
    headline,
    components,
  }
}
