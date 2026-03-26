'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Brain, Zap, X, ArrowRight } from 'lucide-react'

const MODEL_INFO = {
  'gpt-4o': {
    provider: 'OpenAI', icon: Zap, color: 'from-green-900/40 to-zinc-900',
    strengths: ['Fast multi-modal reasoning', 'Excellent tool calling', 'Great at code generation']
  },
  'claude-sonnet-4-6': {
    provider: 'Anthropic', icon: Brain, color: 'from-amber-900/40 to-zinc-900',
    strengths: ['Excellent balance of speed and quality', 'Strong code generation', 'Nuanced understanding']
  },
  'claude-opus-4-6': {
    provider: 'Anthropic', icon: Brain, color: 'from-purple-900/40 to-zinc-900',
    strengths: ['Deepest analysis capability', 'Best for complex problems', 'Extended thinking support']
  },
  'claude-haiku-4-5': {
    provider: 'Anthropic', icon: Brain, color: 'from-teal-900/40 to-zinc-900',
    strengths: ['Ultra-fast responses', 'Cost-effective', 'Great for quick iterations']
  },
}

export default function ModelAnnouncementCard({ modelId, onUseModel, onDismiss }) {
  const info = MODEL_INFO[modelId]
  if (!info) return null

  const Icon = info.icon
  const modelName = modelId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div className={`relative rounded-xl border border-border/60 bg-gradient-to-br ${info.color} p-5 overflow-hidden`}
      data-testid={`model-card-${modelId}`}
    >
      <button onClick={onDismiss} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-background/20 flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">{modelName}</p>
          <p className="text-[10px] text-muted-foreground">{info.provider}</p>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        {info.strengths.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-foreground/80">
            <div className="w-1 h-1 rounded-full bg-primary" />
            {s}
          </div>
        ))}
      </div>

      <Button size="sm" onClick={onUseModel} className="w-full gap-2" data-testid={`use-model-${modelId}`}>
        Use this model <ArrowRight className="w-3 h-3" />
      </Button>
    </div>
  )
}
