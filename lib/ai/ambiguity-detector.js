/**
 * Ambiguity Detector
 * Identifies under-specified or vague user requests and generates clarifying questions
 * before starting to build. Prevents wasted builds from misunderstood requirements.
 */

/**
 * Detect if a user request is ambiguous or under-specified
 * @param {string} userMessage - The user's request
 * @param {Object} context - Additional context (project files, chat history, etc.)
 * @returns {Object} { isAmbiguous: boolean, confidence: 'high'|'medium'|'low', questions: string[] }
 */
export function detectAmbiguity(userMessage, context = {}) {
  const msg = userMessage.toLowerCase().trim()
  const questions = []
  let ambiguityScore = 0
  
  // Skip ambiguity detection for:
  // 1. Very short greetings/acknowledgments
  if (msg.length < 15 && /^(hi|hey|hello|thanks|ok|yes|no|sure|got it)\b/.test(msg)) {
    return { isAmbiguous: false, confidence: 'high', questions: [] }
  }
  
  // 2. Explicit refinement requests on existing projects
  if (context.hasExistingFiles && /\b(change|update|modify|fix|adjust|tweak|refine)\b/.test(msg)) {
    return { isAmbiguous: false, confidence: 'high', questions: [] }
  }
  
  // 3. Proceed/continue signals
  if (/\b(proceed|continue|go ahead|do it|yes|start|next|keep going|build it)\b/.test(msg)) {
    return { isAmbiguous: false, confidence: 'high', questions: [] }
  }

  // ── Pattern 1: Vague action verbs without specifics ──
  const vaguePatterns = [
    /^(build|create|make|design|generate)\s+(a|an|me|my)?\s+(website|app|page|site|tool)(\s+for)?\s*$/i,
    /^(i want|i need|can you (make|build|create))\s+(a|an)\s+(website|app|page|site)\s*$/i,
    /^(build|create)\s+something\b/i,
  ]
  
  for (const pattern of vaguePatterns) {
    if (pattern.test(userMessage)) {
      ambiguityScore += 3
      questions.push("What is the main purpose of this project? (e.g., portfolio, e-commerce, blog, SaaS dashboard)")
      questions.push("Who is your target audience?")
      questions.push("What are the 2-3 most important features you need?")
      break
    }
  }
  
  // ── Pattern 2: Missing target audience ──
  if (msg.includes('website') || msg.includes('app') || msg.includes('page')) {
    const hasAudience = /\b(for|audience|users?|customers?|clients?|visitors?|people who|targeting)\b/.test(msg)
    if (!hasAudience && msg.length > 30) {
      ambiguityScore += 1
      if (!questions.some(q => q.includes('audience'))) {
        questions.push("Who will be using this? (e.g., developers, small businesses, consumers)")
      }
    }
  }
  
  // ── Pattern 3: No pages/features specified for new projects ──
  const isNewProject = !context.hasExistingFiles
  if (isNewProject && (msg.includes('website') || msg.includes('app'))) {
    const hasPages = /\b(page|pages|section|sections|feature|features|component|components|view|views|screen|screens)\b/.test(msg)
    const hasList = /\b(with|including|needs?|should have|must have|require|contains?)\b/.test(msg)
    
    if (!hasPages && !hasList && msg.length < 100) {
      ambiguityScore += 2
      questions.push("What pages or sections do you need? (e.g., Home, About, Pricing, Contact)")
      questions.push("What's the most important page or feature to start with?")
    }
  }
  
  // ── Pattern 4: No design/style preferences ──
  if (isNewProject && msg.length > 20) {
    const hasStyle = /\b(modern|minimal|dark|light|colorful|professional|playful|elegant|bold|clean|gradient|glassmorphism|neumorphism|style|design|look|feel|theme|color|mood)\b/.test(msg)
    if (!hasStyle) {
      ambiguityScore += 1
      questions.push("What style or mood are you going for? (e.g., modern dark, minimal light, bold & colorful)")
    }
  }
  
  // ── Pattern 5: Generic "like X" references without specifics ──
  const likePattern = /\b(like|similar to|inspired by|based on)\s+([a-z0-9\s]+)\b/i
  const likeMatch = userMessage.match(likePattern)
  if (likeMatch) {
    const reference = likeMatch[2].trim()
    // If the reference is generic (e.g., "like a portfolio"), ask for specifics
    if (/^(a|an|the)?\s*(website|app|page|site|blog|store|dashboard|tool)$/.test(reference)) {
      ambiguityScore += 2
      questions.push(`Can you share a specific example website or describe what you like about that style?`)
    }
  }
  
  // ── Pattern 6: Missing content/copy ──
  if (isNewProject && msg.length > 30 && msg.length < 150) {
    const hasContent = /\b(headline|tagline|title|description|copy|text|content|message|value proposition|mission|about us|story)\b/.test(msg)
    const hasBrand = /\b(brand|company|business|product|service|name)\s+(is|called|named)\b/.test(msg)
    if (!hasContent && !hasBrand) {
      ambiguityScore += 1
      questions.push("What's your brand/company name and main headline or tagline?")
    }
  }
  
  // ── Pattern 7: Unclear scope (small tweak vs. full rebuild) ──
  if (context.hasExistingFiles && msg.length < 50) {
    const isSmallChange = /\b(change|fix|update|adjust|tweak|modify)\s+(the|a|an|my)?\s+\w+\b/.test(msg)
    const isLargeChange = /\b(rebuild|redesign|rewrite|overhaul|start over|from scratch)\b/.test(msg)
    
    if (!isSmallChange && !isLargeChange) {
      ambiguityScore += 1
      questions.push("Are you looking for a small tweak or a bigger redesign?")
    }
  }
  
  // ── Confidence scoring ──
  let confidence = 'low'
  let isAmbiguous = false
  
  if (ambiguityScore >= 5) {
    confidence = 'high'
    isAmbiguous = true
  } else if (ambiguityScore >= 3) {
    confidence = 'medium'
    isAmbiguous = true
  } else if (ambiguityScore >= 2) {
    confidence = 'low'
    isAmbiguous = true
  }
  
  // Deduplicate and limit to top 3 questions
  const uniqueQuestions = [...new Set(questions)].slice(0, 3)
  
  return {
    isAmbiguous,
    confidence,
    questions: uniqueQuestions,
    score: ambiguityScore
  }
}

/**
 * Format clarifying questions into a user-friendly message
 * @param {string[]} questions - Array of clarifying questions
 * @param {string} userMessage - Original user message
 * @returns {string} Formatted message with questions
 */
export function formatClarifyingQuestions(questions, userMessage) {
  if (!questions || questions.length === 0) {
    return null
  }
  
  const intro = questions.length === 1
    ? "Before I start building, I need one quick detail:"
    : `Before I start building, I have ${questions.length} quick questions to make sure I get this right:`
  
  const questionList = questions.map((q, i) => {
    if (questions.length === 1) {
      return `\n\n**${q}**`
    }
    return `\n${i + 1}. **${q}**`
  }).join('')
  
  const outro = "\n\nOnce you fill these in, I'll build exactly what you need — no guessing."
  
  return intro + questionList + outro
}
