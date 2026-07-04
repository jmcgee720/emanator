'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ChatInterface from './ChatInterface'

/**
 * EscalationView — Split-screen UI for agent-to-agent collaboration.
 * 
 * Shows:
 *   • Left: Source project chat (read-only during escalation)
 *   • Right: Escalation chat (Core System + project agent collaborate)
 *   • Top: Banner explaining what's happening + "Exit Escalation" button
 * 
 * When user clicks "Exit Escalation":
 *   • Calls /api/escalations/:id/exit
 *   • Posts summary to source project chat
 *   • Redirects back to source project chat
 */
export default function EscalationView({ escalationChat, sourceChat }) {
  const router = useRouter()
  const [exiting, setExiting] = useState(false)
  const [error, setError] = useState(null)

  const handleExit = async () => {
    setExiting(true)
    setError(null)

    try {
      const res = await fetch(`/api/escalations/${escalationChat.id}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const { sourceChatId } = await res.json()
      
      // Redirect back to source project chat
      router.push(`/chats/${sourceChatId}`)
    } catch (err) {
      console.error('[EscalationView] exit failed:', err)
      setError(err.message)
      setExiting(false)
    }
  }

  const source = escalationChat?.metadata?.escalation_source

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Banner */}
      <div className="bg-purple-600 text-white px-6 py-4 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">
              🤝 Agent Collaboration Mode
            </h1>
            <p className="text-sm text-purple-100 mt-1">
              Project agent escalated a task to Core System. Both agents are working together to implement the missing capability.
            </p>
            {source?.task && (
              <p className="text-xs text-purple-200 mt-2">
                <strong>Task:</strong> {source.task}
              </p>
            )}
          </div>
          <button
            onClick={handleExit}
            disabled={exiting}
            className="px-4 py-2 bg-white text-purple-600 rounded-lg font-medium hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exiting ? 'Exiting…' : 'Exit Escalation'}
          </button>
        </div>
        {error && (
          <div className="max-w-7xl mx-auto mt-3 p-3 bg-red-500 text-white rounded-lg text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

      {/* Split view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Source project chat (read-only) */}
        <div className="w-1/2 border-r border-gray-300 flex flex-col bg-white">
          <div className="px-6 py-3 bg-gray-100 border-b border-gray-300">
            <h2 className="text-sm font-semibold text-gray-700">
              📁 Source Project Chat
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Read-only while escalation is active
            </p>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatInterface
              chatId={sourceChat.id}
              projectId={sourceChat.project_id}
              readOnly={true}
            />
          </div>
        </div>

        {/* Right: Escalation chat (active) */}
        <div className="w-1/2 flex flex-col bg-white">
          <div className="px-6 py-3 bg-purple-50 border-b border-purple-200">
            <h2 className="text-sm font-semibold text-purple-700">
              ⚙️ Core System Escalation
            </h2>
            <p className="text-xs text-purple-600 mt-1">
              Project agent + Core System working together
            </p>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatInterface
              chatId={escalationChat.id}
              projectId={null}
              readOnly={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
