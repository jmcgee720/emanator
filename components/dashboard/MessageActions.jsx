'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Pencil, BookmarkPlus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function MessageActions({ message, onRegenerate, onEditPrompt, collapsed, onToggleCollapse, onSavePrompt }) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const { toast } = useToast()

  const handleCopy = async () => {
    // Grab full visible text from the rendered message bubble (includes PlanCard, DiffReview, etc.)
    let text = ''
    const msgEl = document.querySelector(`[data-testid="message-${message.id}"]`)
    if (msgEl) {
      // The content bubble is the rounded-2xl div inside the message
      const bubble = msgEl.querySelector('.rounded-2xl')
      if (bubble) {
        text = bubble.innerText || ''
        // Strip trailing PlanCard/DiffReview button labels
        text = text.replace(/\n(Execute Plan|Revise|Cancel|Apply Changes|Reject|Approve All|Discard)(\n|$)/g, '\n').trim()
      }
    }
    if (!text) text = message.content || ''

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API blocked (iframe/permissions policy) — textarea fallback
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        toast({ title: 'Copy not available in this embedded preview. Open in a standalone tab to copy.', variant: 'destructive' })
        return
      }
    }
    setCopied(true)
    toast({ title: 'Copied to clipboard' })
    setTimeout(() => setCopied(false), 2000)
  }

  const handleFeedback = (type) => {
    setFeedback(type)
    toast({ title: type === 'up' ? 'Thanks for the feedback!' : 'Noted. Will try to improve.' })
  }

  return (
    <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150" data-testid="message-actions">
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
        onClick={handleCopy}
        title="Copy message"
        data-testid="copy-message-btn"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </Button>

      {message.role === 'assistant' && onRegenerate && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
          onClick={() => onRegenerate(message)}
          title="Regenerate response"
          data-testid="regenerate-btn"
        >
          <RefreshCw className="w-3 h-3" />
        </Button>
      )}

      {message.role === 'user' && onEditPrompt && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
          onClick={() => onEditPrompt(message)}
          title="Edit prompt"
          data-testid="edit-prompt-btn"
        >
          <Pencil className="w-3 h-3" />
        </Button>
      )}

      {message.role === 'assistant' && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className={`h-6 w-6 p-0 ${feedback === 'up' ? 'text-green-500 opacity-100' : 'text-muted-foreground/50 hover:text-foreground'}`}
            onClick={() => handleFeedback('up')}
            title="Good response"
            data-testid="thumbs-up-btn"
          >
            <ThumbsUp className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-6 w-6 p-0 ${feedback === 'down' ? 'text-red-500 opacity-100' : 'text-muted-foreground/50 hover:text-foreground'}`}
            onClick={() => handleFeedback('down')}
            title="Needs improvement"
            data-testid="thumbs-down-btn"
          >
            <ThumbsDown className="w-3 h-3" />
          </Button>
        </>
      )}

      {message.role === 'user' && onSavePrompt && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
          onClick={() => onSavePrompt(message.content, { message_id: message.id, intent: message.metadata?.intent })}
          title="Save to Prompt Library"
          data-testid="save-to-library-btn"
        >
          <BookmarkPlus className="w-3 h-3" />
        </Button>
      )}

      {message.role === 'assistant' && message.content?.length > 300 && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand' : 'Collapse'}
          data-testid="collapse-btn"
        >
          {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </Button>
      )}
    </div>
  )
}
