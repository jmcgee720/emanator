const { db } = require('../supabase/db')

function getPromptPatterns(memoryEntries) {
  return (memoryEntries || []).filter(e => e.key && e.key.startsWith('prompt_pattern:'))
}

function getRejectedPatterns(memoryEntries) {
  return (memoryEntries || []).filter(e => e.key && e.key.startsWith('rejected_prompt_pattern:'))
}

function parsePatternValue(raw) {
  if (!raw) return { text: '', usage_count: 0, success_count: 0, last_used_at: null }
  if (typeof raw === 'object') return { usage_count: 0, success_count: 0, last_used_at: null, ...raw }
  try { const obj = JSON.parse(raw); return { usage_count: 0, success_count: 0, last_used_at: null, ...obj } } catch {}
  return { text: raw, usage_count: 0, success_count: 0, last_used_at: null }
}

function parseRejectedValue(raw) {
  if (!raw) return { text: '', reject_count: 0, usage_count: 0, ts: null }
  if (typeof raw === 'object') return { reject_count: 0, usage_count: 0, ts: null, ...raw }
  try { const obj = JSON.parse(raw); return { reject_count: 0, usage_count: 0, ts: null, ...obj } } catch {}
  return { text: raw, reject_count: 0, usage_count: 0, ts: null }
}

const tokenize = (s) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)

/**
 * Compute token-overlap similarity between input tokens and a text string.
 * Returns 0..1.
 */
function tokenSimilarity(inputTokens, text) {
  const patTokens = tokenize(text)
  if (patTokens.length === 0) return 0
  const shared = patTokens.filter(t => inputTokens.has(t)).length
  return shared / patTokens.length
}

function getUserPreferences(memoryEntries, userId) {
  return (memoryEntries || []).filter(e => {
    if (!e.key || !e.key.startsWith('user_preference:')) return false
    if (!userId) return false
    const meta = parsePreferenceValue(e.value)
    return !meta.userId || meta.userId === userId
  })
}

function parsePreferenceValue(raw) {
  if (!raw) return { type: '', value: '', count: 0, ts: null, userId: null }
  if (typeof raw === 'object') return { count: 0, ts: null, userId: null, ...raw }
  try { const obj = JSON.parse(raw); return { count: 0, ts: null, userId: null, ...obj } } catch {}
  return { type: '', value: '', count: 0, ts: null, userId: null }
}

/**
 * Compute a preference boost for a candidate pattern based on user preferences.
 * Returns 0..0.15.
 */
function computePreferenceBoost(patternText, preferences) {
  if (!preferences || preferences.length === 0 || !patternText) return 0
  let totalBoost = 0
  const textLower = patternText.toLowerCase()
  for (const pref of preferences) {
    const meta = parsePreferenceValue(pref.value)
    const prefValue = (meta.value || '').toLowerCase()
    if (!prefValue) continue
    // Check if the pattern text aligns with the preference
    let aligned = false
    if (meta.type === 'file_scope' && prefValue === 'single' && /\b(single|one file|just)\b/.test(textLower)) aligned = true
    if (meta.type === 'file_scope' && prefValue === 'multi' && /\b(multi|across|all files|multiple)\b/.test(textLower)) aligned = true
    if (meta.type === 'edit_mode' && prefValue === 'update' && /\b(update|modify|edit|change|fix)\b/.test(textLower)) aligned = true
    if (meta.type === 'edit_mode' && prefValue === 'create' && /\b(create|new|scaffold|add file)\b/.test(textLower)) aligned = true
    if (meta.type === 'patch_style' && prefValue === 'minimal' && /\b(minimal|small|minor|tiny)\b/.test(textLower)) aligned = true
    if (meta.type === 'directory' && textLower.includes(prefValue)) aligned = true
    if (aligned) {
      // Boost scales with count, capped per-preference at 0.05
      const count = meta.count || 1
      totalBoost += Math.min(0.05, count * 0.01)
    }
  }
  return Math.min(0.15, totalBoost)
}

