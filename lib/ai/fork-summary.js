/**
 * Fork Summary Generator
 * 
 * Generates auto-summary messages when a forked chat is opened for the first time.
 * Includes context from parent chat, attachments, and a Proceed button.
 */

import { callAnthropicDirect } from './providers/anthropic.js'

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
  summaryParts.push('Type a message below to continue the conversation.')
  
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
 * Uses an LLM-style approach: summarize the conversation thread intelligently.
 * @param {array} messages - Recent messages from parent chat
 * @returns {object} - { topic, completed, inProgress }
 */
function extractWorkContext(messages) {
  const context = {
    topic: null,
    completed: [],
    inProgress: null,
  }
  
  if (messages.length === 0) return context
  
  // Build a narrative from the last few exchanges
  const userMessages = messages.filter(m => m.role === 'user')
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  
  // Topic: summarize what the user was asking about (last 2-3 user messages)
  if (userMessages.length > 0) {
    const recentUserMsgs = userMessages.slice(-3)
    const topics = recentUserMsgs.map(m => {
      const content = (m.content || '').trim()
      // Strip attachment metadata noise
      const cleaned = content.replace(/\[ATTACHED FILES[^\]]*\]/g, '').trim()
      // Take first meaningful sentence
      const firstSentence = cleaned.split(/[.!?]\n/)[0]
      return firstSentence.slice(0, 120)
    }).filter(t => t.length > 10)
    
    if (topics.length > 0) {
      // If multiple topics, join them; otherwise use the last one
      context.topic = topics.length > 1 
        ? topics.join(' → ') 
        : topics[topics.length - 1]
    }
  }
  
  // Completed: look for file writes, edits, or explicit completion markers
  for (const msg of assistantMessages) {
    const content = msg.content || ''
    const metadata = msg.metadata || {}
    
    // Check for file operations in metadata
    if (metadata.generatedFiles?.length > 0) {
      const fileNames = metadata.generatedFiles.map(f => f.path || f.name).filter(Boolean)
      if (fileNames.length > 0) {
        context.completed.push(`Created ${fileNames.slice(0, 3).join(', ')}${fileNames.length > 3 ? ` and ${fileNames.length - 3} more` : ''}`)
      }
    }
    if (metadata.diffFiles?.length > 0 && metadata.diffStatus === 'applied') {
      const fileNames = metadata.diffFiles.map(f => f.path).filter(Boolean)
      if (fileNames.length > 0) {
        context.completed.push(`Edited ${fileNames.slice(0, 3).join(', ')}${fileNames.length > 3 ? ` and ${fileNames.length - 3} more` : ''}`)
      }
    }
    
    // Look for explicit completion markers in text
    const completionMatch = content.match(/(?:✅|completed|fixed|done|successfully)\s+([^.!?\n]{10,100})/i)
    if (completionMatch && completionMatch[1]) {
      const item = completionMatch[1].trim()
      // Avoid duplicates
      if (!context.completed.some(c => c.includes(item.slice(0, 30)))) {
        context.completed.push(item)
      }
    }
  }
  
  // Deduplicate and limit to 4 items
  context.completed = [...new Set(context.completed)].slice(0, 4)
  
  // In-progress: what was the last assistant message about?
  if (assistantMessages.length > 0) {
    const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]
    const content = lastAssistantMsg.content || ''
    
    // Look for forward-looking statements
    const progressPatterns = [
      /(?:I'll|I will|I'm about to|next I'll|now I'll)\s+([^.!?\n]{10,120})/i,
      /(?:currently|working on|in progress)\s+([^.!?\n]{10,120})/i,
      /(?:next step|about to)\s+([^.!?\n]{10,120})/i,
    ]
    
    for (const pattern of progressPatterns) {
      const match = content.match(pattern)
      if (match && match[1]) {
        context.inProgress = match[1].trim()
        break
      }
    }
    
    // Fallback: use the last substantive sentence
    if (!context.inProgress) {
      const sentences = content
        .replace(/```[\s\S]*?```/g, '') // strip code blocks
        .split(/[.!?]\n/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 200)
      
      if (sentences.length > 0) {
        context.inProgress = sentences[sentences.length - 1]
      }
    }
  }
  
  return context
}
