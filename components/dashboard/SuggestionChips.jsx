'use client'

import { Sparkles } from 'lucide-react'

/**
 * SuggestionChips — renders AI-generated enhancement suggestions
 * as clickable chips that auto-send as new prompts.
 */

/**
 * Parse [NEXT_STEPS]...[/NEXT_STEPS] block from message content.
 * Returns { cleanContent, suggestions[] }
 */
export function parseSuggestions(content) {
  if (!content) return { cleanContent: content || '', suggestions: [] }

  const regex = /\[NEXT_STEPS\]([\s\S]*?)\[\/NEXT_STEPS\]/
  const match = content.match(regex)

  if (!match) return { cleanContent: content, suggestions: [] }

  const raw = match[1].trim()
  const suggestions = raw
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 200)
    .slice(0, 3)

  const cleanContent = content.replace(regex, '').trimEnd()

  return { cleanContent, suggestions }
}

export default function SuggestionChips({ suggestions, onSend, disabled }) {
  if (!suggestions || suggestions.length === 0) return null

  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid="suggestion-chips">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-amber-400/80" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--em-text-muted)]">
          Ideas to try next
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSend?.(suggestion)}
            disabled={disabled}
            className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] leading-tight text-[var(--em-text-secondary)] bg-[rgba(0,229,255,0.04)] border border-[rgba(0,229,255,0.10)] hover:bg-[rgba(0,229,255,0.10)] hover:border-[rgba(0,229,255,0.25)] hover:text-[var(--em-text-primary)] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            data-testid={`suggestion-chip-${i}`}
          >
            <span className="text-[var(--em-cyan)] opacity-50 group-hover:opacity-100 transition-opacity">+</span>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
