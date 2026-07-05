/**
 * Agent-to-Agent Escalation
 * 
 * Allows project agents to spawn a joint conversation with Core System
 * when they encounter tasks they cannot complete. The user watches both
 * agents collaborate in real-time, then exits back to the project chat.
 * 
 * ARCHITECTURE (Option A: Single Shared Chat):
 *   • Project agent calls `escalate_to_core_system` tool
 *   • Creates a new chat with metadata: { is_escalation: true, escalation_source: { chat_id, project_id, task } }
 *   • The escalation chat has NO project_id (so Core System can operate on Auroraly source)
 *   • Both agents read/write to the SAME chat (messages table, same chat_id)
 *   • Messages tagged with metadata.agent_source = 'project_agent' | 'core_system'
 *   • User sees a single chat thread with color-coded agent labels
 *   • When task is complete, user clicks "Exit Escalation" → returns to project chat with a summary
 * 
 * SECURITY:
 *   • Only project agents can escalate (not Core System → project)
 *   • Escalation chat inherits user's permissions (owner-only for self-edit)
 *   • Core System operates on Auroraly source (project_id = null)
 *   • Project agent cannot write to Auroraly source (existing guard in project mode)
 */

import { db as defaultDb } from '@/lib/supabase/db'
import { SELF_EDIT_PREFIX } from '@/lib/constants'

/**
 * Create an escalation chat where project agent + Core System collaborate.
 * Returns the new chat ID and a summary message to send back to the project agent.
 */
export async function createEscalationChat({
  userId,
  fromChatId,
  fromProjectId,
  taskDescription,
  db = defaultDb,
}) {
  // Create a Core System chat with escalation metadata
  const escalationChat = await db.chats.create({
    user_id: userId,
    project_id: null, // Core System chats have no project
    title: `${SELF_EDIT_PREFIX}Escalation: ${taskDescription.slice(0, 50)}`,
    metadata: {
      is_escalation: true,
      escalation_source: {
        chat_id: fromChatId,
        project_id: fromProjectId,
        task: taskDescription,
        created_at: new Date().toISOString(),
      },
    },
  })

  // Create the initial context message that explains the collaboration to both agents
  const contextMessage = [
    `**🤝 AGENT COLLABORATION STARTED**`,
    ``,
    `**Task:** ${taskDescription}`,
    `**Source project:** ${fromProjectId}`,
    `**Source chat:** ${fromChatId}`,
    ``,
    `**How this works:**`,
    `  • Both agents (Project Agent + Core System) share this chat`,
    `  • Messages are tagged with which agent sent them`,
    `  • User can send messages to both agents`,
    `  • When done, user clicks "Exit Escalation" to return to the project chat`,
    ``,
    `**Roles:**`,
    `  • **Core System**: Implement the missing capability in the Auroraly platform`,
    `  • **Project Agent**: Verify the new capability works in the project`,
  ].join('\n')

  await db.messages.create({
    chat_id: escalationChat.id,
    project_id: null,
    role: 'assistant',
    content: contextMessage,
    metadata: {
      system_message: true,
      escalation_context: true,
      agent_source: 'system',
    },
  })

  return {
    escalationChatId: escalationChat.id,
    contextMessage,
  }
}

/**
 * Check if a chat is an active escalation.
 */
export function isEscalationChat(chat) {
  return chat?.metadata?.is_escalation === true
}

/**
 * Get the source chat/project for an escalation.
 */
export function getEscalationSource(chat) {
  return chat?.metadata?.escalation_source || null
}

/**
 * Exit an escalation and return to the source project chat.
 * Generates a summary of what was accomplished.
 */
export async function exitEscalation({
  escalationChatId,
  db = defaultDb,
}) {
  const escalationChat = await db.chats.findById(escalationChatId)
  if (!escalationChat || !isEscalationChat(escalationChat)) {
    throw new Error('Not an escalation chat')
  }

  const source = getEscalationSource(escalationChat)
  if (!source) {
    throw new Error('Escalation source metadata missing')
  }

  // Load all messages from the escalation chat
  const messages = await db.messages.findByChatId(escalationChatId)
  
  // Generate a summary (simple version — could use LLM later)
  const summary = [
    `**Escalation Complete**`,
    ``,
    `Task: ${source.task}`,
    ``,
    `The Core System agent has implemented the requested capability. You can now use it in this project.`,
    ``,
    `Messages exchanged: ${messages.length}`,
    ``,
    `[View full escalation chat →](/chats/${escalationChatId})`,
  ].join('\n')

  // Post the summary to the source project chat
  await db.messages.create({
    chat_id: source.chat_id,
    project_id: source.project_id,
    role: 'assistant',
    content: summary,
    metadata: {
      escalation_summary: true,
      escalation_chat_id: escalationChatId,
    },
  })

  // Mark the escalation chat as resolved
  await db.chats.update(escalationChatId, {
    metadata: {
      ...escalationChat.metadata,
      resolved: true,
      resolved_at: new Date().toISOString(),
    },
  })

  return {
    sourceChatId: source.chat_id,
    summary,
  }
}

/**
 * Tool definition for project agents to escalate to Core System.
 * This gets added to buildDefaultToolset in project mode only.
 */
export const escalateToCoreSystemTool = {
  name: 'escalate_to_core_system',
  description: [
    'Escalate a task to the Core System agent when you lack the capability to complete it yourself.',
    '',
    'Use this when:',
    '  • You need a new tool (e.g. run_command, database access, API integration)',
    '  • An existing tool is missing parameters you need',
    '  • The task requires changes to the Auroraly platform itself',
    '',
    'This creates a joint conversation where you and Core System collaborate. The user watches both of you work together.',
    '',
    'DO NOT use this for:',
    '  • User errors (wrong API key, typo) — fix those yourself',
    '  • Code bugs in the project — debug them yourself',
    '  • Missing information you can ask the user for',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Clear description of what you need Core System to build. Include: what capability is missing, what you tried, why it failed, and what the user is trying to accomplish.',
      },
      urgency: {
        type: 'string',
        enum: ['blocking', 'important', 'nice-to-have'],
        description: 'How critical is this? "blocking" = user cannot proceed without it. "important" = workaround exists but painful. "nice-to-have" = quality-of-life improvement.',
      },
    },
    required: ['task_description', 'urgency'],
  },
}

/**
 * Handler for the escalate_to_core_system tool.
 * Called from agent-tools-v2.js when the project agent invokes the tool.
 */
export async function handleEscalation({
  taskDescription,
  urgency,
  userId,
  chatId,
  projectId,
  db = defaultDb,
}) {
  // Create the escalation chat
  const { escalationChatId, contextMessage } = await createEscalationChat({
    userId,
    fromChatId: chatId,
    fromProjectId: projectId,
    taskDescription,
    db,
  })

  // Return a message to the project agent with redirect metadata
  return {
    content: [
      `✅ **Escalated to Core System**`,
      ``,
      `I've created a joint conversation with the Core System agent to implement this capability.`,
      ``,
      `**Task:** ${taskDescription}`,
      `**Urgency:** ${urgency}`,
      ``,
      `Redirecting you to the collaboration chat now…`,
    ].join('\n'),
    escalationChatId,
    // Special metadata that tells the frontend to redirect
    redirect: `/chats/${escalationChatId}`,
  }
}
