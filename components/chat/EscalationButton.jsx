'use client'

/**
 * EscalationButton
 * 
 * Floating button in bottom-right corner that:
 *   - Always visible (never hidden)
 *   - Inactive (grey) when no escalation
 *   - Pulsing (blue) when escalation is active
 *   - Opens EscalationChatPanel when clicked
 */

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEscalationListener } from '@/lib/hooks/useEscalationListener'
import EscalationChatPanel from './EscalationChatPanel'

export default function EscalationButton() {
  const [userId, setUserId] = useState(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id))
  }, [supabase])

  const { activeEscalation, loading } = useEscalationListener(userId)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  // Debug logging
  useEffect(() => {
    console.log('[EscalationButton] State:', {
      userId: userId?.substring(0, 8),
      activeEscalation: activeEscalation?.id?.substring(0, 8),
      loading,
      isPanelOpen,
      metadata: activeEscalation?.metadata
    })
  }, [userId, activeEscalation, loading, isPanelOpen])

  // Auto-open if escalation has auto_open flag
  useEffect(() => {
    if (activeEscalation?.metadata?.auto_open && !isPanelOpen) {
      console.log('[EscalationButton] Auto-opening panel for escalation:', activeEscalation.id)
      setIsPanelOpen(true)
    }
  }, [activeEscalation, isPanelOpen])

  const isActive = !!activeEscalation

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className={`
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-full
          flex items-center justify-center
          shadow-lg transition-all duration-300
          ${isActive 
            ? 'bg-blue-600 hover:bg-blue-700 animate-pulse' 
            : 'bg-gray-400 hover:bg-gray-500 cursor-default opacity-50'
          }
          ${isPanelOpen ? 'scale-90' : 'scale-100'}
        `}
        title={isActive ? 'Agent collaboration active — click to open' : 'No active escalation'}
      >
        {/* Icon: two chat bubbles overlapping */}
        <svg
          className="w-7 h-7 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
          {isActive && (
            <circle
              cx="18"
              cy="6"
              r="3"
              fill="currentColor"
              className="text-green-400"
            />
          )}
        </svg>

        {/* Badge for unread count (future enhancement) */}
        {isActive && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-400 rounded-full flex items-center justify-center text-xs font-bold text-white">
            !
          </span>
        )}
      </button>

      {/* Chat panel */}
      {isPanelOpen && activeEscalation && (
        <EscalationChatPanel
          escalationChat={activeEscalation}
          onClose={() => setIsPanelOpen(false)}
        />
      )}
    </>
  )
}
