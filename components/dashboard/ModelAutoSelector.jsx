'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, TrendingDown, Info } from 'lucide-react'
import { analyzePromptComplexity, getCostSavingSuggestion, MODEL_TIERS } from '@/lib/ai/model-auto-selector'

/**
 * ModelAutoSelector — Smart model recommendation UI
 * 
 * Shows inline suggestions when:
 *   1. Auto mode is enabled → recommends best model for the prompt
 *   2. User's selected model is overkill → suggests cheaper alternative
 * 
 * Props:
 *   - prompt: string — current user input
 *   - selectedModel: string — user's current model selection
 *   - selectedProvider: string — user's current provider
 *   - autoMode: boolean — whether auto-selection is enabled
 *   - onModelChange: (model: string) => void
 *   - onProviderChange: (provider: string) => void
 *   - context: object — optional context (isInitialBuild, hasAttachments)
 */
export default function ModelAutoSelector({
  prompt,
  selectedModel,
  selectedProvider,
  autoMode = false,
  onModelChange,
  onProviderChange,
  context = {},
}) {
  const [analysis, setAnalysis] = useState(null)
  const [costSuggestion, setCostSuggestion] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Reset dismissed state when prompt changes significantly
    setDismissed(false)
  }, [prompt])

  useEffect(() => {
    if (!prompt || prompt.trim().length < 10) {
      setAnalysis(null)
      setCostSuggestion(null)
      return
    }

    // Analyze prompt complexity
    const result = analyzePromptComplexity(prompt, {
      ...context,
      preferredProvider: selectedProvider,
    })
    setAnalysis(result)

    // Check if we should suggest a cheaper model
    if (!autoMode) {
      const suggestion = getCostSavingSuggestion(selectedModel, result)
      setCostSuggestion(suggestion.shouldSuggest ? suggestion : null)
    } else {
      setCostSuggestion(null)
    }
  }, [prompt, selectedModel, selectedProvider, autoMode, context])

  const handleAcceptRecommendation = () => {
    if (!analysis) return
    
    // Extract provider from the recommended model
    let targetProvider = selectedProvider
    for (const [provider, model] of Object.entries(MODEL_TIERS[analysis.tier].models)) {
      if (model === analysis.model) {
        targetProvider = provider
        break
      }
    }
    
    onProviderChange(targetProvider)
    onModelChange(analysis.model)
    setDismissed(true)
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  // Don't show anything if dismissed or no analysis
  if (dismissed || !analysis) return null

  // Auto mode: show recommendation
  if (autoMode && analysis.confidence >= 0.7) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20">
        <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-violet-300">Auto-selected model</span>
            <Badge variant="outline" className="text-[10px] text-violet-400 border-violet-400/30">
              {analysis.tier}
            </Badge>
            <span className="text-[10px] text-zinc-400">
              {analysis.credits} credits
            </span>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {analysis.description} — {analysis.reason}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="h-6 px-2 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          Dismiss
        </Button>
      </div>
    )
  }

  // Manual mode: show cost-saving suggestion if applicable
  if (!autoMode && costSuggestion) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
        <TrendingDown className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-emerald-300">Save credits</span>
            <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
              -{costSuggestion.savings.toFixed(1)} cr
            </Badge>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed mb-2">
            This task looks like a good fit for <strong className="text-zinc-300">{analysis.tier}</strong> tier ({analysis.credits} credits).
            Your current model costs {costSuggestion.savings + analysis.credits} credits.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAcceptRecommendation}
              className="h-7 px-3 text-xs border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
            >
              Switch to {analysis.model.split('-')[1]?.toUpperCase() || 'recommended'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="h-7 px-2 text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Keep current
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Low-confidence recommendation: show info badge only
  if (autoMode && analysis.confidence < 0.7) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        <Info className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[11px] text-zinc-500">
          Auto-selection uncertain — using {analysis.tier} tier ({analysis.credits} cr)
        </span>
      </div>
    )
  }

  return null
}
