'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GitBranch, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

/**
 * Fork Button Component
 * 
 * Displays when a conversation is approaching context limits.
 * Creates a new chat with a summary of the parent conversation.
 */
export default function ForkButton({ 
  chatId, 
  projectId,
  onForked,
  variant = 'default',
  size = 'default',
  className = '',
  showIcon = true,
  children = 'Fork Conversation'
}) {
  const [forking, setForking] = useState(false)
  const { toast } = useToast()

  const handleFork = async () => {
    if (!chatId || forking) return
    
    setForking(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Fork failed' }))
        throw new Error(error.error || error.details || 'Failed to fork chat')
      }

      const forkedChat = await res.json()
      
      toast({
        title: 'Chat Forked',
        description: `Created "${forkedChat.title}" — opening now...`,
      })

      // Navigate to the forked chat
      if (onForked) {
        onForked(forkedChat)
      } else {
        // Default navigation
        const url = projectId 
          ? `/dashboard?project=${projectId}&chat=${forkedChat.id}`
          : `/dashboard?chat=${forkedChat.id}`
        window.location.href = url
      }
    } catch (err) {
      console.error('[ForkButton] Fork failed:', err)
      toast({
        title: 'Fork Failed',
        description: err.message || 'Could not create forked chat',
        variant: 'destructive',
      })
    } finally {
      setForking(false)
    }
  }

  return (
    <Button
      onClick={handleFork}
      disabled={forking}
      variant={variant}
      size={size}
      className={className}
      data-testid="fork-button"
    >
      {forking ? (
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
      ) : showIcon ? (
        <GitBranch className="w-4 h-4 mr-2" />
      ) : null}
      {forking ? 'Forking...' : children}
    </Button>
  )
}
