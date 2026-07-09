/**
 * Exit an escalation chat.
 * Marks the escalation as resolved and posts a summary to the source project chat.
 */

import { NextResponse } from 'next/server'
import { exitEscalation } from '@/lib/ai/agent-escalation'
import { createClient } from '@/lib/supabase/client'

export async function POST(request, { params }) {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const escalationChatId = params.id
    
    // Verify the user owns this escalation chat
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('*')
      .eq('id', escalationChatId)
      .eq('user_id', user.id)
      .single()
    
    if (chatError || !chat) {
      return NextResponse.json({ error: 'Escalation chat not found' }, { status: 404 })
    }
    
    // Exit the escalation
    const result = await exitEscalation({ escalationChatId })
    
    return NextResponse.json({
      success: true,
      sourceChatId: result.sourceChatId,
      summary: result.summary,
    })
  } catch (error) {
    console.error('[API] Error exiting escalation:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to exit escalation' },
      { status: 500 }
    )
  }
}
