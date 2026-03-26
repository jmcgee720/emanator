const { db } = require('../supabase/db')
const { addPromptPatternToMemory, recordPatternSuccess } = require('./prompt_library')


// ── Preference signal patterns (regex → preference type + value) ──
const PREFERENCE_SIGNALS = [
  { re: /\b(single[- ]?file|one file|just this file)\b/i, type: 'file_scope', value: 'single' },
  { re: /\b(multi[- ]?file|across files|all files|multiple files)\b/i, type: 'file_scope', value: 'multi' },
  { re: /\b(minimal|small patch|minor change|tiny edit)\b/i, type: 'patch_style', value: 'minimal' },
  { re: /\b(update|modify|edit|change|fix)\b/i, type: 'edit_mode', value: 'update' },
  { re: /\b(create|new file|add file|scaffold)\b/i, type: 'edit_mode', value: 'create' },
]

async function inferAndStorePreferences({ projectId, userId, userTask, taskMode }) {
  if (!projectId || !userId || !userTask) return
  const signals = []
  for (const sig of PREFERENCE_SIGNALS) {
    if (sig.re.test(userTask)) {
      signals.push({ type: sig.type, value: sig.value })
    }
  }
  // Also infer from taskMode
  if (taskMode === 'apply' || taskMode === 'plan') {
    // Repeated directory references → directory preference
    const dirMatch = userTask.match(/(?:^|\s)((?:lib|app|components|pages|src|hooks)\/[\w/-]+)/i)
    if (dirMatch) {
      signals.push({ type: 'directory', value: dirMatch[1] })
    }
  }
  if (signals.length === 0) return

  try {
    const existing = await db.projectMemory.findByProjectId(projectId)
    for (const sig of signals) {
      const key = `user_preference:${sig.type}:${sig.value}`
      const entry = existing.find(e => e.key === key)
      if (entry) {
        const meta = typeof entry.value === 'string' ? (() => { try { return JSON.parse(entry.value) } catch { return {} } })() : (entry.value || {})
        meta.count = (meta.count || 0) + 1
        meta.ts = new Date().toISOString()
        await db.projectMemory.updateById(entry.id, { value: JSON.stringify(meta) })
      } else {
        await db.projectMemory.create({
          project_id: projectId,
          key,
          value: JSON.stringify({ type: sig.type, value: sig.value, count: 1, ts: new Date().toISOString(), userId })
        })
      }
    }
  } catch (err) {
    console.log('[changeLog] preference store error:', err.message)
  }
}

async function addRejectedPatternToMemory({ projectId, userTask }) {
  if (!projectId || !userTask || userTask.length <= 10) return
  const name = userTask.slice(0, 40).replace(/\s+/g, '_').toLowerCase()
  const key = `rejected_prompt_pattern:${name}`

  try {
    const existing = await db.projectMemory.findByProjectId(projectId)
    const entry = existing.find(e => e.key === key)

    if (entry) {
      const meta = typeof entry.value === 'string' ? (() => { try { return JSON.parse(entry.value) } catch { return {} } })() : (entry.value || {})
      meta.reject_count = (meta.reject_count || 0) + 1
      meta.usage_count = (meta.usage_count || 0) + 1
      meta.ts = new Date().toISOString()
      await db.projectMemory.updateById(entry.id, { value: JSON.stringify(meta) })
    } else {
      const meta = JSON.stringify({
        text: userTask,
        ts: new Date().toISOString(),
        reject_count: 1,
        usage_count: 1,
        projectId: projectId || null,
      })
      await db.projectMemory.create({ project_id: projectId, key, value: meta })
    }
  } catch (err) {
    console.log('[changeLog] rejected pattern save error:', err.message)
  }
}

async function logChange({ projectId, chatId, userId, userTask, taskMode, result, filePaths, fileActions, chatType }) {
  const entry = {
    project_id: projectId,
    chat_id: chatId || null,
    user_id: userId || null,
    user_task: userTask || '',
    task_mode: taskMode || 'unknown',
    file_actions: fileActions || (filePaths ? filePaths.map(p => ({ path: p, action: taskMode === 'discard' ? 'none' : 'apply' })) : null),
    validator_result: {
      result: result || 'unknown',
      chat_type: chatType || 'builder',
    },
    created_at: new Date().toISOString()
  }
  try {
    await db.changelog.create(entry)
  } catch (err) {
    console.log('[changeLog] write error:', err.message)
  }

  // Success learning — store positive prompt pattern
  if (result === 'applied' && userTask && userTask.length > 10) {
    const name = userTask.slice(0, 40).replace(/\s+/g, '_').toLowerCase()
    try {
      await addPromptPatternToMemory({ projectId, name, value: userTask })
    } catch (err) {
      console.log('[changeLog] pattern save error:', err.message)
    }
    try {
      await recordPatternSuccess(projectId, userTask)
    } catch (err) {
      console.log('[changeLog] success track error:', err.message)
    }
    // Infer and store user preferences from successful task
    if (userId) {
      await inferAndStorePreferences({ projectId, userId, userTask, taskMode }).catch(
        (err) => console.log('[changeLog] preference infer error:', err.message)
      )
    }
  }

  // Rejection learning — store rejected prompt pattern
  if (result === 'discarded' && userTask && userTask.length > 10) {
    await addRejectedPatternToMemory({ projectId, userTask })
  }
}

module.exports = { logChange }
