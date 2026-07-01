/**
 * Agent Learning System
 * 
 * Detects failure patterns, captures user feedback, and searches for
 * similar past incidents to prevent repeating mistakes.
 */

import { db } from '../supabase/db.js'

/**
 * Detect if the current turn represents a failure pattern that should
 * be recorded as an incident.
 * 
 * @param {Object} context - { userMessage, agentResponse, chatHistory, chatId, projectId, userId }
 * @returns {Object|null} - Incident payload or null if no incident detected
 */
export function detectIncident(context) {
  const { userMessage, agentResponse, chatHistory, chatId, projectId, userId } = context
  const userText = userMessage?.content?.toLowerCase() || ''
  const agentText = agentResponse?.content?.toLowerCase() || ''

  // Pattern 1: User says "you can't do X"
  if (
    /you can'?t|you cannot|that doesn'?t work|that won'?t work|you don'?t have access/i.test(userText)
  ) {
    return {
      chat_id: chatId,
      project_id: projectId,
      user_id: userId,
      incident_type: 'capability_limit',
      user_request: userMessage.content.slice(0, 500),
      agent_response: agentResponse?.content?.slice(0, 500) || null,
      what_failed: extractFailureReason(userText),
      turn_number: chatHistory.length,
      metadata: { detected_by: 'capability_limit_pattern' },
    }
  }

  // Pattern 2: User says "you already asked me this"
  if (
    /already asked|asked me (this|that) before|stop asking|you keep asking/i.test(userText)
  ) {
    return {
      chat_id: chatId,
      project_id: projectId,
      user_id: userId,
      incident_type: 'redundant_question',
      user_request: userMessage.content.slice(0, 500),
      agent_response: agentResponse?.content?.slice(0, 500) || null,
      what_failed: 'Agent asked a question the user already answered',
      turn_number: chatHistory.length,
      metadata: { detected_by: 'redundant_question_pattern' },
    }
  }

  // Pattern 3: User says "that didn't work" or "still broken" after agent claimed success
  if (
    /didn'?t work|still (broken|not working|failing)|that failed|not fixed/i.test(userText) &&
    chatHistory.length > 0
  ) {
    const lastAgentMsg = [...chatHistory].reverse().find(m => m.role === 'assistant')
    if (
      lastAgentMsg &&
      /fixed|should work|that'?s working|resolved|done|completed/i.test(lastAgentMsg.content)
    ) {
      return {
        chat_id: chatId,
        project_id: projectId,
        user_id: userId,
        incident_type: 'false_confidence',
        user_request: userMessage.content.slice(0, 500),
        agent_response: lastAgentMsg.content.slice(0, 500),
        what_failed: 'Agent claimed fix worked but user reports it did not',
        turn_number: chatHistory.length,
        metadata: { detected_by: 'false_confidence_pattern' },
      }
    }
  }

  // Pattern 4: User corrects the agent's approach
  if (
    /no,? (that'?s|thats) (not|wrong)|actually,? (you should|the right way)|instead,? (do|try)/i.test(userText)
  ) {
    return {
      chat_id: chatId,
      project_id: projectId,
      user_id: userId,
      incident_type: 'wrong_approach',
      user_request: userMessage.content.slice(0, 500),
      agent_response: agentResponse?.content?.slice(0, 500) || null,
      what_failed: 'User corrected the agent\'s approach',
      turn_number: chatHistory.length,
      metadata: { detected_by: 'correction_pattern' },
    }
  }

  // Pattern 5: Loop detection - agent tried same tool 3+ times in last 5 turns
  if (agentResponse?.tool_calls?.length > 0) {
    const recentTurns = chatHistory.slice(-5)
    const toolCounts = {}
    for (const msg of recentTurns) {
      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        for (const tc of msg.metadata.tool_calls) {
          const key = `${tc.name}:${JSON.stringify(tc.input).slice(0, 100)}`
          toolCounts[key] = (toolCounts[key] || 0) + 1
        }
      }
    }
    const maxCount = Math.max(...Object.values(toolCounts), 0)
    if (maxCount >= 3) {
      return {
        chat_id: chatId,
        project_id: projectId,
        user_id: userId,
        incident_type: 'loop_detected',
        user_request: userMessage.content.slice(0, 500),
        agent_response: agentResponse?.content?.slice(0, 500) || null,
        what_failed: 'Agent repeated the same tool call 3+ times',
        turn_number: chatHistory.length,
        metadata: { detected_by: 'loop_detection', tool_counts: toolCounts },
      }
    }
  }

  return null
}

/**
 * Extract a concise failure reason from user's message
 */
