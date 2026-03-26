import { db } from '@/lib/supabase/db'
import { v4 as uuidv4 } from 'uuid'

const META_PATH_PROMPTS = '_meta/prompt_library.json'
const META_PATH_RUNS = '_meta/prompt_runs.json'

const PROMPT_CATEGORIES = [
  'landing-page', 'dashboard', 'sprite-sheet', 'bug-fix',
  'refactor', 'export', 'design', 'api', 'component', 'general'
]

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

// ── Prompt Library CRUD ──

export async function getPromptLibrary(projectId) {
  return (await loadJson(projectId, META_PATH_PROMPTS)) || { prompts: [], version: 1 }
}

export async function savePromptToLibrary(projectId, prompt) {
  const lib = await getPromptLibrary(projectId)
  const entry = {
    id: uuidv4(),
    text: prompt.text,
    title: prompt.title || prompt.text.slice(0, 60),
    category: prompt.category || 'general',
    tags: prompt.tags || [],
    provider: prompt.provider || null,
    model: prompt.model || null,
    recipe: prompt.recipe || null,
    intent: prompt.intent || null,
    success: prompt.success ?? true,
    source_message_id: prompt.source_message_id || null,
    project_id: projectId,
    is_master: prompt.is_master || false,
    scope: prompt.scope || 'project', // 'project' or 'user'
    created_at: new Date().toISOString(),
  }
  lib.prompts.push(entry)
  await saveJson(projectId, META_PATH_PROMPTS, lib)
  return entry
}

export async function updatePromptInLibrary(projectId, promptId, updates) {
  const lib = await getPromptLibrary(projectId)
  lib.prompts = lib.prompts.map(p => p.id === promptId ? { ...p, ...updates, updated_at: new Date().toISOString() } : p)
  await saveJson(projectId, META_PATH_PROMPTS, lib)
}

export async function deletePromptFromLibrary(projectId, promptId) {
  const lib = await getPromptLibrary(projectId)
  lib.prompts = lib.prompts.filter(p => p.id !== promptId)
  await saveJson(projectId, META_PATH_PROMPTS, lib)
}

// ── Prompt Runs (track usage) ──

export async function recordPromptRun(projectId, run) {
  const runs = (await loadJson(projectId, META_PATH_RUNS)) || { runs: [] }
  runs.runs.push({
    id: uuidv4(),
    prompt_id: run.prompt_id || null,
    prompt_text: run.prompt_text,
    provider: run.provider,
    model: run.model,
    intent: run.intent,
    success: run.success,
    duration_ms: run.duration_ms || null,
    project_id: projectId,
    created_at: new Date().toISOString(),
  })
  // Keep last 200 runs
  if (runs.runs.length > 200) runs.runs = runs.runs.slice(-200)
  await saveJson(projectId, META_PATH_RUNS, runs)
}

export async function getSuccessfulPatterns(projectId) {
  const runs = (await loadJson(projectId, META_PATH_RUNS)) || { runs: [] }
  const successful = runs.runs.filter(r => r.success)
  // Group by intent and return top patterns
  const byIntent = {}
  for (const r of successful) {
    const key = r.intent || 'general'
    if (!byIntent[key]) byIntent[key] = []
    byIntent[key].push(r.prompt_text)
  }
  return byIntent
}

export { PROMPT_CATEGORIES }
