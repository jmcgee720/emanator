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
      console.log('[useEscalationListener] Fetching escalations for user:', userId)
      
      // Use a simpler query that works with JSONB
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', userId)
        .is('project_id', null) // Core System chats
        .order('created_at', { ascending: false })

      if (error) {
        console.error('[useEscalationListener] Error fetching escalation:', error)
        setLoading(false)
        return
      }
      
      // Filter in JS since JSONB queries are unreliable
      const escalations = (data || []).filter(chat => 
        chat.metadata?.is_escalation === true &&
        !chat.metadata?.resolved
      )
      
      console.log('[useEscalationListener] Found escalations:', escalations.length)
      if (escalations.length > 0) {
        console.log('[useEscalationListener] Active escalation:', escalations[0].id, escalations[0].metadata)
      }
      
      setActiveEscalation(escalations[0] || null)
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
  }, [userId]) // Remove supabase from deps to avoid re-subscribing

  return { activeEscalation, loading }
}
