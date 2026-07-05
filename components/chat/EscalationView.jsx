'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * EscalationView — Minimal UI for agent-to-agent collaboration.
 * 
 * Shows:
 *   • Banner explaining what's happening
 *   • "Exit Escalation" button
 *   • Link back to source project chat
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-purple-600 mb-4">
            🤝 Agent Collaboration Mode
          </h1>
          <p className="text-gray-700 mb-4">
            Your project agent escalated a task to Core System. Both agents are working together in the dashboard to implement the missing capability.
          </p>
          {source?.task && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-purple-900">
                <strong>Task:</strong> {source.task}
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleExit}
            disabled={exiting}
            className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exiting ? 'Exiting…' : 'Exit Escalation & Return to Project'}
          </button>

          <a
            href={`/project/${sourceChat.project_id}`}
            className="block w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors text-center"
          >
            View Source Project Chat
          </a>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-600 text-center">
            The agents are collaborating in your main dashboard. You can watch their progress there, or wait here until they're done.
          </p>
        </div>
      </div>
    </div>
  )
}
