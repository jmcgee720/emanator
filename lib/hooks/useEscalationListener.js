/**
 * useEscalationListener
 * 
 * Listens for active escalation chats via Supabase Realtime.
 * Returns the current active escalation (if any) and loading state.
 */

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useEscalationListener(userId) {
  const [activeEscalation, setActiveEscalation] = useState(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }

    // Initial fetch of active escalations
    async function fetchActiveEscalation() {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', userId)
        .is('project_id', null) // Core System chats
        .not('metadata->is_escalation', 'is', null)
        .is('metadata->resolved', null) // Not resolved yet
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('[useEscalationListener] Error fetching escalation:', error)
      } else {
        setActiveEscalation(data)
      }
      setLoading(false)
    }

    fetchActiveEscalation()

    // Subscribe to new escalations
    const channel = supabase
      .channel('escalations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chats',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const chat = payload.new
          // Check if it's an escalation chat
          if (
            chat &&
            chat.project_id === null &&
            chat.metadata?.is_escalation === true &&
            !chat.metadata?.resolved
          ) {
            console.log('[useEscalationListener] New escalation detected:', chat.id)
            setActiveEscalation(chat)
          }
          // If an escalation was resolved, clear it
          if (
            payload.eventType === 'UPDATE' &&
            chat?.metadata?.resolved === true &&
            activeEscalation?.id === chat.id
          ) {
            console.log('[useEscalationListener] Escalation resolved:', chat.id)
            setActiveEscalation(null)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, supabase])

  return { activeEscalation, loading }
}
