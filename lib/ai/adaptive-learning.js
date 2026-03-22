import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'

const META_USER_PREFS = '_meta/user_preferences.json'
const META_PROJECT_PREFS = '_meta/project_preferences.json'
const META_LEARNING_EVENTS = '_meta/learning_events.json'

async function loadJson(projectId, path) {
  try {
    const file = await db.projectFiles.findByPath(projectId, path)
    if (file?.content) return JSON.parse(file.content)
  } catch {}
  return null
}

async function saveJson(projectId, path, data) {
  await db.projectFiles.upsert(projectId, path, JSON.stringify(data, null, 2), 'json')
}

// ── Default Preferences ──

const DEFAULT_USER_PREFS = {
  response_style: { concise_level: 'balanced', prefer_full_files: false, prefer_plan_first: true },
  coding_style: { preferred_frameworks: ['react', 'tailwind'], prefer_component_reuse: true, prefer_existing_files: true },
  ui_style: { theme: 'dark-premium', spacing: 'generous', prefer_modern: true },
  preferred_providers: { code: 'openai', analysis: null, sprites: 'openai', text: null },
  provider_reliability: {},
}

const DEFAULT_PROJECT_PREFS = {
  file_structure: null,
  design_language: null,
  successful_patterns: [],
  rejected_patterns: [],
  recurring_constraints: [],
  art_constraints: [],
}

// ── User Preferences ──

export async function getUserPreferences(projectId) {
  const stored = await loadJson(projectId, META_USER_PREFS)
  return { ...DEFAULT_USER_PREFS, ...stored }
}

export async function updateUserPreferences(projectId, updates) {
  const current = await getUserPreferences(projectId)
  const merged = deepMerge(current, updates)
  merged.updated_at = new Date().toISOString()
  await saveJson(projectId, META_USER_PREFS, merged)
  return merged
}

export async function applyUserPrefsToAllProjects(userId, sourceProjectId) {
  const prefs = await getUserPreferences(sourceProjectId)
  const projects = await db.projects.findByUserId(userId)
  for (const project of projects) {
    if (project.id !== sourceProjectId) {
      await saveJson(project.id, META_USER_PREFS, { ...prefs, synced_from: sourceProjectId, synced_at: new Date().toISOString() })
    }
  }
}

// ── Project Preferences ──

export async function getProjectPreferences(projectId) {
  const stored = await loadJson(projectId, META_PROJECT_PREFS)
  return { ...DEFAULT_PROJECT_PREFS, ...stored }
}

export async function updateProjectPreferences(projectId, updates) {
  const current = await getProjectPreferences(projectId)
  const merged = deepMerge(current, updates)
  merged.updated_at = new Date().toISOString()
  await saveJson(projectId, META_PROJECT_PREFS, merged)
  return merged
}

// ── Learning Events ──

export async function getLearningEvents(projectId) {
  const data = await loadJson(projectId, META_LEARNING_EVENTS)
  return data || { events: [], rules: [] }
}

export async function recordLearningEvent(projectId, event) {
  const data = await getLearningEvents(projectId)
  const entry = {
    id: uuidv4(),
    user_id: event.user_id,
    project_id: projectId,
    event_type: event.event_type, // 'correction', 'preference', 'rejection', 'approval'
    source_message_id: event.source_message_id || null,
    source_text: event.source_text || '',
    inferred_rule: event.inferred_rule || null,
    confidence: event.confidence || 0.5,
    pinned: false,
    created_at: new Date().toISOString(),
  }
  data.events.push(entry)

  // Auto-extract rules from corrections
  if (event.event_type === 'correction' && event.inferred_rule) {
    const existingRule = data.rules.find(r => r.text === event.inferred_rule.text)
    if (existingRule) {
      existingRule.count = (existingRule.count || 1) + 1
      existingRule.confidence = Math.min(1, existingRule.confidence + 0.1)
      existingRule.last_seen = new Date().toISOString()
    } else {
      data.rules.push({
        id: uuidv4(),
        text: event.inferred_rule.text,
        category: event.inferred_rule.category || 'general',
        scope: event.inferred_rule.scope || 'project',
        count: 1,
        confidence: event.confidence || 0.5,
        pinned: false,
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      })
    }
  }

  // Keep last 500 events
  if (data.events.length > 500) data.events = data.events.slice(-500)
  await saveJson(projectId, META_LEARNING_EVENTS, data)
  return entry
}

