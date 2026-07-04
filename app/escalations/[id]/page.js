'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import EscalationView from '@/components/chat/EscalationView'

export default function EscalationPage() {
  const params = useParams()
  const router = useRouter()
  const escalationChatId = params.id

  const [escalationChat, setEscalationChat] = useState(null)
  const [sourceChat, setSourceChat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadEscalation() {
      try {
        // Fetch escalation chat
        const escalationRes = await fetch(`/api/chats/${escalationChatId}`)
        if (!escalationRes.ok) {
          throw new Error('Escalation chat not found')
        }
        const escalation = await escalationRes.json()

        // Verify it's an escalation chat
        if (!escalation.metadata?.is_escalation) {
          throw new Error('This is not an escalation chat')
        }

        const sourceChatId = escalation.metadata?.escalation_source?.chat_id
        if (!sourceChatId) {
          throw new Error('Escalation source metadata missing')
        }

        // Fetch source chat
        const sourceRes = await fetch(`/api/chats/${sourceChatId}`)
        if (!sourceRes.ok) {
          throw new Error('Source chat not found')
        }
        const source = await sourceRes.json()

        setEscalationChat(escalation)
        setSourceChat(source)
      } catch (err) {
        console.error('[EscalationPage] load failed:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    if (escalationChatId) {
      loadEscalation()
    }
  }, [escalationChatId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading escalation…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="max-w-md p-6 bg-white rounded-lg shadow-md">
          <h1 className="text-xl font-semibold text-red-600 mb-2">Error</h1>
          <p className="text-gray-700 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <EscalationView
      escalationChat={escalationChat}
      sourceChat={sourceChat}
    />
  )
}
