/**
 * Context compactor — prevents long chats from hitting Claude's
 * 200,000-token prompt ceiling.
 *
 * When the user's chat history grows past a threshold (default 130K
 * tokens, leaving 70K of headroom), this module replaces the older
 * half of the conversation with a Haiku-generated summary, preserving
 * the most recent N turns verbatim.
 *
 * Why a separate module: token counting + summarization + persistence
 * are concerns the stream handler should not own. Putting it here also
 * makes it independently testable and swappable (we could later move
 * to Anthropic's official token counter, or to a different summary
 * model, without touching the stream handler).
 *
 * Token counting strategy: we use a 4-chars-per-token heuristic. The
 * Anthropic tokenizer would be more accurate, but it requires an extra
 * API call per turn — costs ~$0.001 each, but adds latency. The
 * heuristic over-estimates (good — we compact slightly earlier than
 * strictly necessary, which gives a safety margin against the model
 * tokenizer's true behavior on code-heavy chats).
 */

const DEFAULT_THRESHOLD_TOKENS = 130_000
const KEEP_RECENT_MESSAGES = 10
const CHARS_PER_TOKEN_HEURISTIC = 4

/**
 * Estimate token count of a message (or content-block array).
 * Conservative: assumes 4 chars/token. Real Claude tokenization may
 * be denser for English prose (~3.5) and sparser for code (~5-6).
 * Using 4 splits the difference and gives a safe over-estimate for
 * triggering compaction.
 */
export function estimateTokens(content) {
  if (!content) return 0
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN_HEURISTIC)
  }
  if (Array.isArray(content)) {
    let total = 0
    for (const block of content) {
      if (!block) continue
      if (block.type === 'text' && block.text) {
        total += Math.ceil(block.text.length / CHARS_PER_TOKEN_HEURISTIC)
      } else if (block.type === 'image') {
        // Anthropic counts images as ~1500 tokens for a typical
        // screenshot. Use that as the per-image cost in our estimate.
        total += 1500
      } else if (block.type === 'tool_use') {
        const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {})
        total += Math.ceil(inputStr.length / CHARS_PER_TOKEN_HEURISTIC) + 50
      } else if (block.type === 'tool_result') {
        const c = block.content
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text || '').join('') : ''
        total += Math.ceil(text.length / CHARS_PER_TOKEN_HEURISTIC) + 20
      }
    }
    return total
  }
  return 0
}

export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0
  let total = 0
  for (const m of messages) {
    // Per-message overhead: role label + content delimiters
    total += 5
    total += estimateTokens(m?.content)
  }
  return total
}

/**
 * Decide whether the given prior messages should be compacted before
 * sending to Claude. Returns { shouldCompact, totalTokens, splitAt }.
 * splitAt is the index after which messages are kept verbatim.
 */
export function shouldCompact(priorMessages, options = {}) {
  const threshold = options.thresholdTokens || DEFAULT_THRESHOLD_TOKENS
  const keepRecent = options.keepRecent || KEEP_RECENT_MESSAGES
  const totalTokens = estimateMessagesTokens(priorMessages)
  if (totalTokens < threshold) {
    return { shouldCompact: false, totalTokens, splitAt: 0 }
  }
  // Keep the most recent N messages verbatim; compact everything older.
  // If the prior list is smaller than keepRecent, do not compact — there
  // is nothing meaningful to summarize.
  const splitAt = Math.max(0, priorMessages.length - keepRecent)
  if (splitAt < 2) {
    return { shouldCompact: false, totalTokens, splitAt: 0 }
  }
  return { shouldCompact: true, totalTokens, splitAt }
}

/**
 * Render messages 0..splitAt-1 as a single plain-text transcript that
 * Haiku will summarize. We strip image blocks (no image-to-image
 * summarization needed — we describe in text what was attached) and
 * truncate very long tool outputs (they tend to be enormous read_file
 * dumps that the summary doesn't need verbatim).
 */
export function renderTranscriptForSummary(messages) {
  const lines = []
  for (const m of messages) {
    if (!m) continue
    const role = m.role || 'unknown'
    const c = m.content
    if (typeof c === 'string') {
      lines.push(`### ${role}\n${c}`)
      continue
    }
    if (!Array.isArray(c)) continue
    const parts = []
    for (const block of c) {
      if (block?.type === 'text' && block.text) {
        parts.push(block.text)
      } else if (block?.type === 'image') {
        parts.push('[image attachment]')
      } else if (block?.type === 'tool_use') {
        const input = typeof block.input === 'string' ? block.input : JSON.stringify(block.input)
        parts.push(`[tool_call ${block.name}(${input.slice(0, 400)}${input.length > 400 ? '...' : ''})]`)
      } else if (block?.type === 'tool_result') {
        const c2 = block.content
        const text = typeof c2 === 'string' ? c2 : Array.isArray(c2) ? c2.map((x) => x?.text || '').join('') : ''
        const trimmed = text.length > 800 ? text.slice(0, 800) + '... [truncated]' : text
        parts.push(`[tool_result]\n${trimmed}`)
      }
    }
    if (parts.length > 0) lines.push(`### ${role}\n${parts.join('\n')}`)
  }
  return lines.join('\n\n')
}

