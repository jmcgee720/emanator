// ── Synthesis Sanitizer ──
// Cleans a message array so it is safe to pass to a tool-less chatStream
// (e.g., Anthropic's messages.create without a `tools` field).
//
// Anthropic rejects (HTTP 400) requests that contain `tool_use` blocks in
// assistant turns when no `tools` array is provided. It also disallows two
// consecutive same-role messages. This module fixes both, and additionally
// converts `role:'tool'` results into plain user notes so they survive the
// conversion without needing a paired tool_use block.
//
// Pure functions, no I/O. Easy to unit test.

/**
 * Sanitize a message array for a tool-less chatStream call.
 * @param {Array<{role: string, content: any, tool_calls?: Array, tool_call_id?: string, name?: string}>} msgs
 * @returns {Array<{role: string, content: string}>}
 */
export function cleanForSynthesis(msgs) {
  const out = []
  for (const m of (msgs || [])) {
    if (!m || !m.role) continue

    if (m.role === 'system') {
      const sys = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
      out.push({ role: 'system', content: sys })
      continue
    }

    if (m.role === 'tool') {
      // OpenAI-style tool result → convert to a plain user note so it can
      // survive the tools-less request without needing a paired tool_use.
      const rawContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
      const trimmed = rawContent.length > 4000 ? rawContent.slice(0, 4000) + '…[truncated]' : rawContent
      out.push({ role: 'user', content: '[Previous tool result]: ' + trimmed })
      continue
    }

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // Strip tool_calls — replace with a textual summary appended to any
      // existing assistant text. Prevents Anthropic 400 on tool_use w/o tools.
      const toolSummary = m.tool_calls
        .map(tc => '[Used tool: ' + (tc?.function?.name || 'unknown') + ']')
        .join(' ')
      const baseText = (m.content && typeof m.content === 'string') ? m.content : ''
      const text = (baseText + ' ' + toolSummary).trim() || '[tool call]'
      out.push({ role: 'assistant', content: text })
      continue
    }

    // Plain text user / assistant message
    const content = typeof m.content === 'string'
      ? m.content
      : (m.content == null ? '' : JSON.stringify(m.content))
    if (!content) continue
    out.push({ role: m.role, content })
  }

  // Coalesce consecutive same-role messages (Anthropic disallows them).
  const coalesced = []
  for (const m of out) {
    const last = coalesced[coalesced.length - 1]
    if (last && last.role === m.role && m.role !== 'system') {
      last.content = last.content + '\n\n' + m.content
    } else {
      coalesced.push({ ...m })
    }
  }
  return coalesced
}

/**
 * Returns true if the given message array would crash Anthropic's tool-less
 * messages.create endpoint. Used only by tests.
 * @param {Array} msgs
 */
export function wouldCrashToollessAnthropic(msgs) {
  if (!Array.isArray(msgs)) return true
  let lastRole = null
  for (const m of msgs) {
    if (!m || !m.role) continue
    // Reason 1: tool_use blocks present without `tools` field
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return true
    }
    // Reason 2: role:'tool' message has no paired tool_use in this stripped context
    if (m.role === 'tool') return true
    // Reason 3: consecutive same-role messages (except system)
    if (lastRole === m.role && m.role !== 'system') return true
    lastRole = m.role
  }
  return false
}
