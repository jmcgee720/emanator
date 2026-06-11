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
 * Generate an AI summary of what was being worked on in the parent chat.
 * @param {array} messages - Recent messages from parent chat
 * @returns {Promise<object>} - { topic, completed, inProgress }
 */
async function generateWorkContextSummary(messages) {
  if (messages.length === 0) {
    return { topic: null, completed: [], inProgress: null }
  }

  // Build a conversation transcript for the LLM
  const transcript = messages.map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant'
    const content = (m.content || '').trim().slice(0, 500) // Limit length
    return `${role}: ${content}`
  }).join('\n\n')

  const summaryPrompt = `You are summarizing a chat conversation that is being forked. Read the transcript below and extract:

1. **Topic** (1-2 sentences): What was the user trying to accomplish? What was the main focus of the conversation?
2. **Completed** (bullet list): What tasks or fixes were successfully completed?
3. **In Progress** (1 sentence): What was the last thing being worked on when the fork happened?

Transcript:
${transcript}

Respond in this exact format:
TOPIC: <1-2 sentence summary>
COMPLETED:
- <item 1>
- <item 2>
IN_PROGRESS: <1 sentence>`

  try {
    const response = await callAnthropicDirect({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      messages: [{ role: 'user', content: summaryPrompt }],
    })

    const summaryText = response.content[0]?.text || ''
    
    // Parse the response
    const topicMatch = summaryText.match(/TOPIC:\s*(.+?)(?=\nCOMPLETED:|$)/s)
    const completedMatch = summaryText.match(/COMPLETED:\s*((?:- .+?\n?)+)/s)
    const inProgressMatch = summaryText.match(/IN_PROGRESS:\s*(.+?)$/s)

    const topic = topicMatch?.[1]?.trim() || null
    const completed = completedMatch?.[1]
      ?.split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line.length > 0) || []
    const inProgress = inProgressMatch?.[1]?.trim() || null

    return { topic, completed, inProgress }
  } catch (error) {
    console.error('[fork-summary] Failed to generate AI summary:', error)
    // Fallback to heuristic extraction
    return extractWorkContext(messages)
  }
}

/**
 * Extract work context from recent messages (heuristic fallback).
 * Uses pattern matching when AI summary fails.
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