const SUMMARY_INSTRUCTION = [
  'You are an assistant summarizer. The transcript below is the early portion of a developer chat between a user and an AI coding agent working on a codebase called Auroraly.',
  'Produce a compact, structured summary (250-400 words) covering ONLY what a future agent would need to continue the work coherently. Required sections:',
  '  1. ORIGINAL GOAL: what the user is trying to accomplish overall',
  '  2. KEY DECISIONS: architectural choices, library/approach selections',
  '  3. FILES TOUCHED: specific file paths the agent edited or read',
  '  4. COMPLETED: what is verified working',
  '  5. IN PROGRESS: what was being attempted when this segment ended',
  '  6. OPEN ISSUES: bugs, errors, or blockers that surfaced',
  '  7. TODO: explicit next-step items',
  'Preserve specific file paths, commit hashes, variable names, error messages, and TODO markers verbatim. Drop pleasantries, model self-talk, and verbose tool outputs. The summary will be inserted into the next chat turn so the agent does not lose context.',
  '',
  'Transcript:',
].join('\n')

/**
 * Compact the older portion of a chat history. Returns a replacement
 * "summary message" that should be prepended in place of the
 * messages[0..splitAt-1] slice.
 *
 * provider: any object implementing chat({ messages, max_tokens }) →
 *   { content }. Caller passes a Haiku-instance provider for speed +
 *   cost. We do NOT use the streaming variant — we want the single
 *   summary string back as a Promise.
 */
export async function compactMessages(messages, splitAt, provider, { signal } = {}) {
  const oldSlice = messages.slice(0, splitAt)
  const transcript = renderTranscriptForSummary(oldSlice)
  // Cap transcript at ~500K chars before summarization. If it is
  // bigger than that, the summary itself would risk overflowing
  // Haiku's input limit. Drop the middle (keep head + tail) — head
  // tends to have the original goal, tail tends to have recent
  // decisions; the middle is replayed tool-output noise.
  const CAP = 500_000
  let cappedTranscript = transcript
  if (transcript.length > CAP) {
    const half = Math.floor(CAP / 2)
    cappedTranscript = transcript.slice(0, half) + '\n\n... [middle truncated for size] ...\n\n' + transcript.slice(transcript.length - half)
  }

  const prompt = `${SUMMARY_INSTRUCTION}\n\n${cappedTranscript}`
  const resp = await provider.chat(
    [{ role: 'user', content: prompt }],
    { max_tokens: 1024, temperature: 0.2, cacheControl: false, signal },
  )
  const summary = (resp?.content || '').trim()

  // Build the replacement message. We use role:user with a clearly
  // labeled prefix so the main agent treats it as situational
  // context, not as an instruction. (assistant-role would risk the
  // agent treating it as its own prior reasoning.)
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [
          '[PRIOR CONTEXT SUMMARY — older turns of this chat were compacted to keep the conversation under Claude\'s 200K-token ceiling. Verbatim turns continue after this block.]',
          '',
          summary,
          '',
          `[End of summary. ${splitAt} messages were summarized.]`,
        ].join('\n'),
      },
    ],
  }
}

/**
 * One-shot helper used by stream-handler-v2: takes priorMessages and
 * an optional Haiku provider; returns the (possibly compacted)
 * priorMessages array. If compaction is not needed or the provider
 * is missing, returns the input unchanged.
 */
export async function maybeCompactPriorMessages(priorMessages, provider, options = {}) {
  const decision = shouldCompact(priorMessages, options)
  if (!decision.shouldCompact || !provider) {
    return { messages: priorMessages, didCompact: false, decision }
  }
  try {
    const summaryMessage = await compactMessages(priorMessages, decision.splitAt, provider, options)
    const recentTail = priorMessages.slice(decision.splitAt)
    const compacted = [summaryMessage, ...recentTail]
    return { messages: compacted, didCompact: true, decision }
  } catch (err) {
    // If summarization fails for any reason (rate limit, model error,
    // network) we DO NOT crash the user's chat — better to send the
    // original messages and let Anthropic return the 200K-token
    // error than to refuse the turn. The error-classifier already
    // provides a clear "chat too long" message in that case.
    console.error('[context-compactor] summarization failed, falling through with original messages:', err?.message)
    return { messages: priorMessages, didCompact: false, decision, error: err?.message }
  }
}
