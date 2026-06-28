'use client'

import { useState, useEffect } from 'react'
import CoreSystemChatList from './CoreSystemChatList'
import { authFetch } from '@/lib/auth-fetch'

export default function CoreSystemWorkspace({
  chats,
  selectedChat,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onForkChat,
  onRenameChat,
  toast,
  dbUser,
}) {
  const [lastChatId, setLastChatId] = useState(null)
  const [loadingLastChat, setLoadingLastChat] = useState(true)

  // Load last active Core System chat on mount
  useEffect(() => {
    if (!dbUser?.id) return
    
    const loadLastChat = async () => {
      try {
        const res = await authFetch('/api/users/preferences/last-core-chat')
        if (res.ok) {
          const data = await res.json()
          if (data.chat_id) {
            setLastChatId(data.chat_id)
            // Auto-select if chat exists in current list
            const chat = chats.find(c => c.id === data.chat_id)
            if (chat && !selectedChat) {
              onSelectChat(chat)
            }
          }
        }
      } catch (err) {
        console.error('[CoreSystemWorkspace] Failed to load last chat:', err)
      } finally {
        setLoadingLastChat(false)
      }
    }

    loadLastChat()
  }, [dbUser?.id])

  // Save last active chat whenever selection changes
  useEffect(() => {
    if (!selectedChat?.id || !dbUser?.id) return
    if (selectedChat.id === lastChatId) return // Already saved

    const saveLastChat = async () => {
      try {
        await authFetch('/api/users/preferences/last-core-chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: selectedChat.id }),
        })
        setLastChatId(selectedChat.id)
      } catch (err) {
        console.error('[CoreSystemWorkspace] Failed to save last chat:', err)
      }
    }

    saveLastChat()
  }, [selectedChat?.id, dbUser?.id, lastChatId])

  return (
    <div className="h-full flex flex-col bg-[rgba(0,0,0,0.2)]">
      <div className="flex-1 overflow-hidden">
        <CoreSystemChatList
          chats={chats}
          selectedChat={selectedChat}
          onSelectChat={onSelectChat}
          onCreateChat={onCreateChat}
          onDeleteChat={onDeleteChat}
          onForkChat={onForkChat}
          onRenameChat={onRenameChat}
          toast={toast}
        />
      </div>
    </div>
  )
}
