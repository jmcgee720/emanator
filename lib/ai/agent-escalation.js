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
import { Pool } from 'pg'

/**
 * Create an escalation chat where project agent + Core System collaborate.
 * Returns the new chat ID and a summary message to send back to the project agent.
 * 
 * Uses raw SQL via pg library to bypass Supabase client schema cache issues.
 */
export async function createEscalationChat({
  userId,
  fromChatId,
  fromProjectId,
  taskDescription,
  db = defaultDb,
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase credentials');
  }
  
  // Extract project ref from URL
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) {
    throw new Error('Could not extract project ref from Supabase URL');
  }
  
  // Use the connection pooler endpoint
  const connectionString = `postgresql://postgres.${projectRef}:${serviceKey}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  
  try {
    const client = await pool.connect();
    
    // First, ensure the metadata column exists (idempotent)
    await client.query(`
      ALTER TABLE chats 
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
      
      ALTER TABLE chats 
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
      
      ALTER TABLE chats 
      ALTER COLUMN project_id DROP NOT NULL;
    `);
    
    // Create the escalation chat using raw SQL
    const title = `${SELF_EDIT_PREFIX}Escalation: ${taskDescription.slice(0, 50)}`;
    const metadata = {
      is_escalation: true,
      escalation_source: {
        chat_id: fromChatId,
        project_id: fromProjectId,
        task: taskDescription,
        created_at: new Date().toISOString(),
      },
    };
    
    const { rows } = await client.query(`
      INSERT INTO chats (user_id, project_id, title, metadata, created_at, updated_at)
      VALUES ($1, NULL, $2, $3, NOW(), NOW())
      RETURNING id, title, metadata, created_at, updated_at
    `, [userId, title, JSON.stringify(metadata)]);
    
    const escalationChat = rows[0];
    
    // Create the initial context message
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
    ].join('\n');
    
    await client.query(`
      INSERT INTO messages (chat_id, project_id, role, content, metadata, created_at)
      VALUES ($1, NULL, 'assistant', $2, $3, NOW())
    `, [
      escalationChat.id,
      contextMessage,
      JSON.stringify({
        system_message: true,
        escalation_context: true,
        agent_source: 'system',
      }),
    ]);
    
    client.release();
    await pool.end();
    
    return {
      escalationChatId: escalationChat.id,
      contextMessage,
    };
  } catch (error) {
    await pool.end();
    console.error('[Escalation] Error creating escalation chat:', error);
    throw new Error(`Failed to create escalation chat: ${error.message}`);
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
  // Try to create the escalation chat
  let escalationChatId, contextMessage;
  try {
    const result = await createEscalationChat({
      userId,
      fromChatId: chatId,
      fromProjectId: projectId,
      taskDescription,
      db,
    });
    escalationChatId = result.escalationChatId;
    contextMessage = result.contextMessage;
  } catch (error) {
    // If we get a schema cache error, try to apply the migration
    if (error.message?.includes("Could not find the 'metadata' column")) {
      console.log('[Escalation] Schema cache error detected, applying migration...');
      
      // Call the migration endpoint
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      
      try {
        const response = await fetch(`${baseUrl}/api/migrations/apply-chats-metadata`, {
          method: 'POST',
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(`Migration failed: ${errorData.error || response.statusText}`);
        }
        
        const result = await response.json();
        console.log('[Escalation] Migration applied:', result);
        
        // Retry the chat creation
        const retryResult = await createEscalationChat({
          userId,
          fromChatId: chatId,
          fromProjectId: projectId,
          taskDescription,
          db,
        });
        escalationChatId = retryResult.escalationChatId;
        contextMessage = retryResult.contextMessage;
      } catch (migrationError) {
        console.error('[Escalation] Migration failed:', migrationError);
        throw new Error(
          `Failed to create escalation chat. The database schema needs to be updated. ` +
          `Migration error: ${migrationError.message}`
        );
      }
    } else {
      // Re-throw other errors
      throw error;
    }
  }

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
