/**
 * Streaming helper functions.
 *
 * Pure / low-risk helpers used before, during, or after streaming.
 * No yield, no provider calls, no retry loops, no DB writes.
 */

// ── Context compression (pre-stream) ────────────────────────────────────

/**
 * Compress a message history for context window management.
 * Keeps recent messages verbatim, summarizes older ones.
 */
export function compressContext(messages) {
  if (!messages || messages.length <= 20) return messages || []

  const recent = messages.slice(-16)
  const older = messages.slice(0, -16)

  const summary = {
    role: 'system',
    content: `[Previous conversation summary: ${older.length} messages exchanged covering: ${
      older.filter(m => m.role === 'user').slice(0, 5).map(m => m.content.slice(0, 60)).join('; ')
    }]`,
    created_at: older[older.length - 1]?.created_at
  }

  return [summary, ...recent]
}

// ── Error classification (during stream) ────────────────────────────────

/**
 * Classify a streaming error as transient (retryable) or rate-limit.
 * Returns { isTransient, isRateLimit }.
 */
export function classifyStreamError(err) {
  const status = err?.status || err?.statusCode
  const msg = String(err?.message || '')

  const isTransient = (
    (status >= 500 && status < 600) ||
    status === 408 ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ETIMEDOUT' ||
    /timeout|network|connection reset|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg)
  )

  const isRateLimit =
    err?.status === 429 ||
    err?.error_type === 'rate_limit' ||
    /rate[- ]?limit/i.test(msg) ||
    /temporarily/i.test(msg)

  return { isTransient, isRateLimit }
}

// ── Insight extraction (post-stream) ────────────────────────────────────

/**
 * Extract structured insights from a user/AI exchange for canvas updates.
 * Pure function — no DB access, no side effects.
 */
export function extractInsights(userMessage, response, files, plan) {
  const insights = {}
  const lowerUser = userMessage.toLowerCase()

  // Detect goals
  if (lowerUser.includes('i want') || lowerUser.includes('i need') ||
      lowerUser.includes('build me') || lowerUser.includes('create') ||
      lowerUser.includes('make')) {
    insights.goal = userMessage.slice(0, 200)
  }

  // Detect decisions from AI response
  const decisionPatterns = [
    /(?:I'll use|we'll use|using|I chose|implemented with)\s+([^.]{10,80})/i,
    /(?:stack|framework|library):\s*([^.\n]{10,80})/i,
  ]
  for (const pattern of decisionPatterns) {
    const match = response?.match(pattern)
    if (match) {
      insights.decision = match[0].slice(0, 200)
      break
    }
  }

  // Detect architecture from plan or response
  if (plan?.architecture) {
    insights.architecture = plan.architecture.slice(0, 300)
  }

  // Detect technical specs
  const specPatterns = [
    /(?:tech stack|technologies|dependencies):\s*([^\n]{10,200})/i,
    /(?:built with|powered by)\s+([^.]{10,100})/i,
  ]
  const specs = []
  for (const pattern of specPatterns) {
    const match = response?.match(pattern)
    if (match) specs.push(match[0].slice(0, 200))
  }
  if (specs.length) insights.specs = specs

  // Detect completed tasks
  if (files.length > 0) {
    insights.completedTask = `Generated ${files.length} file(s): ${files.map(f => f.path).join(', ')}`
  }

  // Overview hint
  if (lowerUser.length > 20 && !lowerUser.startsWith('hello') && !lowerUser.startsWith('hi ')) {
    insights.overviewHint = userMessage.slice(0, 300)
  }

  return insights
}

// ── Log payload sanitization (post-stream) ──────────────────────────────

/**
 * Build a safe payload for the generation_runs table.
 * Only includes columns that exist in the schema.
 */
export function sanitizeLogPayload(data) {
  return {
    id: data.id,
    project_id: data.project_id,
    chat_id: data.chat_id,
    user_id: data.user_id,
    tool_mode: data.tool_mode,
    files_generated: data.files_generated,
    duration: data.duration,
    success: data.success,
    error: data.error || null,
    provider: data.provider,
    model: data.model,
  }
}

// ── Search index entry builder (post-stream) ────────────────────────────

/**
 * Build search index entries from a completed exchange.
 * Returns an array of entry objects ready for bulk insert.
 */
export function buildSearchEntries(projectId, chatId, response, files) {
  const entries = []
  if (response) {
    entries.push({
      project_id: projectId, content_type: 'message',
      content_text: response.slice(0, 1000), source_id: chatId
    })
  }
  for (const file of files) {
    entries.push({
      project_id: projectId, content_type: 'file',
      content_text: `${file.path}: ${file.description || ''} ${(file.content || '').slice(0, 500)}`,
      source_id: file.id
    })
  }
  return entries
}
