/**
 * Escalation API routes
 * 
 * Handles agent-to-agent escalation lifecycle:
 *   • POST /api/escalations/:id/exit — exit escalation, return to source chat
 */

import { NextResponse } from 'next/server'
import { db as defaultDb } from '@/lib/supabase/db'
import { exitEscalation } from '@/lib/ai/agent-escalation'

/**
 * POST /api/escalations/:escalationChatId/exit
 * 
 * Exit an escalation chat and return to the source project chat.
 * Generates a summary of what was accomplished and posts it to the source chat.
 */
export async function handleExitEscalation(route, method, pathParts, request, { authUser, dbUser, db = defaultDb }) {
  if (method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const escalationChatId = pathParts[1] // pathParts = ['escalations', '<id>', 'exit']

  if (!escalationChatId) {
    return NextResponse.json({ error: 'Escalation chat ID required' }, { status: 400 })
  }

  try {
    const result = await exitEscalation({
      escalationChatId,
      db,
    })

    return NextResponse.json({
      success: true,
      sourceChatId: result.sourceChatId,
      summary: result.summary,
    })
  } catch (err) {
    console.error('[escalations] exit failed:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to exit escalation' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/escalations/debug?id=<uuid>
 * 
 * Debug endpoint for escalation system.
 * Returns diagnostic info about escalation chats and queries.
 */
async function handleDebug(route, method, pathParts, request) {
  if (method !== 'GET') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { searchParams } = new URL(request.url)
    const escalationId = searchParams.get('id')
    
    const diagnostics = {
      user_id: user.id,
      timestamp: new Date().toISOString(),
    }
    
    // 1. Check if specific escalation exists
    if (escalationId) {
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('*')
        .eq('id', escalationId)
        .single()
      
      diagnostics.escalation_lookup = {
        id: escalationId,
        found: !!chat,
        error: chatError?.message || null,
        chat: chat || null,
      }
    }
    
    // 2. Test the useEscalationListener query
    const { data: activeEscalation, error: queryError } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', user.id)
      .is('project_id', null)
      .not('metadata->is_escalation', 'is', null)
      .is('metadata->resolved', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    diagnostics.listener_query = {
      found: !!activeEscalation,
      error: queryError?.message || null,
      result: activeEscalation || null,
    }
    
    // 3. Debug each filter step
    const { data: byUser } = await supabase
      .from('chats')
      .select('id, user_id, project_id, title, metadata')
      .eq('user_id', user.id)
      .is('project_id', null)
    
    diagnostics.filter_debug = {
      step1_user_and_null_project: {
        count: byUser?.length || 0,
        chats: byUser || [],
      },
    }
    
    if (byUser && byUser.length > 0) {
      const { data: withMeta } = await supabase
        .from('chats')
        .select('id, metadata')
        .eq('user_id', user.id)
        .is('project_id', null)
        .not('metadata->is_escalation', 'is', null)
      
      diagnostics.filter_debug.step2_with_is_escalation = {
        count: withMeta?.length || 0,
        chats: withMeta || [],
      }
      
      if (withMeta && withMeta.length > 0) {
        const { data: unresolved } = await supabase
          .from('chats')
          .select('id, metadata')
          .eq('user_id', user.id)
          .is('project_id', null)
          .not('metadata->is_escalation', 'is', null)
          .is('metadata->resolved', null)
        
        diagnostics.filter_debug.step3_unresolved = {
          count: unresolved?.length || 0,
          chats: unresolved || [],
        }
      }
    }
    
    // 4. List all chats for this user (for debugging)
    const { data: allChats } = await supabase
      .from('chats')
      .select('id, user_id, project_id, title, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
    
    diagnostics.recent_chats = allChats || []
    
    return NextResponse.json(diagnostics, { status: 200 })
  } catch (error) {
    console.error('[API] Error in escalation debug:', error)
    return NextResponse.json(
      { error: error.message || 'Debug failed' },
      { status: 500 }
    )
  }
}

/**
 * Route handler — matches /api/escalations/*
 */
export async function handle(route, method, pathParts, request, context) {
  // pathParts = ['escalations', ...] (no 'api' prefix)
  
  // /api/escalations/debug
  if (pathParts.length === 2 && pathParts[1] === 'debug') {
    return handleDebug(route, method, pathParts, request)
  }

  // /api/escalations/:id/exit
  if (pathParts.length === 3 && pathParts[2] === 'exit') {
    return handleExitEscalation(route, method, pathParts, request, context)
  }

  return null // no match
}
