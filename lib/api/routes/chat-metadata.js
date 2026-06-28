import { NextResponse } from 'next/server'
import { handleCORS, getAuthUser, checkAllowlist } from '@/lib/api/helpers'
import { db } from '@/lib/supabase/db'
import { hasPermission, getUserRole } from '@/lib/constants'

export async function handle(route, method, path, request) {
  // Update chat tags
  if (route.match(/^\/chats\/[^/]+\/tags$/) && method === 'PUT') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const tags = Array.isArray(body.tags) ? body.tags : []
      const updated = await db.chats.setTags(chatId, tags)
      return handleCORS(NextResponse.json({ success: true, chat: updated }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // Toggle chat pinned status
  if (route.match(/^\/chats\/[^/]+\/pin$/) && method === 'PUT') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const pinned = body.pinned === true
      const updated = await db.chats.setPinned(chatId, pinned)
      return handleCORS(NextResponse.json({ success: true, chat: updated }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // Toggle chat archived status
  if (route.match(/^\/chats\/[^/]+\/archive$/) && method === 'PUT') {
    const chatId = path[1]
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const archived = body.archived === true
      const updated = await db.chats.setArchived(chatId, archived)
      return handleCORS(NextResponse.json({ success: true, chat: updated }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // Save last active Core System chat
  if (route.match(/^\/users\/preferences\/last-core-chat$/) && method === 'PUT') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const body = await request.json()
      const chatId = body.chat_id || null
      await db.users.setLastCoreChatId(dbUser.id, chatId)
      return handleCORS(NextResponse.json({ success: true }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  // Get last active Core System chat
  if (route.match(/^\/users\/preferences\/last-core-chat$/) && method === 'GET') {
    const authUser = await getAuthUser(request)
    if (!authUser) {
      return handleCORS(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    
    const dbUser = await checkAllowlist(authUser.email)
    if (!dbUser) {
      return handleCORS(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    }

    try {
      const chatId = await db.users.getLastCoreChatId(dbUser.id)
      return handleCORS(NextResponse.json({ chat_id: chatId }))
    } catch (err) {
      return handleCORS(NextResponse.json({ error: err.message }, { status: 500 }))
    }
  }

  return null
}
