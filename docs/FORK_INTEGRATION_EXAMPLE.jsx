/**
 * Fork Warning Integration Example
 * 
 * This file shows how to integrate fork warnings into an existing chat interface.
 * Copy the relevant sections into your LeftPanel.jsx, Dashboard.jsx, or similar component.
 */

import { useState, useEffect, useRef } from 'react'
import { useForkWarning } from '@/hooks/useForkWarning'
import ForkWarningBanner from '@/components/dashboard/ForkWarningBanner'

export default function ChatInterfaceExample({ chatId, projectId }) {
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  
  // ── STEP 1: Add fork warning hook ──
  const { forkWarning, setForkWarning, clearForkWarning } = useForkWarning()
  
  // ── STEP 2: Handle SSE events in your existing stream handler ──
  const handleSendMessage = async (content, attachments) => {
    setStreaming(true)
    
    try {
      const response = await fetch(`/api/chats/${chatId}/messages/stream-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          metadata: { attachments },
        }),
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue
          
          const eventMatch = line.match(/^event: (.+)/)
          const dataMatch = line.match(/^data: (.+)/)
          
          if (eventMatch && dataMatch) {
            const event = eventMatch[1]
            const data = JSON.parse(dataMatch[1])
            
            // ── STEP 2A: Handle fork_suggested event ──
            if (event === 'fork_suggested') {
              setForkWarning({
                severity: 'warning',
                tokensUsed: data.tokensUsed,
                limit: data.limit,
                percentage: data.percentage,
                message: data.message,
              })
            }
            
            // ── STEP 2B: Handle fork_required event ──
            if (event === 'fork_required') {
              setForkWarning({
                severity: 'critical',
                tokensUsed: data.tokensUsed,
                limit: data.limit,
                percentage: data.percentage,
                message: data.message,
              })
              // Note: The backend blocks the request at this point,
              // so the user MUST fork before continuing
            }
            
            // Handle other events (token, done, error, etc.)
            if (event === 'token') {
              // Append to current message
            }
            if (event === 'done') {
              // Finalize message
            }
            // ... other event handlers
          }
        }
      }
    } catch (err) {
      console.error('Stream error:', err)
    } finally {
      setStreaming(false)
    }
  }

  // ── STEP 3: Render fork warning banner above messages ──
  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="border-b p-4">
        <h2>Chat: {chatId}</h2>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* ── STEP 3A: Fork warning banner (sticky at top) ── */}
        {forkWarning && (
          <div className="sticky top-0 z-10 mb-4">
            <ForkWarningBanner
              severity={forkWarning.severity}
              tokensUsed={forkWarning.tokensUsed}
              limit={forkWarning.limit}
              percentage={forkWarning.percentage}
              message={forkWarning.message}
              chatId={chatId}
              projectId={projectId}
              onForked={(forkedChat) => {
                // Navigate to forked chat
                window.location.href = `/dashboard?project=${projectId}&chat=${forkedChat.id}`
                // Or use your router: router.push(...)
                // Or call a parent handler: onChatChange(forkedChat.id)
              }}
            />
          </div>
        )}

        {/* Existing messages */}
        {messages.map((msg) => (
          <div key={msg.id} className="mb-4">
            {/* Your message rendering logic */}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t p-4">
        {/* Your existing ChatComposer or input area */}
      </div>
    </div>
  )
}

/**
 * ALTERNATIVE: If you already have an SSE event handler elsewhere
 * 
 * You can extract the fork warning logic into a separate effect:
 */
export function ChatInterfaceWithExistingSSE({ chatId, projectId, sseEvents }) {
  const { forkWarning, setForkWarning, clearForkWarning } = useForkWarning()
  
  // Listen to SSE events from parent component
  useEffect(() => {
    if (!sseEvents) return
    
    const handleEvent = (event, data) => {
      if (event === 'fork_suggested') {
        setForkWarning({
          severity: 'warning',
          tokensUsed: data.tokensUsed,
          limit: data.limit,
          percentage: data.percentage,
          message: data.message,
        })
      }
      
      if (event === 'fork_required') {
        setForkWarning({
          severity: 'critical',
          tokensUsed: data.tokensUsed,
          limit: data.limit,
          percentage: data.percentage,
          message: data.message,
        })
      }
    }
    
    // Subscribe to parent's SSE event emitter
    sseEvents.on('message', handleEvent)
    return () => sseEvents.off('message', handleEvent)
  }, [sseEvents, setForkWarning])
  
  // ... rest of component
}

/**
 * MINIMAL INTEGRATION (if you just want to add the banner)
 * 
 * If your chat interface already handles SSE events but doesn't show fork warnings:
 */
export function MinimalForkIntegration({ chatId, projectId, onSSEEvent }) {
  const { forkWarning, setForkWarning } = useForkWarning()
  
  // Wrap your existing SSE handler
  const wrappedSSEHandler = (event, data) => {
    // Call your existing handler first
    onSSEEvent?.(event, data)
    
    // Then check for fork events
    if (event === 'fork_suggested' || event === 'fork_required') {
      setForkWarning({
        severity: event === 'fork_required' ? 'critical' : 'warning',
        ...data,
      })
    }
  }
  
  return (
    <>
      {forkWarning && (
        <ForkWarningBanner
          {...forkWarning}
          chatId={chatId}
          projectId={projectId}
          onForked={(chat) => window.location.href = `/dashboard?chat=${chat.id}`}
        />
      )}
      {/* Your existing chat UI */}
    </>
  )
}
