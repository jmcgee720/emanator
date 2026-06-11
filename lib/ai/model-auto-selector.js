/**
 * Smart Model Auto-Selector
 * 
 * Analyzes user prompts and automatically recommends the most cost-effective
 * model tier based on task complexity. Helps users save credits by routing
 * simple edits to fast/cheap models and complex work to premium models.
 * 
 * Tiers:
 *   - FAST (0.25-0.3 cr): Quick edits, simple changes, typo fixes
 *   - BALANCED (1.0-1.25 cr): Standard builds, moderate complexity
 *   - POWERFUL (2.5 cr): Complex refactors, large features
 *   - ULTRA (5.0 cr): Autonomous migrations, multi-file orchestration
 */

// Model tier definitions (sync with MODEL_COSTS in lib/credits/service.js)
export const MODEL_TIERS = {
  FAST: {
    label: 'Fast',
    credits: 0.25,
    models: {
      anthropic: 'claude-haiku-4-5-20251001',
      openai: 'gpt-4o-mini',
      gemini: 'gemini-2.5-flash',
    },
    description: 'Quick edits, simple changes',
  },
  BALANCED: {
    label: 'Balanced',
    credits: 1.25,
    models: {
      anthropic: 'claude-sonnet-4-5-20250929',
      openai: 'gpt-4o',
      gemini: 'gemini-2.5-pro',
    },
    description: 'Standard builds, moderate complexity',
  },
  POWERFUL: {
    label: 'Powerful',
    credits: 2.5,
    models: {
      anthropic: 'claude-opus-4-5-20251101',
      openai: 'o3',
      gemini: 'gemini-2.5-pro', // Gemini doesn't have a premium tier yet
    },
    description: 'Complex refactors, large features',
  },
  ULTRA: {
    label: 'Ultra',
    credits: 5.0,
    models: {
      anthropic: 'claude-fable-5',
      openai: 'gpt-5.2',
      gemini: 'gemini-2.5-pro', // Gemini doesn't have an ultra tier yet
    },
    description: 'Autonomous migrations, multi-file orchestration',
  },
}

// Complexity signals — keywords/patterns that indicate task difficulty
const COMPLEXITY_SIGNALS = {
  // ULTRA tier signals (5.0 credits)
  ULTRA: [
    /\b(migrate|migration|refactor\s+entire|rewrite\s+all|convert\s+all)\b/i,
    /\b(multi[- ]file|across\s+\d+\s+files|touch\s+\d+\s+files)\b/i,
    /\b(architecture|redesign|restructure|overhaul)\b/i,
    /\b(autonomous|self[- ]contained|end[- ]to[- ]end)\b/i,
    /\b(complex\s+(logic|algorithm|system))\b/i,
  ],
  
  // POWERFUL tier signals (2.5 credits)
  POWERFUL: [
    /\b(refactor|redesign|rebuild|reimplement)\b/i,
    /\b(add\s+(authentication|auth|payment|stripe|database|api))\b/i,
    /\b(integrate|integration|connect\s+to)\b/i,
    /\b(optimize|performance|scale)\b/i,
    /\b(complex|advanced|sophisticated)\b/i,
    /\b(multiple\s+(components|features|pages))\b/i,
  ],
  
  // FAST tier signals (0.25-0.3 credits)
  FAST: [
    /\b(fix\s+(typo|bug|error)|quick\s+fix)\b/i,
    /\b(change\s+(color|text|style|css))\b/i,
    /\b(update\s+(label|title|heading|button\s+text))\b/i,
    /\b(add\s+(padding|margin|border))\b/i,
    /\b(simple|small|minor|quick)\b/i,
    /\b(just|only)\b/i,
  ],
}

// Length thresholds (characters)
const LENGTH_THRESHOLDS = {
  SHORT: 100,   // < 100 chars → likely simple
  MEDIUM: 300,  // 100-300 chars → moderate
  LONG: 600,    // > 600 chars → complex
}

/**
 * Analyze a user prompt and recommend a model tier.
 * @param {string} prompt - The user's message
 * @param {object} context - Optional context (e.g., { isInitialBuild: true })
 * @returns {{ tier: string, confidence: number, reason: string, model: string }}
 */
