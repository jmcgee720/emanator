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

  // Strip code blocks when the message is from a direct-edit / tool-call flow.
  // The AI should never show code, JSON, or file contents to the user — only plain text.
  let displayContent = content
  if (hideCodeBlocks) {
    displayContent = content
      .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
      .replace(/\n{3,}/g, '\n\n')       // collapse excess newlines left behind
      .trim()
  }

  return (
    <div className="prose prose-invert prose-sm max-w-full min-w-0 break-words [overflow-wrap:anywhere]" data-testid="message-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            if (inline) {
              return <InlineCode>{children}</InlineCode>
            }
            return <CodeBlock className={className}>{children}</CodeBlock>
          },
          h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-foreground break-words">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-semibold mt-3 mb-2 text-foreground break-words">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1 text-foreground break-words">{children}</h3>,
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
              <p className="mb-2 leading-relaxed text-foreground/90 break-words">
                {children}
              </p>
            )
          },
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-foreground/90 break-words">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80 break-all">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-border">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-2 text-left font-medium text-foreground border-b border-border">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-foreground/90 border-b border-border/50">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 pl-4 my-2 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  )
}