export async function updateRule(projectId, ruleId, updates) {
  const data = await getLearningEvents(projectId)
  data.rules = data.rules.map(r => r.id === ruleId ? { ...r, ...updates } : r)
  await saveJson(projectId, META_LEARNING_EVENTS, data)
}

export async function deleteRule(projectId, ruleId) {
  const data = await getLearningEvents(projectId)
  data.rules = data.rules.filter(r => r.id !== ruleId)
  await saveJson(projectId, META_LEARNING_EVENTS, data)
}

export async function resetProjectMemory(projectId) {
  await saveJson(projectId, META_LEARNING_EVENTS, { events: [], rules: [] })
  await saveJson(projectId, META_PROJECT_PREFS, DEFAULT_PROJECT_PREFS)
}

export async function resetAllMemory(projectId) {
  await resetProjectMemory(projectId)
  await saveJson(projectId, META_USER_PREFS, DEFAULT_USER_PREFS)
}

// ── Correction Extraction ──

const CORRECTION_PATTERNS = [
  { pattern: /\b(be|more)\s+concise\b/i, rule: { text: 'Prefer concise responses', category: 'response_style' } },
  { pattern: /\bdo\s*n[o']?t\s+duplicate\b/i, rule: { text: 'Avoid duplicating components', category: 'coding_style' } },
  { pattern: /\buse\s+existing\s+files?\b/i, rule: { text: 'Prefer editing existing files over creating new ones', category: 'coding_style' } },
  { pattern: /\bfull\s+files?\s+(not|instead)\s+(of\s+)?snippets?\b/i, rule: { text: 'Provide full files instead of snippets', category: 'response_style' } },
  { pattern: /\bgive\s+(me\s+)?full\s+files?\b/i, rule: { text: 'Provide full files instead of snippets', category: 'response_style' } },
  { pattern: /\bpremium\s+dark\b/i, rule: { text: 'Use premium dark design style', category: 'ui_style' } },
  { pattern: /\btransparent\s+background\b/i, rule: { text: 'Use transparent backgrounds for generated assets', category: 'art_constraints' } },
  { pattern: /\bno\s+bleed\b/i, rule: { text: 'No bleed outside frame for generated assets', category: 'art_constraints' } },
  { pattern: /\bsafe\s+margins?\b/i, rule: { text: 'Maintain safe margins on generated assets', category: 'art_constraints' } },
  { pattern: /\bshow\s+plan\s+first\b/i, rule: { text: 'Always show plan before executing changes', category: 'response_style' } },
  { pattern: /\breact\b.*\btailwind\b/i, rule: { text: 'Use React + Tailwind CSS', category: 'coding_style' } },
  { pattern: /\breuse\s+(the\s+)?component/i, rule: { text: 'Reuse existing components when possible', category: 'coding_style' } },
  { pattern: /\bdon['\u2019]?t\s+(add|create)\s+new\s+file/i, rule: { text: 'Avoid creating new files unnecessarily', category: 'coding_style' } },
  { pattern: /\bkeep\s+(it\s+)?simple\b/i, rule: { text: 'Keep implementations simple and minimal', category: 'coding_style' } },
  { pattern: /\bmore\s+spacing\b/i, rule: { text: 'Use generous spacing in UI designs', category: 'ui_style' } },
  { pattern: /\bless\s+verbose\b/i, rule: { text: 'Be less verbose in responses', category: 'response_style' } },
]

export function extractCorrections(messageText) {
  const corrections = []
  for (const { pattern, rule } of CORRECTION_PATTERNS) {
    if (pattern.test(messageText)) {
      corrections.push({ ...rule, confidence: 0.7 })
    }
  }
  return corrections
}

// ── Adaptive Context Builder ──

export async function buildAdaptiveContext(projectId) {
  const [userPrefs, projectPrefs, learningData] = await Promise.all([
    getUserPreferences(projectId),
    getProjectPreferences(projectId),
    getLearningEvents(projectId),
  ])

  const parts = []

  // User preferences
  const userLines = []
  if (userPrefs.response_style?.concise_level === 'concise') userLines.push('- Prefer concise technical responses')
  if (userPrefs.response_style?.concise_level === 'verbose') userLines.push('- Provide detailed, thorough explanations')
  if (userPrefs.response_style?.prefer_full_files) userLines.push('- Provide complete files instead of code snippets')
  if (userPrefs.response_style?.prefer_plan_first) userLines.push('- Show implementation plan before making changes')
  if (userPrefs.coding_style?.preferred_frameworks?.length > 0) {
    userLines.push(`- Preferred frameworks/tools: ${userPrefs.coding_style.preferred_frameworks.join(', ')}`)
  }
  if (userPrefs.coding_style?.prefer_component_reuse) userLines.push('- Reuse existing components whenever possible')
  if (userPrefs.coding_style?.prefer_existing_files) userLines.push('- Edit existing files rather than creating new ones')
  if (userPrefs.ui_style?.theme) userLines.push(`- UI theme preference: ${userPrefs.ui_style.theme}`)
  if (userPrefs.ui_style?.spacing === 'generous') userLines.push('- Use generous spacing in layouts')

  if (userLines.length > 0) {
    parts.push(`## USER PREFERENCES\n${userLines.join('\n')}`)
  }

  // Project preferences
  const projLines = []
  if (projectPrefs.design_language) projLines.push(`- Design language: ${projectPrefs.design_language}`)
  if (projectPrefs.file_structure) projLines.push(`- File structure: ${projectPrefs.file_structure}`)
  for (const c of (projectPrefs.recurring_constraints || []).slice(0, 5)) {
    projLines.push(`- ${c}`)
  }
  for (const c of (projectPrefs.art_constraints || []).slice(0, 5)) {
    projLines.push(`- ${c}`)
  }

  if (projLines.length > 0) {
    parts.push(`## PROJECT PREFERENCES\n${projLines.join('\n')}`)
  }

  // Learned rules (from corrections)
  const activeRules = (learningData.rules || [])
    .filter(r => r.confidence >= 0.4)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.confidence - a.confidence)
    .slice(0, 15)

  if (activeRules.length > 0) {
    const ruleLines = activeRules.map(r => `- ${r.text}${r.pinned ? ' [PINNED]' : ''}`)
    parts.push(`## LEARNED RULES\nThese rules were learned from user corrections and feedback. Follow them:\n${ruleLines.join('\n')}`)
  }

  // Recent corrections (last 5)
  const recentCorrections = (learningData.events || [])
    .filter(e => e.event_type === 'correction')
    .slice(-5)
    .map(e => e.source_text?.slice(0, 100))
    .filter(Boolean)

  if (recentCorrections.length > 0) {
    parts.push(`## RECENT USER CORRECTIONS\n${recentCorrections.map(c => `- "${c}"`).join('\n')}`)
  }

  return parts.length > 0 ? parts.join('\n\n') : ''
}

// ── Provider Routing ──

export async function getPreferredProvider(projectId, intent) {
  const userPrefs = await getUserPreferences(projectId)
  const provMap = userPrefs.preferred_providers || {}
  const reliability = userPrefs.provider_reliability || {}

  // Check intent-specific preference
  const intentCategory = intent?.includes('sprite') || intent?.includes('image') ? 'sprites'
    : intent?.includes('analysis') || intent?.includes('explain') ? 'analysis'
    : 'code'

  const preferred = provMap[intentCategory]

  // Check reliability — demote providers with >50% failure rate in last 10 runs
  if (preferred && reliability[preferred]) {
    const r = reliability[preferred]
    if (r.fails > 5 && r.fails / (r.total || 1) > 0.5) {
      return null // let default routing handle it
    }
  }

  return preferred || null
}

export async function updateProviderReliability(projectId, provider, success) {
  const prefs = await getUserPreferences(projectId)
  if (!prefs.provider_reliability) prefs.provider_reliability = {}
  if (!prefs.provider_reliability[provider]) prefs.provider_reliability[provider] = { total: 0, fails: 0 }
  prefs.provider_reliability[provider].total++
  if (!success) prefs.provider_reliability[provider].fails++
  await updateUserPreferences(projectId, { provider_reliability: prefs.provider_reliability })
}

// ── Utility ──

function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object') {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
