/**
 * Fork Summary Generator
 * 
 * Generates auto-summary messages when a forked chat is opened for the first time.
 * Includes context from parent chat, attachments, and a Proceed button.
 */

/**
 * Check if a chat needs an auto-fork-summary on first open.
 * @param {object} chat - The chat record from DB
 * @param {array} messages - Current messages in the chat
 * @returns {boolean} - True if we should auto-send a fork summary
 */
export function shouldAutoSendForkSummary(chat, messages) {
  // Only trigger if:
  // 1. Chat has a parent_chat_id (it's a fork)
  // 2. Chat has zero messages (first open)
  return !!(chat?.parent_chat_id && messages.length === 0)
}

/**
 * Generate a fork summary message with context from the parent chat.
 * @param {object} params
 * @param {object} params.chat - The forked chat
 * @param {object} params.parentChat - The parent chat
 * @param {array} params.parentMessages - Messages from parent chat
 * @param {object} params.db - Database instance
 * @returns {Promise<object>} - The summary message content and metadata
 */
export async function generateForkSummary({ chat, parentChat, parentMessages, db }) {
  // Extract recent context (last 10-15 messages)
  const recentMessages = parentMessages.slice(-15)
  
  // Find attachments from recent messages
  const attachments = []
  for (const msg of recentMessages) {
    if (msg.metadata?.attachments && Array.isArray(msg.metadata.attachments)) {
      attachments.push(...msg.metadata.attachments)
    }
  }
  
  // Deduplicate attachments by filename
  const uniqueAttachments = []
  const seen = new Set()
  for (const att of attachments) {
    if (att.filename && !seen.has(att.filename)) {
      seen.add(att.filename)
      uniqueAttachments.push(att)
    }
  }
  
  // Extract what was being worked on
  const workContext = extractWorkContext(recentMessages)
  
  // Build summary text
  const summaryParts = []
  
  summaryParts.push('📋 **Fork Summary**')
  summaryParts.push('')
  summaryParts.push(`This chat continues work from **${parentChat.title}** (${parentMessages.length} messages).`)
  summaryParts.push('')
  
  if (workContext.topic) {
    summaryParts.push(`**What we were working on:**`)
    summaryParts.push(workContext.topic)
    summaryParts.push('')
  }
  
  if (workContext.completed.length > 0) {
    summaryParts.push(`**What was completed:**`)
    workContext.completed.forEach(item => summaryParts.push(`- ${item}`))
    summaryParts.push('')
  }
  
  if (workContext.inProgress) {
    summaryParts.push(`**Current state:**`)
    summaryParts.push(workContext.inProgress)
    summaryParts.push('')
  }
  
  if (uniqueAttachments.length > 0) {
    summaryParts.push(`**Attachments from parent chat:**`)
    uniqueAttachments.slice(0, 5).forEach(att => {
      summaryParts.push(`- ${att.filename}`)
    })
    if (uniqueAttachments.length > 5) {
      summaryParts.push(`- _(and ${uniqueAttachments.length - 5} more)_`)
    }
    summaryParts.push('')
  }
  
  // Check if this is a fork-of-fork (lineage tracking)
  let lineage = [parentChat.id]
  let currentParent = parentChat
  let depth = 0
  const MAX_DEPTH = 5 // Prevent infinite loops
  
  while (currentParent.parent_chat_id && depth < MAX_DEPTH) {
    const grandparent = await db.chats.findById(currentParent.parent_chat_id)
    if (!grandparent) break
    lineage.unshift(grandparent.id)
    currentParent = grandparent
    depth++
  }
  
  if (lineage.length > 1) {
    summaryParts.push(`**Lineage:** This is fork #${lineage.length} in the chain.`)
    summaryParts.push('')
  }
  
  summaryParts.push('---')
  summaryParts.push('')
  summaryParts.push('Click **Proceed** below to continue, or type a new request.')
  
  const summaryText = summaryParts.join('\n')
  
  return {
    content: summaryText,
    metadata: {
      is_fork_summary: true,
      parent_chat_id: parentChat.id,
      parent_title: parentChat.title,
      parent_message_count: parentMessages.length,
      attachments: uniqueAttachments.slice(0, 5), // Include up to 5 attachments
      lineage: lineage,
      fork_depth: lineage.length,
    }
  }
}

/**
 * Extract work context from recent messages.
 * @param {array} messages - Recent messages from parent chat
 * @returns {object} - { topic, completed, inProgress }
 */
function extractWorkContext(messages) {
  const context = {
    topic: null,
    completed: [],
    inProgress: null,
  }
  
  // Find the most recent user message to understand the topic
  const userMessages = messages.filter(m => m.role === 'user')
  if (userMessages.length > 0) {
    const lastUserMsg = userMessages[userMessages.length - 1]
    const content = lastUserMsg.content || ''
    
    // Extract topic from first sentence or first 150 chars
    const firstSentence = content.split(/[.!?]\s/)[0]
    context.topic = firstSentence.slice(0, 150)
  }
  
  // Find completed work from assistant messages
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  for (const msg of assistantMessages) {
    const content = msg.content || ''
    
    // Look for patterns indicating completion
    if (/✅|completed|fixed|done|successfully|deployed/i.test(content)) {
      // Extract the completed item (first sentence)
      const match = content.match(/(?:✅|completed|fixed|done)\s+([^.!?\n]+)/i)
      if (match && match[1]) {
        context.completed.push(match[1].trim())
      }
    }
  }
  
  // Find in-progress work from the last assistant message
  if (assistantMessages.length > 0) {
    const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]
    const content = lastAssistantMsg.content || ''
    
    // Look for patterns indicating current state
    if (/currently|working on|in progress|next step|about to/i.test(content)) {
      const match = content.match(/(?:currently|working on|in progress|next step|about to)\s+([^.!?\n]+)/i)
      if (match && match[1]) {
        context.inProgress = match[1].trim()
      }
    }
    
    // Fallback: use last sentence if no explicit in-progress marker
    if (!context.inProgress) {
      const sentences = content.split(/[.!?]\s/)
      const lastSentence = sentences[sentences.length - 1]
      if (lastSentence && lastSentence.length > 20 && lastSentence.length < 200) {
        context.inProgress = lastSentence.trim()
      }
    }
  }
  
  return context
}
