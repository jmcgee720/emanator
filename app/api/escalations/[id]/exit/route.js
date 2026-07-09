/**
 * POST /api/escalations/:id/exit
 * 
 * Exit an escalation and mark it as resolved.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase/db'
import { createClient } from '@/lib/supabase/server'

export async function POST(request, { params }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const escalationChatId = params.id

    // Verify the chat exists and belongs to the user
    const escalationChat = await db.chats.findById(escalationChatId)
    if (!escalationChat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (escalationChat.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!escalationChat.metadata?.is_escalation) {
      return NextResponse.json({ error: 'Not an escalation chat' }, { status: 400 })
    }

    // Mark as resolved
    await db.chats.update(escalationChatId, {
      metadata: {
        ...escalationChat.metadata,
        resolved: true,
        resolved_at: new Date().toISOString(),
      },
    })

    // Post a summary to the source project chat (if it exists)
    const source = escalationChat.metadata.escalation_source
    if (source?.chat_id) {
      const messages = await db.messages.findByChatId(escalationChatId)
      const summary = [
        `**🤝 Escalation Complete**`,
        ``,
        `Task: ${source.task}`,
        ``,
        `The Core System agent has implemented the requested capability.`,
        ``,
        `Messages exchanged: ${messages.length}`,
        ``,
        `[View full escalation chat →](/chats/${escalationChatId})`,
      ].join('\n')

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
    }

    return NextResponse.json({
      success: true,
      message: 'Escalation resolved',
    })
  } catch (error) {
    console.error('[POST /api/escalations/:id/exit] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