function matchPromptPattern(memoryEntries, input, projectId, userId) {
  const patterns = getPromptPatterns(memoryEntries)
  if (!input || patterns.length === 0) return null

  const inputTokens = new Set(tokenize(input))

  // ── Pre-compute user preference boost ──
  const preferences = getUserPreferences(memoryEntries, userId)

  // ── Pre-compute rejected-pattern penalties ──
  // Same-project rejected patterns penalize 1.5x harder than global ones
  const rejected = getRejectedPatterns(memoryEntries)
  let bestRejectedSim = 0
  let bestRejectedPenalty = 0
  for (const r of rejected) {
    const rmeta = parseRejectedValue(r.value)
    const rtext = rmeta.text || r.value || ''
    if (!rtext) continue
    const sim = tokenSimilarity(inputTokens, rtext)
    if (sim > bestRejectedSim) {
      bestRejectedSim = sim
      const rejectCount = rmeta.reject_count || 1
      let penalty = Math.min(0.35, sim * 0.3 * Math.min(rejectCount, 3))
      // Amplify penalty for same-project rejected patterns
      const isSameProject = projectId && rmeta.projectId && rmeta.projectId === projectId
      if (isSameProject) penalty = Math.min(0.45, penalty * 1.5)
      bestRejectedPenalty = penalty
    }
  }

  let best = null
  let bestScore = 0

  for (const p of patterns) {
    const meta = parsePatternValue(p.value)
    const text = meta.text || p.value || ''
    if (!text) continue
    const patTokens = tokenize(text)
    if (patTokens.length === 0) continue

    const shared = patTokens.filter(t => inputTokens.has(t)).length
    const baseScore = shared / patTokens.length

    // Boost from usage history
    const usage = meta.usage_count || 0
    const boost = Math.min(0.15, usage * 0.02)

    // Scope boost: same-project entries score higher
    const isSameProject = projectId && meta.projectId && meta.projectId === projectId
    const scopeBoost = isSameProject ? 0.1 : 0

    // User preference boost: align with learned user behavior
    const prefBoost = computePreferenceBoost(text, preferences)

    // Apply rejected-pattern penalty
    const penalizedScore = baseScore + boost + scopeBoost + prefBoost - bestRejectedPenalty

    // Deprioritize patterns with no successes after repeated use
    const success = meta.success_count || 0
    if (success === 0 && usage > 3) continue

    if (penalizedScore >= 0.5 && penalizedScore > bestScore) {
      bestScore = penalizedScore
      best = { ...p, _meta: meta, _score: penalizedScore }
    }
  }

  // Decision: if best positive exists but penalty brought score into ambiguous zone
  if (best && bestRejectedPenalty > 0) {
    const rawScore = best._score + bestRejectedPenalty // score before penalty
    // strong positive + weak negative → match (return as-is)
    // positive and negative close → ambiguous
    if (rawScore >= 0.5 && best._score < 0.5) {
      return { type: 'ambiguous_match', candidates: [best] }
    }
  }

  return best
}

async function recordPatternUsage(pattern) {
  if (!pattern?.id) return
  const meta = parsePatternValue(pattern.value)
  meta.usage_count = (meta.usage_count || 0) + 1
  meta.last_used_at = new Date().toISOString()
  try {
    await db.projectMemory.updateById(pattern.id, { value: JSON.stringify(meta) })
  } catch (err) {
    console.log('[promptLibrary] usage update error:', err.message)
  }
}

async function recordPatternSuccess(projectId, userTask) {
  if (!projectId || !userTask) return
  const entries = await db.projectMemory.findByProjectId(projectId)
  const match = matchPromptPattern(entries, userTask, projectId)
  if (!match?.id) return
  const meta = parsePatternValue(match.value)
  meta.success_count = (meta.success_count || 0) + 1
  try {
    await db.projectMemory.updateById(match.id, { value: JSON.stringify(meta) })
  } catch (err) {
    console.log('[promptLibrary] success update error:', err.message)
  }
}

async function addPromptPatternToMemory({ projectId, name, value }) {
  const existing = await db.projectMemory.findByProjectId(projectId)
  const key = `prompt_pattern:${name}`
  if (existing.some(e => e.key === key)) return null
  const meta = JSON.stringify({ text: value, usage_count: 0, success_count: 0, last_used_at: null, projectId: projectId || null })
  return db.projectMemory.create({ project_id: projectId, key, value: meta })
}

module.exports = { getPromptPatterns, getRejectedPatterns, getUserPreferences, matchPromptPattern, addPromptPatternToMemory, recordPatternUsage, recordPatternSuccess, parsePatternValue, parseRejectedValue, parsePreferenceValue, computePreferenceBoost }
