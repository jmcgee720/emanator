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

  const escalationChatId = pathParts[2] // /api/escalations/:id/exit

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
 * Route handler — matches /api/escalations/*
 */
export async function handle(route, method, pathParts, request, context) {
  // /api/escalations/:id/exit
  if (pathParts.length === 4 && pathParts[3] === 'exit') {
    return handleExitEscalation(route, method, pathParts, request, context)
  }

  return null // no match
}
