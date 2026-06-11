/**
 * Token Counter — Estimates conversation token usage to prevent context_length errors
 * 
 * Proactively warns users before hitting limits so they can fork gracefully
 * instead of seeing cryptic agent-core errors mid-stream.
 */

/**
 * Rough token estimation (1 token ≈ 4 characters for English text)
 * More accurate than character count alone, less expensive than tiktoken.
 */
export function estimateTokens(text) {
  if (!text) return 0
  // Average: 1 token = 4 chars. Add 20% buffer for code/JSON.
  return Math.ceil((text.length / 4) * 1.2)
}

/**
 * Calculate total tokens in a conversation thread
 */
export function calculateConversationTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0
  
  let total = 0
  
  for (const msg of messages) {
    // Message content
    total += estimateTokens(msg.content || '')
    
    // Attachments (file content, not just metadata)
    if (msg.metadata?.attachments?.length > 0) {
      for (const att of msg.metadata.attachments) {
        if (att.content) {
          total += estimateTokens(att.content)
        }
      }
    }
    
    // System instructions (hidden from UI but sent to AI)
    if (msg.metadata?.full_content) {
      total += estimateTokens(msg.metadata.full_content)
    }
    
    // Add small overhead for role/metadata structure (~50 tokens per message)
    total += 50
  }
  
  return total
}

/**
 * Model-specific context limits (tokens)
 */
const MODEL_LIMITS = {
  // Anthropic
  'claude-fable-5': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-opus-4-5-20251101': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-5.1': 200_000,
  'gpt-5.2': 200_000,
  'o3': 200_000,
  
  // Google
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-3-flash-preview': 1_000_000,
}

/**
 * Get context limit for a model (default 128k for unknown models)
 */
export function getModelLimit(modelName) {
  return MODEL_LIMITS[modelName] || 128_000
}

/**
 * Check if conversation is approaching the context limit
 * Returns { needsFork: boolean, tokensUsed: number, limit: number, percentage: number, message: string }
 */
export function checkForkNeeded(messages, modelName = 'claude-sonnet-4-5-20250929') {
  const tokensUsed = calculateConversationTokens(messages)
  const limit = getModelLimit(modelName)
  const percentage = (tokensUsed / limit) * 100
  
  // Warn at 75% (gives user plenty of room to finish current task)
  // Hard cutoff at 100% (prevents hitting actual limit during next response)
  const needsFork = percentage >= 75
  const critical = percentage >= 100
  
  let message = ''
  if (critical) {
    message = `This conversation is getting very long (${tokensUsed.toLocaleString()} / ${limit.toLocaleString()} tokens, ${percentage.toFixed(0)}%). Please fork to a new chat to continue — I'll summarize what we've built so you can pick up where we left off.`
  } else if (needsFork) {
    message = `This conversation is getting long (${tokensUsed.toLocaleString()} / ${limit.toLocaleString()} tokens, ${percentage.toFixed(0)}%). Consider forking to a new chat soon to avoid hitting the limit mid-task.`
  }
  
  return {
    needsFork,
    critical,
    tokensUsed,
    limit,
    percentage,
    message,
  }
}

/**
 * Generate a short, descriptive fork title from recent conversation
 * Returns a 2-3 word summary like "pixel-adjust" or "payment-flow"
 */
export function generateForkTitle(messages, currentTitle) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return `${currentTitle} (cont.)`
  }
  
  // Extract last few user messages to understand what they're working on
  const recentUserMessages = messages
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => m.content || '')
    .join(' ')
  
  // Common patterns to extract topic
  const patterns = [
    /(?:add|create|build|make|implement|fix|update|change)\s+(?:a|an|the)?\s*([a-z0-9-\s]+?)(?:\s+page|\s+section|\s+feature|\s+component|\.|\?|$)/i,
    /(?:working on|building|fixing)\s+(?:a|an|the)?\s*([a-z0-9-\s]+?)(?:\s+page|\s+section|\s+feature|\.|\?|$)/i,
    /([a-z0-9-\s]+?)\s+(?:page|section|feature|component|flow|modal|form)/i,
  ]
  
  for (const pattern of patterns) {
    const match = recentUserMessages.match(pattern)
    if (match && match[1]) {
      const topic = match[1].trim().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 20)
      if (topic.length >= 3) {
        return topic
      }
    }
  }
  
  // Fallback: extract 2-3 meaningful words from last user message
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()
  if (lastUserMsg?.content) {
    const words = lastUserMsg.content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'can', 'you', 'please'].includes(w))
      .slice(0, 2)
    
    if (words.length >= 1) {
      return words.join('-')
    }
  }
  
  // Ultimate fallback
  return `${currentTitle.slice(0, 15)} (cont.)`
}