function extractFailureReason(userText) {
  // Try to extract the specific thing that failed
  const match = userText.match(/you can'?t (.{10,80})|that doesn'?t (.{10,80})|you don'?t have access to (.{10,80})/)
  if (match) {
    return match[1] || match[2] || match[3]
  }
  return userText.slice(0, 200)
}

/**
 * Record an incident to the database
 * 
 * @param {Object} incident - Incident payload from detectIncident
 * @param {Array<number>} embedding - Optional embedding vector for similarity search
 */
export async function recordIncident(incident, embedding = null) {
  try {
    const payload = { ...incident }
    if (embedding) {
      payload.embedding = embedding
    }
    const saved = await db.agentIncidents.create(payload)
    console.log(`[AgentLearning] Recorded incident: ${incident.incident_type} (${saved.id})`)
    return saved
  } catch (err) {
    console.error('[AgentLearning] Failed to record incident:', err)
    return null
  }
}

/**
 * Search for similar past incidents before responding to a user request.
 * Returns incidents that match the current request semantically.
 * 
 * @param {string} userRequest - Current user message
 * @param {string} userId - User ID
 * @param {Function} embedFn - Function to generate embedding: async (text) => [...]
 * @returns {Array} - Similar incidents with similarity scores
 */
export async function searchSimilarIncidents(userRequest, userId, embedFn) {
  try {
    const embedding = await embedFn(userRequest)
    if (!embedding || !Array.isArray(embedding)) {
      console.warn('[AgentLearning] embedFn did not return valid embedding')
      return []
    }
    
    const similar = await db.agentIncidents.searchSimilar(embedding, userId, 0.8, 5)
    console.log(`[AgentLearning] Found ${similar.length} similar incidents for user ${userId}`)
    return similar
  } catch (err) {
    console.error('[AgentLearning] Failed to search similar incidents:', err)
    return []
  }
}

/**
 * Record user feedback on an agent action
 * 
 * @param {Object} feedback - { chatId, messageId, projectId, userId, actionType, actionDetails, feedback, userNote }
 */
export async function recordFeedback(feedback) {
  try {
    const saved = await db.agentFeedback.create({
      chat_id: feedback.chatId,
      message_id: feedback.messageId,
      project_id: feedback.projectId || null,
      user_id: feedback.userId,
      action_type: feedback.actionType,
      action_details: feedback.actionDetails,
      feedback: feedback.feedback, // 'worked' | 'failed' | 'partial'
      user_note: feedback.userNote || null,
    })
    console.log(`[AgentLearning] Recorded feedback: ${feedback.actionType} → ${feedback.feedback} (${saved.id})`)
    return saved
  } catch (err) {
    console.error('[AgentLearning] Failed to record feedback:', err)
    return null
  }
}

/**
 * Get feedback stats for a specific action type
 * 
 * @param {string} actionType - e.g. 'file_edit', 'command_run'
 * @param {string} userId - Optional user ID to filter by
 * @returns {Object|null} - { total_count, worked_count, failed_count, success_rate }
 */
export async function getFeedbackStats(actionType, userId = null) {
  try {
    const stats = await db.agentFeedback.getStats(actionType, userId)
    return stats
  } catch (err) {
    console.error('[AgentLearning] Failed to get feedback stats:', err)
    return null
  }
}

/**
 * Build a summary of similar past incidents to inject into system prompt
 * 
 * @param {Array} incidents - Array of incident objects from searchSimilarIncidents
 * @returns {string} - Formatted text for system prompt
 */
export function buildIncidentSummary(incidents) {
  if (!incidents || incidents.length === 0) return ''

  const lines = [
    '## PAST INCIDENTS (similar to current request):',
    '',
  ]

  for (const inc of incidents.slice(0, 3)) {
    lines.push(`**${inc.incident_type}** (similarity: ${(inc.similarity * 100).toFixed(0)}%)`)
    lines.push(`  User asked: "${inc.user_request.slice(0, 100)}..."`)
    lines.push(`  What failed: ${inc.what_failed}`)
    if (inc.resolution) {
      lines.push(`  Resolution: ${inc.resolution}`)
    }
    lines.push('')
  }

  lines.push('**Learn from these past failures. Do not repeat the same mistake.**')
  lines.push('')

  return lines.join('\n')
}

/**
 * Detect if a tool call should trigger feedback capture.
 * Returns action metadata if feedback should be captured, null otherwise.
 * 
 * @param {Object} toolCall - { name, input, result }
 * @returns {Object|null} - { actionType, actionDetails } or null
 */
export function detectFeedbackableAction(toolCall) {
  const { name, input, result } = toolCall

  switch (name) {
    case 'write_file':
    case 'edit_file':
      return {
        actionType: name === 'write_file' ? 'file_create' : 'file_edit',
        actionDetails: {
          path: input.path,
          old_str: input.old_str?.slice(0, 100),
          new_str: input.new_str?.slice(0, 100),
        },
      }
    
    case 'delete_file':
      return {
        actionType: 'file_delete',
        actionDetails: { path: input.path },
      }
    
    case 'run_command':
      return {
        actionType: 'command_run',
        actionDetails: { command: input.command?.slice(0, 100) },
      }
    
    default:
      return null
  }
}
