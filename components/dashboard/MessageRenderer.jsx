'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

function CodeBlock({ children, className }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || 'text'
  const code = String(children).replace(/\n$/, '')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        return
      }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-3 rounded-lg border border-border overflow-hidden bg-zinc-950" data-testid="code-block">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-border">
        <span className="text-xs font-mono text-zinc-400">{language}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200"
          onClick={handleCopy}
          data-testid="copy-code-btn"
        >
          {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="overflow-x-auto p-4">
        <pre className="text-sm font-mono text-zinc-200 whitespace-pre leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

function InlineCode({ children }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono text-primary">
      {children}
    </code>
  )
}

export default function MessageRenderer({ content, hideCodeBlocks }) {
  if (!content) return null

  // Check for inline Apply to Live button marker
  const hasApplyButton = content.includes('{{APPLY_TO_LIVE_BUTTON}}')
  const parts = hasApplyButton ? content.split('{{APPLY_TO_LIVE_BUTTON}}') : [content]

  return (
    <>
      {parts.map((part, idx) => (
        <MessagePart key={idx} content={part} hideCodeBlocks={hideCodeBlocks} />
      ))}
      {hasApplyButton && (
        <div className="mt-3 mb-1">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('inline_apply_to_live'))}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30
              hover:shadow-emerald-800/40 active:scale-[0.97]"
            data-testid="inline-apply-to-live-btn"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Apply to Live
          </button>
        </div>
      )}
    </>
  )
}

function MessagePart({ content, hideCodeBlocks }) {
  if (!content?.trim()) return null
  if (!content) return null

  // Strip code blocks from AI responses.
  // The AI should communicate through conversation and tool calls, not by dumping code/JSON.
  let displayContent = content
    .replace(/```json[\s\S]*?```/g, '')    // always strip JSON blocks (plan dumps)
    .replace(/```[\s\S]*?```/g, '')        // strip all fenced code blocks
    .replace(/\n{3,}/g, '\n\n')            // collapse excess newlines
    .trim()

  // If stripping removed everything, show a clean fallback
  if (!displayContent) {
    displayContent = 'Building your project...'
  }

  return (
    <div className="em-prose max-w-full min-w-0 break-words [overflow-wrap:anywhere]" data-testid="message-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            if (inline) {
              return <InlineCode>{children}</InlineCode>
            }
            // Never render code blocks in AI chat — the user doesn't want to see code.
            // Render as plain text paragraph instead.
            const text = String(children).replace(/\n$/, '')
            if (!text || text.length < 3) return null
            return <span className="text-[13.5px] text-foreground/70">{text}</span>
          },
          h1: ({ children }) => <h1 className="text-lg font-semibold mt-3 mb-1.5 text-foreground break-words">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-2.5 mb-1.5 text-foreground break-words">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground break-words">{children}</h3>,
          p: ({ children }) => {
            const hasBlock =
              Array.isArray(children) &&
              children.some(
                (child) =>
                  child?.type === 'div' ||
                  child?.type === 'pre' ||
                  child?.props?.node?.tagName === 'pre'
              )

            if (hasBlock) {
              return <>{children}</>
            }

            return (
              <p className="mb-1.5 leading-[1.65] text-[13.5px] text-foreground/90 break-words">
                {children}
              </p>
            )
          },
          ul: ({ children }) => <ul className="list-disc pl-5 mb-1.5 space-y-0.5 text-[13.5px]">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-1.5 space-y-0.5 text-[13.5px]">{children}</ol>,
          li: ({ children }) => <li className="text-foreground/90 break-words leading-[1.6]">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80 break-all">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => <th className="px-2.5 py-1.5 text-left font-medium text-foreground text-xs border-b border-border">{children}</th>,
          td: ({ children }) => <td className="px-2.5 py-1.5 text-foreground/90 text-xs border-b border-border/50">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic text-[13px]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border/50" />,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  )
}