export function analyzePromptComplexity(prompt, context = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return {
      tier: 'BALANCED',
      confidence: 0.5,
      reason: 'No prompt provided — defaulting to balanced tier',
      model: MODEL_TIERS.BALANCED.models.anthropic,
    }
  }

  const text = prompt.trim()
  const length = text.length
  let score = 0
  const reasons = []

  // 1. Check for explicit complexity signals
  for (const pattern of COMPLEXITY_SIGNALS.ULTRA) {
    if (pattern.test(text)) {
      score += 10
      reasons.push('Ultra-complexity keyword detected')
      break
    }
  }
  
  for (const pattern of COMPLEXITY_SIGNALS.POWERFUL) {
    if (pattern.test(text)) {
      score += 5
      reasons.push('High-complexity keyword detected')
      break
    }
  }
  
  for (const pattern of COMPLEXITY_SIGNALS.FAST) {
    if (pattern.test(text)) {
      score -= 3
      reasons.push('Simple task keyword detected')
      break
    }
  }

  // 2. Length heuristic
  if (length < LENGTH_THRESHOLDS.SHORT) {
    score -= 2
    reasons.push('Short prompt (likely simple)')
  } else if (length > LENGTH_THRESHOLDS.LONG) {
    score += 3
    reasons.push('Long prompt (likely complex)')
  }

  // 3. Context signals
  if (context.isInitialBuild) {
    score += 2
    reasons.push('Initial build (needs stronger model)')
  }
  
  if (context.hasAttachments) {
    score += 1
    reasons.push('Attachments present (may need vision/analysis)')
  }

  // 4. Code block detection (multi-line code = more complex)
  const codeBlockCount = (text.match(/```/g) || []).length / 2
  if (codeBlockCount >= 2) {
    score += 2
    reasons.push('Multiple code blocks (complex request)')
  }

  // 5. File count mentions ("edit 5 files", "update all components")
  const fileCountMatch = text.match(/\b(\d+)\s+(files?|components?|pages?)\b/i)
  if (fileCountMatch) {
    const count = parseInt(fileCountMatch[1], 10)
    if (count >= 5) {
      score += 3
      reasons.push(`Multi-file operation (${count} files)`)
    } else if (count >= 2) {
      score += 1
      reasons.push(`Multiple files (${count})`)
    }
  }

  // 6. Determine tier from score
  let tier
  let confidence
  if (score >= 8) {
    tier = 'ULTRA'
    confidence = Math.min(0.95, 0.7 + (score - 8) * 0.05)
  } else if (score >= 4) {
    tier = 'POWERFUL'
    confidence = Math.min(0.9, 0.65 + (score - 4) * 0.05)
  } else if (score <= -2) {
    tier = 'FAST'
    confidence = Math.min(0.85, 0.6 + Math.abs(score + 2) * 0.05)
  } else {
    tier = 'BALANCED'
    confidence = 0.7
  }

  // Default to Anthropic (best for coding tasks)
  const provider = context.preferredProvider || 'anthropic'
  const model = MODEL_TIERS[tier].models[provider] || MODEL_TIERS[tier].models.anthropic

  return {
    tier,
    confidence,
    reason: reasons.join('; ') || 'Default heuristic',
    model,
    credits: MODEL_TIERS[tier].credits,
    description: MODEL_TIERS[tier].description,
  }
}

/**
 * Get a human-readable recommendation message.
 * @param {object} analysis - Result from analyzePromptComplexity
 * @returns {string}
 */
export function getRecommendationMessage(analysis) {
  const { tier, confidence, reason, credits, description } = analysis
  const confidencePercent = Math.round(confidence * 100)
  
  return `💡 **Auto-selected ${tier} tier** (${credits} credits)\n` +
         `${description}\n` +
         `Confidence: ${confidencePercent}% — ${reason}`
}

/**
 * Check if the user's selected model is significantly more expensive than
 * the recommended tier, and return a cost-saving suggestion if so.
 * @param {string} selectedModel - User's current model selection
 * @param {object} analysis - Result from analyzePromptComplexity
 * @returns {{ shouldSuggest: boolean, message?: string, savings?: number }}
 */
export function getCostSavingSuggestion(selectedModel, analysis) {
  // Find the selected model's cost
  let selectedCost = null
  for (const tier of Object.values(MODEL_TIERS)) {
    for (const model of Object.values(tier.models)) {
      if (model === selectedModel) {
        selectedCost = tier.credits
        break
      }
    }
    if (selectedCost !== null) break
  }

  if (selectedCost === null) {
    return { shouldSuggest: false }
  }

  const recommendedCost = analysis.credits
  const savings = selectedCost - recommendedCost

  // Only suggest if savings are significant (>= 1 credit)
  if (savings >= 1.0) {
    return {
      shouldSuggest: true,
      savings,
      message: `💰 **Save ${savings.toFixed(1)} credits per message**\n` +
               `Your current model costs ${selectedCost} credits, but this task looks like a good fit for the ${analysis.tier} tier (${recommendedCost} credits).\n` +
               `Switch to **${analysis.model}**?`,
    }
  }

  return { shouldSuggest: false }
}
