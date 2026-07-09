'use client'

/**
 * EscalationChatPanel
 * 
 * Sliding panel that shows the escalation chat.
 * User can read messages from both agents and send their own messages.
 */

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function EscalationChatPanel({ escalationChat, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef(null)
  const supabase = createClient()

  // Fetch messages
  useEffect(() => {
    async function fetchMessages() {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', escalationChat.id)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('[EscalationChatPanel] Error fetching messages:', error)
      } else {
        setMessages(data || [])
      }
      setLoading(false)
    }

    fetchMessages()

    // Subscribe to new messages
    const channel = supabase
      .channel(`escalation-messages-${escalationChat.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${escalationChat.id}`,
        },
        (payload) => {
          console.log('[EscalationChatPanel] New message:', payload.new)
          setMessages((prev) => [...prev, payload.new])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [escalationChat.id, supabase])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Send message
  async function handleSend() {
    if (!input.trim() || sending) return

    setSending(true)
    try {
      const response = await fetch(`/api/chats/${escalationChat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: input.trim(),
          role: 'user',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      setInput('')
    } catch (error) {
      console.error('[EscalationChatPanel] Error sending message:', error)
      if (typeof window !== 'undefined') {
        window.alert('Failed to send message. Please try again.')
      }
    } finally {
      setSending(false)
    }
  }

  // Exit escalation
  async function handleExit() {
    if (typeof window !== 'undefined' && !window.confirm('Are you sure you want to exit this escalation? The agents will stop collaborating.')) {
      return
    }

    try {
      const response = await fetch(`/api/escalations/${escalationChat.id}/exit`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to exit escalation')
      }

      onClose()
    } catch (error) {
      console.error('[EscalationChatPanel] Error exiting escalation:', error)
      if (typeof window !== 'undefined') {
        window.alert('Failed to exit escalation. Please try again.')
      }
    }
  }

  const source = escalationChat.metadata?.escalation_source

  return (
    <div className="fixed bottom-24 right-6 z-50 w-96 h-[600px] bg-white dark:bg-gray-900 rounded-lg shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
          <h3 className="font-semibold text-white">Agent Collaboration</h3>
        </div>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Task description */}
      {source && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 text-sm">
          <p className="font-medium text-blue-900 dark:text-blue-100">Task:</p>
          <p className="text-blue-700 dark:text-blue-300 mt-1">{source.task}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            No messages yet
          </div>
        ) : (
          messages.map((msg) => {
            const agentSource = msg.metadata?.agent_source
            const isUser = msg.role === 'user'
            const isSystem = msg.metadata?.system_message

            return (
              <div key={msg.id} className="space-y-1">
                {/* Agent label */}
                {!isUser && !isSystem && agentSource && (
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        agentSource === 'project_agent'
                          ? 'bg-green-500'
                          : agentSource === 'core_system'
                          ? 'bg-purple-500'
                          : 'bg-gray-500'
                      }`}
                    />
                    {agentSource === 'project_agent'
                      ? 'Project Agent'
                      : agentSource === 'core_system'
                      ? 'Core System'
                      : 'System'}
                  </div>
                )}

                {/* Message bubble */}
                <MessageBubble message={msg} />
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Jump in and send a message..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white text-sm"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>

        {/* Exit button */}
        <button
          onClick={handleExit}
          className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
        >
          Exit Escalation
        </button>
      </div>
    </div>
  )
}
